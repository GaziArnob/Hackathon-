'use strict';

const {
  amountsEqual,
  collectTransactions,
  detectLanguage,
  extractAmount,
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
  const language = ticket.language || detectLanguage(ticketText);
  const extracted = {
    amount: extractAmount(ticketText),
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
    type: normalizeComparable(transaction.type || ''),
    status: normalizeComparable(transaction.status || ''),
  }));

  const caseType = determineCaseType(ticketText, ticket, transactions);
  const result = determineEvidence(caseType, extracted, transactions);

  return {
    language,
    case_type: caseType,
    department: determineDepartment(caseType),
    severity: determineSeverity(caseType, extracted.amount, result),
    extracted,
    transactions_checked: transactions.length,
    relevant_transaction_id: result.relevant_transaction_id,
    evidence_verdict: result.evidence_verdict,
    confidence: result.confidence,
    evidence_summary: buildEvidenceSummary(ticket, caseType, result, extracted),
    matched_transaction_ids: result.matchedTransactions.map((transaction) => transaction.id),
    ambiguity: result.ambiguity,
  };
}

function determineCaseType(ticketText, ticket, transactions) {
  const complaint = normalizeComparable(ticketText);
  const userType = normalizeComparable(ticket.user_type || '');
  const channel = normalizeComparable(ticket.channel || '');

  if (/(otp|pin|password|passcode|blocked if|account will be blocked|scam|phishing|fraud|caller|called me|asked for my otp)/i.test(complaint)) {
    return 'phishing_or_social_engineering';
  }

  if (
    userType === 'merchant' ||
    channel === 'merchantportal' ||
    /\bmerchant\b/.test(complaint)
  ) {
    if (/(settlement|settled|sales|payout|not been settled|batch)/i.test(complaint)) {
      return 'merchant_settlement_delay';
    }
  }

  if (
    /\bagent\b|cash\s*in|cash-in|\u098F\u099C\u09C7\u09A8\u09CD\u099F|\u0995\u09CD\u09AF\u09BE\u09B6\s*\u0987\u09A8/i.test(complaint) ||
    transactions.some((transaction) => transaction.type === 'cash_in')
  ) {
    if (/(balance|not reflected|didn't get|did not get|pending|\u09AC\u09CD\u09AF\u09BE\u09B2\u09C7\u09A8\u09CD\u09B8|\u0986\u09B8\u09C7\u09A8\u09BF|\u09AA\u09C7\u09A8\u09CD\u09A1\u09BF\u0982)/i.test(complaint)) {
      return 'agent_cash_in_issue';
    }
  }

  if (/(duplicate|double|twice|deducted twice|charged twice|same payment|\u09A1\u09BE\u09AC\u09B2|\u09A6\u09C1\u0987\u09AC\u09BE\u09B0)/i.test(complaint)) {
    return 'duplicate_payment';
  }

  if (/(failed|app showed failed|payment failed|balance was deducted|deducted|declined|mobile recharge|recharge failed|\u09AC\u09CD\u09AF\u09B0\u09CD\u09A5)/i.test(complaint)) {
    return 'payment_failed';
  }

  if (/(wrong number|wrong person|wrong recipient|wrong transfer|typed it wrong|by mistake|mistake|sent .*wrong|brother.*didn.?t get|didn.?t get it|not received|\u09AD\u09C1\u09B2)/i.test(complaint)) {
    return 'wrong_transfer';
  }

  if (/(refund|return my money|reverse it|chargeback|changed my mind|\u09AB\u09C7\u09B0\u09A4|\u09B0\u09BF\u09AB\u09BE\u09A8\u09CD\u09A1)/i.test(complaint)) {
    return 'refund_request';
  }

  return 'other';
}

function determineEvidence(caseType, extracted, transactions) {
  if (caseType === 'phishing_or_social_engineering') {
    return buildResult({
      evidenceVerdict: 'insufficient_data',
      confidence: 'high',
      relevantTransactionId: null,
      reason: 'Complaint reports a likely social engineering attempt rather than a specific transaction.',
      matchedTransactions: [],
      ambiguity: [],
    });
  }

  if (extracted.amount === null) {
    return buildResult({
      evidenceVerdict: 'insufficient_data',
      confidence: 'medium',
      relevantTransactionId: null,
      reason: 'The complaint does not include enough transaction detail to identify a specific entry.',
      matchedTransactions: [],
      ambiguity: ['needs_clarification'],
    });
  }

  if (caseType === 'duplicate_payment') {
    const duplicate = findDuplicatePayment(extracted, transactions);
    if (duplicate) {
      return buildResult({
        evidenceVerdict: 'consistent',
        confidence: 'high',
        relevantTransactionId: duplicate.id,
        reason: 'Two matching payments appear close together; the second transaction is the suspected duplicate.',
        matchedTransactions: [duplicate],
        ambiguity: [],
      });
    }
  }

  const amountMatches = transactions.filter((transaction) =>
    amountsEqual(transaction.amount, extracted.amount)
  );

  if (amountMatches.length === 0) {
    return buildResult({
      evidenceVerdict: 'inconsistent',
      confidence: 'medium',
      relevantTransactionId: null,
      reason: 'No transaction with the claimed amount appears in the provided history.',
      matchedTransactions: [],
      ambiguity: [],
    });
  }

  if (caseType === 'wrong_transfer') {
    const establishedRecipient = findEstablishedRecipient(amountMatches, transactions);
    if (establishedRecipient.isEstablished) {
      return buildResult({
        evidenceVerdict: 'inconsistent',
        confidence: 'medium',
        relevantTransactionId: establishedRecipient.relevantTransactionId,
        reason: 'The matching recipient appears repeatedly in prior transfers, suggesting an established recipient pattern.',
        matchedTransactions: establishedRecipient.matches,
        ambiguity: [],
      });
    }
  }

  if (amountMatches.length === 1) {
    return buildResult({
      evidenceVerdict: 'consistent',
      confidence: hasStrongSupportingEvidence(caseType, amountMatches[0], extracted) ? 'high' : 'medium',
      relevantTransactionId: amountMatches[0].id,
      reason: 'A single transaction matches the complaint amount and available context.',
      matchedTransactions: amountMatches,
      ambiguity: [],
    });
  }

  const resolved = resolveMultipleMatches(caseType, amountMatches, extracted);
  if (resolved) return resolved;

  return buildResult({
    evidenceVerdict: 'insufficient_data',
    confidence: 'medium',
    relevantTransactionId: null,
    reason: 'Multiple transactions plausibly match the complaint, so the exact transaction should not be guessed.',
    matchedTransactions: amountMatches,
    ambiguity: ['ambiguous_match', 'needs_clarification'],
  });
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

function determineDepartment(caseType) {
  const departmentByCaseType = {
    wrong_transfer: 'dispute_resolution',
    payment_failed: 'payments_ops',
    refund_request: 'customer_support',
    duplicate_payment: 'payments_ops',
    merchant_settlement_delay: 'merchant_operations',
    agent_cash_in_issue: 'agent_operations',
    phishing_or_social_engineering: 'fraud_risk',
    other: 'customer_support',
  };

  return departmentByCaseType[caseType] || 'customer_support';
}

function determineSeverity(caseType, amount, result) {
  if (caseType === 'phishing_or_social_engineering') return 'critical';
  if (caseType === 'payment_failed') return 'high';
  if (caseType === 'duplicate_payment') return 'high';
  if (caseType === 'agent_cash_in_issue') return 'high';
  if (caseType === 'merchant_settlement_delay') return 'medium';
  if (caseType === 'refund_request') return 'low';
  if (caseType === 'wrong_transfer') {
    if (amount !== null && amount >= 5000) return 'high';
    return result.evidence_verdict === 'insufficient_data' ? 'medium' : 'medium';
  }
  return 'low';
}

function findDuplicatePayment(extracted, transactions) {
  const grouped = new Map();

  for (const transaction of transactions) {
    if (transaction.amount === null) continue;
    if (extracted.amount !== null && !amountsEqual(transaction.amount, extracted.amount)) continue;

    const partyKey = normalizeComparable(transaction.party || 'unknown_party');
    const key = `${transaction.amount.toFixed(2)}|${partyKey}|${transaction.type}`;
    const group = grouped.get(key) || [];
    group.push(transaction);
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    const completedGroup = group.filter((transaction) => transaction.status !== 'failed');
    if (completedGroup.length < 2) continue;
    return [...completedGroup].sort(sortByTimeThenIndex)[1];
  }

  return null;
}

function findEstablishedRecipient(amountMatches, transactions) {
  const likelyCurrent = [...amountMatches].sort(sortByTimeThenIndex).at(-1);
  if (!likelyCurrent || !likelyCurrent.party) {
    return { isEstablished: false, relevantTransactionId: null, matches: [] };
  }

  const currentParty = normalizeComparable(likelyCurrent.party);
  const matches = transactions.filter(
    (transaction) => normalizeComparable(transaction.party || '') === currentParty
  );

  if (matches.length < 3) {
    return { isEstablished: false, relevantTransactionId: null, matches: [] };
  }

  return {
    isEstablished: true,
    relevantTransactionId: likelyCurrent.id,
    matches,
  };
}

function resolveMultipleMatches(caseType, amountMatches, extracted) {
  const scored = amountMatches.map((transaction) => ({
    transaction,
    score: scoreTransaction(transaction, extracted),
  }));

  scored.sort((left, right) => right.score - left.score || left.transaction.index - right.transaction.index);

  const [best, second] = scored;
  if (best && best.score > 4 && (!second || best.score > second.score)) {
    return buildResult({
      evidenceVerdict: 'consistent',
      confidence: best.score >= 7 ? 'high' : 'medium',
      relevantTransactionId: best.transaction.id,
      reason: 'Multiple amounts matched, but one transaction had stronger supporting details.',
      matchedTransactions: [best.transaction],
      ambiguity: [],
    });
  }

  if (caseType === 'wrong_transfer') return null;

  const nonFailed = amountMatches.filter((transaction) => transaction.status !== 'failed');
  if (nonFailed.length === 1) {
    return buildResult({
      evidenceVerdict: 'consistent',
      confidence: 'medium',
      relevantTransactionId: nonFailed[0].id,
      reason: 'Multiple amounts matched, but only one non-failed transaction is actionable.',
      matchedTransactions: [nonFailed[0]],
      ambiguity: [],
    });
  }

  return null;
}

function hasStrongSupportingEvidence(caseType, transaction, extracted) {
  if (['payment_failed', 'agent_cash_in_issue', 'merchant_settlement_delay'].includes(caseType)) {
    return ['failed', 'pending'].includes(transaction.status);
  }

  return scoreTransaction(transaction, extracted) >= 5;
}

function scoreTransaction(transaction, extracted) {
  let score = 0;

  if (amountsEqual(transaction.amount, extracted.amount)) score += 3;

  const partyPhone = normalizePhone(transaction.party || '');
  const extractedPhone = normalizePhone(extracted.phone);
  if (extractedPhone && partyPhone.includes(extractedPhone.replace(/^\+?88/, ''))) score += 2;
  if (extracted.time && transaction.time && sameDay(extracted.time, transaction.time)) score += 2;

  return score;
}

function buildEvidenceSummary(ticket, caseType, result, extracted) {
  const amountText = extracted.amount === null ? 'the claimed amount' : `${extracted.amount} BDT`;
  const transactionText = result.relevant_transaction_id
    ? `transaction ${result.relevant_transaction_id}`
    : 'no single transaction';

  if (caseType === 'phishing_or_social_engineering') {
    return 'Customer reports a likely social engineering attempt involving sensitive credentials.';
  }

  if (result.evidence_verdict === 'insufficient_data') {
    return `Customer complaint does not identify one clear transaction; ${transactionText} can be selected from the supplied history.`;
  }

  return `Customer complaint involves ${amountText}; evidence points to ${transactionText}. ${result.reason}`;
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
