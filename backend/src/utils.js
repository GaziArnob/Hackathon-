'use strict';

const AMOUNT_KEYS = [
  'amount',
  'transaction_amount',
  'txn_amount',
  'value',
  'total',
  'total_amount',
  'debit',
  'credit',
  'paid_amount',
];

const ID_KEYS = [
  'id',
  'transaction_id',
  'txn_id',
  'trx_id',
  'reference_id',
  'ref_id',
  'payment_id',
];

const PARTY_KEYS = [
  'merchant',
  'merchant_name',
  'biller',
  'shop',
  'shop_name',
  'counterparty',
  'recipient',
  'recipient_name',
  'receiver',
  'receiver_name',
  'sender',
  'sender_name',
  'to',
  'from',
  'payee',
  'description',
  'note',
];

const TIME_KEYS = [
  'time',
  'timestamp',
  'transaction_time',
  'txn_time',
  'date',
  'datetime',
  'created_at',
  'posted_at',
];

const COMPLAINT_TEXT_KEYS = [
  'complaint',
  'message',
  'description',
  'details',
  'issue',
  'body',
  'text',
  'customer_message',
  'customer_complaint',
  'summary',
  'title',
  'subject',
];

function normalizeBanglaDigits(value) {
  return String(value ?? '').replace(/[\u09E6-\u09EF]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x09E6)
  );
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeComparable(value) {
  return normalizeWhitespace(normalizeBanglaDigits(value)).toLowerCase();
}

function hasBangla(value) {
  return /[\u0980-\u09FF]/.test(String(value ?? ''));
}

function detectLanguage(value) {
  return hasBangla(value) ? 'bn' : 'en';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[\s_-]/g, '');
}

function getFieldValue(object, keys) {
  if (!isPlainObject(object)) return null;

  const wanted = new Set(keys.map(normalizeKey));
  for (const [key, value] of Object.entries(object)) {
    if (wanted.has(normalizeKey(key)) && value !== null && value !== undefined && value !== '') {
      return value;
    }
  }

  return null;
}

function collectStrings(value, limit = 120) {
  const strings = [];
  const seen = new Set();

  function walk(current) {
    if (strings.length >= limit || current === null || current === undefined) return;

    if (typeof current === 'string') {
      const normalized = normalizeWhitespace(current);
      if (normalized) strings.push(normalized);
      return;
    }

    if (typeof current === 'number' || typeof current === 'boolean') return;
    if (typeof current !== 'object' || seen.has(current)) return;

    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    Object.values(current).forEach(walk);
  }

  walk(value);
  return strings;
}

function findTextValuesByKeys(value, keys) {
  const results = [];
  const wanted = new Set(keys.map(normalizeKey));
  const seen = new Set();

  function walk(current) {
    if (current === null || current === undefined) return;
    if (typeof current !== 'object' || seen.has(current)) return;

    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    for (const [key, child] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key)) && typeof child === 'string') {
        const normalized = normalizeWhitespace(child);
        if (normalized) results.push(normalized);
      }
      walk(child);
    }
  }

  walk(value);
  return results;
}

function getTicketText(ticket) {
  const priorityText = findTextValuesByKeys(ticket, COMPLAINT_TEXT_KEYS);
  const allText = collectStrings(ticket);
  const combined = priorityText.length > 0 ? priorityText : allText;
  const unique = [];
  const seen = new Set();

  for (const text of combined) {
    const normalized = normalizeWhitespace(text);
    const key = normalizeComparable(normalized);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }

  return unique.join('\n');
}

function parseMoney(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;

  const text = normalizeBanglaDigits(value)
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, ' ')
    .trim();

  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractAmount(text) {
  const normalized = normalizeBanglaDigits(text).replace(/,/g, '');
  const currencyPatterns = [
    /(?:bdt|tk\.?|taka|\u09F3)\s*(-?\d+(?:\.\d+)?)/i,
    /(-?\d+(?:\.\d+)?)\s*(?:bdt|tk\.?|taka|\u099F\u09BE\u0995\u09BE|\u09F3)/i,
  ];

  for (const pattern of currencyPatterns) {
    const match = normalized.match(pattern);
    if (match) return parseMoney(match[1]);
  }

  const numberMatches = normalized.match(/\b\d+(?:\.\d+)?\b/g) || [];
  for (const numberText of numberMatches) {
    if (numberText.length >= 8) continue;
    const amount = parseMoney(numberText);
    if (amount !== null && amount > 0) return amount;
  }

  return null;
}

