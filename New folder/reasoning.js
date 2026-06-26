'use strict';

const {
  amountsEqual,
  collectTransactions,
  detectLanguage,
  extractAmount,
  extractMerchant,
  extractPhone,
  extractTime,
  getTicketText,
  getTransactionAmount,
  getTransactionId,
  getTransactionParty,
  getTransactionTime,
  normalizeComparable,
  normalizePhone,
  sameDay,
} = require('./utils');

function reason(ticket) {
  const ticketText = getTicketText(ticket);
  const language = detectLanguage(ticketText);
  const extracted = {
    amount: extractAmount(ticketText),
    merchant: extractMerchant(ticket, ticketText),
    phone: extractPhone(ticketText),
    time: extractTime(ticketText),
  };

  const transactions = collectTransactions(ticket).map((transaction, index) => ({
    raw: transaction,
    index,
    id: getTransactionId(transaction, index),
    amount: getTransactionAmount(transaction),
    party: getTransactionParty(transaction),
    time: getTransactionTime(transaction),
  }));

  const caseType = determineCaseType(ticketText, ticket);
  const duplicateMatch = findDuplicatePayment(caseType, extracted, transactions);
  const establishedRecipient = findEstablishedRecipient(caseType, extracted, transactions);

  let result;

  if (duplicateMatch) {
    result = buildResult({
      evidenceVerdict: 'consistent',
      confidence: 'high',
      relevantTransactionId: duplicateMatch.id,
      reason:
        'The complaint describes a duplicate payment, and the second transaction in a matching repeated group was identified.',
      matchedTransactions: [duplicateMatch],
      ambiguity: [],
    });
  } else if (establishedRecipient.isEstablished) {
    result = buildResult({
      evidenceVerdict: 'inconsistent',
      confidence: 'medium',
      relevantTransactionId: establishedRecipient.relevantTransactionId,
      reason:
        'The complaint suggests a wrong transfer, but the history shows repeated transfers to the same recipient.',
      matchedTransactions: establishedRecipient.matches,
      ambiguity: [],
    });
  } else if (extracted.amount === null) {
    result = buildResult({
      evidenceVerdict: 'insufficient_data',
      confidence: 'low',
      relevantTransactionId: null,
      reason: 'No clear transaction amount was found in the complaint.',
      matchedTransactions: [],
      ambiguity: ['amount_missing'],
    });
  } else {
    const amountMatches = transactions.filter((transaction) =>
      amountsEqual(transaction.amount, extracted.amount)
    );

    if (amountMatches.length === 0) {
      result = buildResult({
        evidenceVerdict: 'inconsistent',
        confidence: 'medium',
        relevantTransactionId: null,
        reason: 'No transaction with the claimed amount was found in the supplied history.',
        matchedTransactions: [],
        ambiguity: [],
      });
    } else if (amountMatches.length === 1) {
      result = buildResult({
        evidenceVerdict: 'consistent',
        confidence: scoreTransaction(amountMatches[0], extracted).score >= 5 ? 'high' : 'medium',
        relevantTransactionId: amountMatches[0].id,
        reason: 'One transaction matches the claimed amount.',
        matchedTransactions: amountMatches,
        ambiguity: [],
      });
    } else {
      result = resolveMultipleMatches(amountMatches, extracted);
    }
  }

  return {
    language,
    case_type: caseType,
    department: determineDepartment(caseType, result.evidence_verdict),
    severity: determineSeverity(caseType, extracted.amount),
    extracted,
    transactions_checked: transactions.length,
    relevant_transaction_id: result.relevant_transaction_id,
    evidence_verdict: result.evidence_verdict,
    confidence: result.confidence,
    evidence_summary: result.reason,
    matched_transaction_ids: result.matchedTransactions.map((transaction) => transaction.id),
    ambiguity: result.ambiguity,
  };
}

