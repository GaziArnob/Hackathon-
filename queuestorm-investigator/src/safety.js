const CREDENTIAL_PATTERNS = [
  /pin/i, /password/i, /otp/i, /secret/i, /cvv/i,
  /share your.*code/i, /send us your/i,
];

const MONEY_PROMISE_PATTERNS = [
  /we will refund/i, /you will receive/i,
  /guaranteed.*refund/i, /money.*back.*guarantee/i,
];

function applySafetyFilters(result) {
  let reply = result.draft_reply;

  // Block credential requests
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(reply)) {
      reply = reply.replace(pattern, "[REDACTED]");
      console.warn(`Safety: credential pattern triggered: ${pattern}`);
    }
  }

  // Replace unauthorized money promises
  for (const pattern of MONEY_PROMISE_PATTERNS) {
    if (pattern.test(reply)) {
      reply = reply.replace(
        pattern,
        "any eligible amount will be returned through official channels"
      );
      console.warn(`Safety: money promise pattern replaced: ${pattern}`);
    }
  }

  return { ...result, draft_reply: reply };
}

module.exports = { applySafetyFilters };