function extractPhone(text) {
  const compact = normalizeBanglaDigits(text).replace(/[\s-]/g, '');
  const match = compact.match(/(?:\+?88)?01[3-9]\d{8}/);
  return match ? match[0] : null;
}

function extractTime(text) {
  const normalized = normalizeBanglaDigits(text);
  const patterns = [
    /\b\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\b/,
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:\s+\d{1,2}:\d{2})?\b/,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/i,
    /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4}\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return normalizeWhitespace(match[0]);
  }

  return null;
}

function extractMerchant(ticket, text) {
  const explicitValue = getFieldValue(ticket, PARTY_KEYS);
  if (typeof explicitValue === 'string' && explicitValue.trim()) {
    return normalizeWhitespace(explicitValue);
  }

  const normalized = normalizeWhitespace(text);
  const match = normalized.match(/\b(?:merchant|shop|store|biller|at|to)\s+([A-Za-z0-9 .&'_-]{2,48})/i);
  if (!match) return null;

  return normalizeWhitespace(match[1].replace(/[.,!?;:].*$/, ''));
}

function looksLikeTransaction(value) {
  if (!isPlainObject(value)) return false;

  const hasAmount = getFieldValue(value, AMOUNT_KEYS) !== null;
  const hasId = getFieldValue(value, ID_KEYS) !== null;
  const hasParty = getFieldValue(value, PARTY_KEYS) !== null;
  const hasTime = getFieldValue(value, TIME_KEYS) !== null;

  return hasAmount && (hasId || hasParty || hasTime);
}

function collectTransactions(input) {
  const transactions = [];
  const seenObjects = new Set();
  const transactionArrayKey = /(?:transactions?|txns?|history|ledger|payments?|transfers?|records?)/i;

  function addTransaction(item) {
    if (!isPlainObject(item) || seenObjects.has(item)) return;
    seenObjects.add(item);
    transactions.push(item);
  }

  function walk(value, key = '') {
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      const objectItems = value.filter(isPlainObject);
      const likelyTransactionArray =
        objectItems.length > 0 &&
        (transactionArrayKey.test(key) || objectItems.some(looksLikeTransaction));

      if (likelyTransactionArray) {
        objectItems.filter(looksLikeTransaction).forEach(addTransaction);
        return;
      }

      value.forEach((item) => walk(item, key));
      return;
    }

    if (!isPlainObject(value)) return;
    if (looksLikeTransaction(value) && transactionArrayKey.test(key)) {
      addTransaction(value);
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      walk(childValue, childKey);
    }
  }

  walk(input);
  return transactions;
}

function getTransactionId(transaction, fallbackIndex) {
  const value = getFieldValue(transaction, ID_KEYS);
  if (value === null || value === undefined || value === '') return `transaction_${fallbackIndex + 1}`;
  return String(value);
}

function getTransactionAmount(transaction) {
  return parseMoney(getFieldValue(transaction, AMOUNT_KEYS));
}

function getTransactionParty(transaction) {
  const value = getFieldValue(transaction, PARTY_KEYS);
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    return normalizeWhitespace(collectStrings(value, 8).join(' ')) || null;
  }
  return normalizeWhitespace(value);
}

function getTransactionTime(transaction) {
  const value = getFieldValue(transaction, TIME_KEYS);
  if (value === null || value === undefined) return null;
  return normalizeWhitespace(value);
}

function amountsEqual(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return Math.abs(Number(left) - Number(right)) < 0.01;
}

function parseDateValue(value) {
  if (!value) return null;

  const parsed = Date.parse(normalizeBanglaDigits(value));
  if (Number.isNaN(parsed)) return null;

  return new Date(parsed);
}

function sameDay(left, right) {
  const leftDate = parseDateValue(left);
  const rightDate = parseDateValue(right);
  if (!leftDate || !rightDate) return false;

  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function normalizePhone(value) {
  if (!value) return null;
  return normalizeBanglaDigits(value).replace(/[^\d+]/g, '');
}

module.exports = {
  amountsEqual,
  collectStrings,
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
  hasBangla,
  normalizeComparable,
  normalizePhone,
  normalizeWhitespace,
  parseDateValue,
  parseMoney,
  sameDay,
};
