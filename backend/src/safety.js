'use strict';

const SAFE_MONEY_PHRASE =
  'Any eligible amount will be returned through official channels.';
const SAFE_MONEY_PHRASE_BN =
  '\u09AF\u09CB\u0997\u09CD\u09AF \u0995\u09CB\u09A8\u09CB \u0985\u09B0\u09CD\u09A5 \u0985\u09AB\u09BF\u09B8\u09BF\u09AF\u09BC\u09BE\u09B2 \u099A\u09CD\u09AF\u09BE\u09A8\u09C7\u09B2\u09C7\u09B0 \u09AE\u09BE\u09A7\u09CD\u09AF\u09AE\u09C7 \u09AB\u09C7\u09B0\u09A4 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09AC\u09C7\u0964';

function sanitizeDecision(decision, context = {}) {
  const clean = sanitizeValue({ ...decision });
  const reasoning = context.reasoning || {};

  clean.relevant_transaction_id = normalizeNullableString(
    clean.relevant_transaction_id ?? reasoning.relevant_transaction_id
  );
  clean.evidence_verdict = normalizeEnum(
    clean.evidence_verdict,
    ['consistent', 'inconsistent', 'insufficient_data'],
    reasoning.evidence_verdict || 'insufficient_data'
  );
  clean.case_type = normalizeNullableString(clean.case_type || reasoning.case_type || 'general_dispute');
  clean.department = normalizeNullableString(clean.department || reasoning.department || 'customer_support');
  clean.severity = normalizeEnum(clean.severity, ['low', 'medium', 'high'], reasoning.severity || 'low');
  clean.confidence = normalizeEnum(clean.confidence, ['low', 'medium', 'high'], reasoning.confidence || 'low');
  clean.evidence_summary = clean.evidence_summary || reasoning.evidence_summary || '';
  clean.next_action = clean.next_action || buildNextAction(clean, reasoning);
  clean.customer_reply = sanitizeReply(
    clean.customer_reply || clean.reply || buildFallbackReply(clean, reasoning),
    reasoning.language
  );

  delete clean.reply;
  return clean;
}

function sanitizeValue(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeValue(child)]));
  }
  return value;
}

function sanitizeText(text) {
  return redactSensitiveText(removeRefundPromises(String(text)));
}

function sanitizeReply(reply, language = 'en') {
  const phrase = language === 'bn' ? SAFE_MONEY_PHRASE_BN : SAFE_MONEY_PHRASE;
  const sanitized = redactSensitiveText(removeRefundPromises(String(reply), phrase));
  return removeCredentialRequests(sanitized);
}

function redactSensitiveText(text) {
  return text
    .replace(/\b(otp|pin|password|passcode)\b\s*(?:is|:|=|-)?\s*([^\s,.!?;:]+)/gi, '$1 [REDACTED]')
    .replace(/((?:otp|pin|password|passcode).{0,16})\b\d{4,8}\b/gi, '$1[REDACTED]')
    .replace(
      /([\u0993\u099F\u09BF\u09AA\u09BF\u09A8\u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1]{2,20})\s*[:=-]?\s*\d{4,8}/g,
      '$1 [REDACTED]'
    );
}

function removeRefundPromises(text, safePhrase = SAFE_MONEY_PHRASE) {
  return text
    .replace(
      /\b(?:we|i|our team|the bank|the company)\s+(?:will|shall|can|must|definitely)\s+(?:refund|return|reverse|credit|compensate)\b[^.?!]*/gi,
      safePhrase
    )
    .replace(
      /\b(?:refund|return|reversal|credit|compensation)\s+(?:is|has been|will be)\s+(?:guaranteed|confirmed|processed|done|completed)\b[^.?!]*/gi,
      safePhrase
    )
    .replace(
      /(?:\u0986\u09AE\u09B0\u09BE|\u0986\u09AE\u09BF)\s+[^।.!?]{0,40}(?:\u09AB\u09C7\u09B0\u09A4|\u09B0\u09BF\u09AB\u09BE\u09A8\u09CD\u09A1)[^।.!?]*/g,
      safePhrase
    );
}

function removeCredentialRequests(text) {
  return text.replace(
    /\b(?:share|send|provide|tell us|give us)\s+(?:your\s+)?(?:otp|pin|password|passcode)\b[^.?!]*/gi,
    'Please do not share any PIN, OTP, password, or passcode'
  );
}

function buildNextAction(decision, reasoning) {
  if (decision.evidence_verdict === 'insufficient_data') {
    return 'Ask the customer for a transaction ID, exact time, merchant, or recipient detail.';
  }

  if (decision.department === 'merchant_operations') {
    return 'Route to merchant operations for review.';
  }

  if (decision.evidence_verdict === 'inconsistent') {
    return 'Explain the evidence mismatch and request supporting details if the customer disputes it.';
  }

  if (reasoning.case_type === 'duplicate_payment') {
    return 'Route the duplicate transaction for eligibility review.';
  }

  return 'Route the ticket to the assigned department with the matched evidence.';
}