function buildResult({
  evidenceVerdict,
  confidence,
  relevantTransactionId,
  reason,
  matchedTransactions,
  ambiguity,
}) {
  return {
    evidence_verdict: evidenceVerdict,
    confidence,
    relevant_transaction_id: relevantTransactionId,
    reason,
    matchedTransactions,
    ambiguity,
  };
}

function determineCaseType(ticketText, ticket) {
  const text = normalizeComparable(`${ticketText}\n${JSON.stringify(ticket ?? {})}`);

  if (hasMerchantContext(ticket) || /(merchant\s+(account|settlement|payout|dashboard|operation)|business\s+account|settlement|payout|commission|pos|qr\s+payment|\u09AE\u09BE\u09B0\u09CD\u099A\u09C7\u09A8\u09CD\u099F|\u09B8\u09C7\u099F\u09C7\u09B2\u09AE\u09C7\u09A8\u09CD\u099F)/i.test(text)) {
    return 'merchant_complaint';
  }

  if (/(duplicate|double|twice|two times|same payment|\u09A1\u09BE\u09AC\u09B2|\u09A6\u09C1\u0987\u09AC\u09BE\u09B0)/i.test(text)) {
    return 'duplicate_payment';
  }

  if (/(wrong transfer|wrong recipient|wrong number|mistake|mistaken|sent to wrong|\u09AD\u09C1\u09B2|\u0985\u09A8\u09CD\u09AF)/i.test(text)) {
    return 'wrong_transfer';
  }

  if (/(unauthorized|fraud|scam|not me|without permission|account hacked|\u09AA\u09CD\u09B0\u09A4\u09BE\u09B0\u09A3\u09BE|\u09B9\u09CD\u09AF\u09BE\u0995)/i.test(text)) {
    return 'unauthorized_transaction';
  }

  if (/(failed|pending|stuck|declined|but debited|debited but|\u09AC\u09CD\u09AF\u09B0\u09CD\u09A5|\u09AA\u09C7\u09A8\u09CD\u09A1\u09BF\u0982|\u0995\u09BE\u099F\u09BE)/i.test(text)) {
    return 'failed_transaction';
  }

  if (/(refund|return money|reverse|chargeback|\u09AB\u09C7\u09B0\u09A4)/i.test(text)) {
    return 'refund_request';
  }

  return 'general_dispute';
}

function hasMerchantContext(value) {
  if (!value || typeof value !== 'object') return false;

  const merchantContextKeys = new Set([
    'accounttype',
    'customertype',
    'customerrole',
    'usertype',
    'userrole',
    'role',
    'segment',
  ]);

  const stack = [value];
  const seen = new Set();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    for (const [key, child] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
      if (merchantContextKeys.has(normalizedKey) && normalizeComparable(child) === 'merchant') {
        return true;
      }
      if (child && typeof child === 'object') stack.push(child);
    }
  }

  return false;
}

function determineDepartment(caseType, evidenceVerdict) {
  if (caseType === 'merchant_complaint') return 'merchant_operations';
  if (caseType === 'unauthorized_transaction') return 'fraud_risk';
  if (caseType === 'failed_transaction') return 'payments_operations';
  if (evidenceVerdict === 'insufficient_data') return 'customer_support';
  if (caseType === 'wrong_transfer' && evidenceVerdict === 'inconsistent') return 'customer_support';
  if (caseType === 'duplicate_payment' || caseType === 'refund_request') return 'disputes';
  return 'disputes';
}

function determineSeverity(caseType, amount) {
  if (caseType === 'unauthorized_transaction') return 'high';
  if (amount !== null && amount >= 50000) return 'high';
  if (amount !== null && amount >= 5000) return 'medium';
  if (caseType === 'merchant_complaint') return 'medium';
  return 'low';
}

function findDuplicatePayment(caseType, extracted, transactions) {
  if (caseType !== 'duplicate_payment') return null;

  const grouped = new Map();
  for (const transaction of transactions) {
    if (transaction.amount === null) continue;
    if (extracted.amount !== null && !amountsEqual(transaction.amount, extracted.amount)) continue;

    const partyKey = normalizeComparable(transaction.party || 'unknown_party');
    const key = `${transaction.amount.toFixed(2)}|${partyKey}`;
    const group = grouped.get(key) || [];
    group.push(transaction);
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    return [...group].sort(sortByTimeThenIndex)[1];
  }

  return null;
}

