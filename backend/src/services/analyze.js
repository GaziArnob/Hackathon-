'use strict';

const { getLlmDecision } = require('../llm');
const { reason } = require('../reasoning');
const { sanitizeDecision } = require('../safety');

async function analyze(ticket, options = {}) {
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    throw new TypeError('analyze() expects a ticket JSON object.');
  }

  const reasoning = reason(ticket);
  const llmDecision = await getLlmDecision(ticket, reasoning, options);
  const decision = mergeDecision(reasoning, llmDecision);

  return sanitizeDecision(decision, { ticket, reasoning });
}

function mergeDecision(reasoning, llmDecision) {
  const baseDecision = {
    relevant_transaction_id: reasoning.relevant_transaction_id,
    evidence_verdict: reasoning.evidence_verdict,
    case_type: reasoning.case_type,
    department: reasoning.department,
    severity: reasoning.severity,
    confidence: reasoning.confidence,
    extracted_entities: reasoning.extracted,
    evidence_summary: reasoning.evidence_summary,
    matched_transaction_ids: reasoning.matched_transaction_ids,
    ambiguity: reasoning.ambiguity,
  };

  if (!llmDecision || typeof llmDecision !== 'object' || Array.isArray(llmDecision)) {
    return baseDecision;
  }

  const merged = {
    ...baseDecision,
    ...llmDecision,
    extracted_entities: {
      ...baseDecision.extracted_entities,
      ...(llmDecision.extracted_entities || {}),
    },
  };

  if (reasoning.ambiguity.includes('multiple_plausible_transactions')) {
    merged.relevant_transaction_id = null;
    merged.evidence_verdict = 'insufficient_data';
  }

  if (reasoning.case_type === 'duplicate_payment' && reasoning.relevant_transaction_id) {
    merged.relevant_transaction_id = reasoning.relevant_transaction_id;
  }

  return merged;
}

module.exports = {
  analyze,
};