function buildFallbackReply(decision, reasoning = {}) {
  if (reasoning.language === 'bn') return buildBanglaFallbackReply(decision);

  if (decision.evidence_verdict === 'insufficient_data') {
    return 'We need one more detail to identify the exact transaction. Please confirm the transaction ID, exact time, merchant, or recipient.';
  }

  if (decision.department === 'merchant_operations') {
    return `Thank you for the details. We have routed this to merchant operations for review. ${SAFE_MONEY_PHRASE}`;
  }

  if (decision.evidence_verdict === 'inconsistent') {
    return 'Based on the available transaction history, the complaint does not match the evidence we found. Please share any additional supporting details if you want us to review further.';
  }

  if (decision.case_type === 'duplicate_payment') {
    return `We found a possible duplicate payment and routed it for review. ${SAFE_MONEY_PHRASE}`;
  }

  return `We found a transaction that matches the complaint details and routed it for review. ${SAFE_MONEY_PHRASE}`;
}

function buildBanglaFallbackReply(decision) {
  if (decision.evidence_verdict === 'insufficient_data') {
    return '\u09B8\u09A0\u09BF\u0995 \u099F\u09CD\u09B0\u09BE\u09A8\u099C\u09CD\u09AF\u09BE\u0995\u09B6\u09A8 \u099A\u09BF\u09B9\u09CD\u09A8\u09BF\u09A4 \u0995\u09B0\u09A4\u09C7 \u0986\u09B0\u0993 \u098F\u0995\u099F\u09BF \u09A4\u09A5\u09CD\u09AF \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u099F\u09CD\u09B0\u09BE\u09A8\u099C\u09CD\u09AF\u09BE\u0995\u09B6\u09A8 \u0986\u0987\u09A1\u09BF, \u09B8\u09AE\u09AF\u09BC, \u09AE\u09BE\u09B0\u09CD\u099A\u09C7\u09A8\u09CD\u099F \u09AC\u09BE \u09AA\u09CD\u09B0\u09BE\u09AA\u0995\u09C7\u09B0 \u09A4\u09A5\u09CD\u09AF \u09A8\u09BF\u09B6\u09CD\u099A\u09BF\u09A4 \u0995\u09B0\u09C1\u09A8\u0964';
  }

  if (decision.evidence_verdict === 'inconsistent') {
    return '\u0989\u09AA\u09B2\u09AD\u09CD\u09AF \u099F\u09CD\u09B0\u09BE\u09A8\u099C\u09CD\u09AF\u09BE\u0995\u09B6\u09A8 \u09B9\u09BF\u09B8\u09CD\u099F\u09CD\u09B0\u09BF \u0985\u09A8\u09C1\u09AF\u09BE\u09AF\u09BC\u09C0 \u0985\u09AD\u09BF\u09AF\u09CB\u0997\u099F\u09BF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09A4\u09A5\u09CD\u09AF\u09C7\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09AE\u09C7\u09B2\u09C7\u09A8\u09BF\u0964 \u0986\u09AA\u09A8\u09BE\u09B0 \u0995\u09BE\u099B\u09C7 \u0985\u09A4\u09BF\u09B0\u09BF\u0995\u09CD\u09A4 \u09A4\u09A5\u09CD\u09AF \u09A5\u09BE\u0995\u09B2\u09C7 \u0986\u09AE\u09B0\u09BE \u09AA\u09C1\u09A8\u09B0\u09BE\u09AF\u09BC \u09AA\u09B0\u09CD\u09AF\u09BE\u09B2\u09CB\u099A\u09A8\u09BE \u0995\u09B0\u09A4\u09C7 \u09AA\u09BE\u09B0\u09BF\u0964';
  }

  return `\u0985\u09AD\u09BF\u09AF\u09CB\u0997\u09C7\u09B0 \u09A4\u09A5\u09CD\u09AF\u09C7\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09AE\u09BF\u09B2 \u09A5\u09BE\u0995\u09BE \u098F\u0995\u099F\u09BF \u099F\u09CD\u09B0\u09BE\u09A8\u099C\u09CD\u09AF\u09BE\u0995\u09B6\u09A8 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u0997\u09C7\u099B\u09C7 \u098F\u09AC\u0982 \u098F\u099F\u09BF \u09B0\u09BF\u09AD\u09BF\u0989\u09B0 \u099C\u09A8\u09CD\u09AF \u09B0\u09C1\u099F \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 ${SAFE_MONEY_PHRASE_BN}`;
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeNullableString(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

module.exports = {
  SAFE_MONEY_PHRASE,
  SAFE_MONEY_PHRASE_BN,
  sanitizeDecision,
  sanitizeReply,
  sanitizeText,
};