function findEstablishedRecipient(caseType, extracted, transactions) {
  if (caseType !== 'wrong_transfer') {
    return { isEstablished: false, relevantTransactionId: null, matches: [] };
  }

  const targetPhone = normalizePhone(extracted.phone);
  const targetMerchant = normalizeComparable(extracted.merchant || '');
  const amountMatches =
    extracted.amount === null
      ? transactions
      : transactions.filter((transaction) => amountsEqual(transaction.amount, extracted.amount));

  const targetFromAmountMatch =
    amountMatches.length === 1 ? normalizeComparable(amountMatches[0].party || '') : '';

  const matches = transactions.filter((transaction) => {
    const party = normalizeComparable(transaction.party || '');
    const phone = normalizePhone(transaction.party || '');

    if (targetPhone && phone.includes(targetPhone.replace(/^\+?88/, ''))) return true;
    if (targetMerchant && party.includes(targetMerchant)) return true;
    if (targetFromAmountMatch && party && party === targetFromAmountMatch) return true;

    return false;
  });

  if (matches.length < 2) {
    return { isEstablished: false, relevantTransactionId: null, matches: [] };
  }

  const relevantMatch =
    amountMatches.find((transaction) => matches.some((match) => match.id === transaction.id)) ||
    matches[matches.length - 1];

  return {
    isEstablished: true,
    relevantTransactionId: relevantMatch ? relevantMatch.id : null,
    matches,
  };
}

function resolveMultipleMatches(amountMatches, extracted) {
  const scored = amountMatches.map((transaction) => ({
    transaction,
    ...scoreTransaction(transaction, extracted),
  }));

  scored.sort((left, right) => right.score - left.score || left.transaction.index - right.transaction.index);

  const [best, second] = scored;
  const hasStrongTieBreaker = best && best.score > 3;
  const isUniqueBest = best && (!second || best.score > second.score);

  if (hasStrongTieBreaker && isUniqueBest) {
    return buildResult({
      evidenceVerdict: 'consistent',
      confidence: best.score >= 7 ? 'high' : 'medium',
      relevantTransactionId: best.transaction.id,
      reason: 'Multiple transactions matched the amount, but one also matched stronger complaint details.',
      matchedTransactions: [best.transaction],
      ambiguity: [],
    });
  }

  return buildResult({
    evidenceVerdict: 'insufficient_data',
    confidence: 'low',
    relevantTransactionId: null,
    reason: 'Multiple transactions could match the complaint, so the exact transaction should not be guessed.',
    matchedTransactions: amountMatches,
    ambiguity: ['multiple_plausible_transactions'],
  });
}

function scoreTransaction(transaction, extracted) {
  let score = 0;
  const reasons = [];

  if (amountsEqual(transaction.amount, extracted.amount)) {
    score += 3;
    reasons.push('amount');
  }

  const party = normalizeComparable(transaction.party || '');
  const partyPhone = normalizePhone(transaction.party || '');
  const extractedPhone = normalizePhone(extracted.phone);

  if (extracted.merchant && party.includes(normalizeComparable(extracted.merchant))) {
    score += 2;
    reasons.push('merchant');
  }

  if (extractedPhone && partyPhone.includes(extractedPhone.replace(/^\+?88/, ''))) {
    score += 2;
    reasons.push('phone');
  }

  if (extracted.time && transaction.time && sameDay(extracted.time, transaction.time)) {
    score += 2;
    reasons.push('time');
  }

  return { score, reasons };
}

function sortByTimeThenIndex(left, right) {
  const leftTime = Date.parse(left.time || '');
  const rightTime = Date.parse(right.time || '');

  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.index - right.index;
}

module.exports = {
  reason,
};
