'use strict';

const { TicketInputSchema, TicketOutputSchema } = require('../../backend/src/schema');
const { analyze } = require('../../backend/src/services/analyze');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return response(204, '');
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = TicketInputSchema.safeParse(body);

    if (!parsed.success) {
      return response(400, {
        error: 'Invalid input',
        details: parsed.error.errors,
      });
    }

    const normalizedTicket = normalizeTicket(parsed.data);
    const result = await analyze(normalizedTicket);
    const apiResponse = TicketOutputSchema.parse(buildApiResponse(normalizedTicket, result));

    return response(200, apiResponse);
  } catch (error) {
    return response(500, {
      error: 'Internal server error',
      message: error.message,
    });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function normalizeTicket(ticket) {
  return {
    ...ticket,
    complaint_text: ticket.complaint_text || ticket.complaint,
    complaint: ticket.complaint || ticket.complaint_text,
  };
}

function buildApiResponse(ticket, result) {
  return {
    ticket_id: ticket.ticket_id,
    relevant_transaction_id: result.relevant_transaction_id,
    evidence_verdict: result.evidence_verdict,
    case_type: result.case_type,
    department: result.department || 'customer_support',
    severity: result.severity,
    customer_reply: result.customer_reply,
    agent_summary: result.evidence_summary,
    recommended_next_action: result.next_action,
    human_review_required: shouldRequireHumanReview(result),
    confidence: confidenceToScore(result.confidence),
    reason_codes: [
      result.evidence_verdict,
      result.case_type,
      ...(result.ambiguity || []),
    ].filter(Boolean),
  };
}

function shouldRequireHumanReview(result) {
  if (result.ambiguity?.length > 0) return true;
  if (result.severity === 'critical') return true;
  if (['wrong_transfer', 'duplicate_payment', 'agent_cash_in_issue'].includes(result.case_type)) {
    return true;
  }
  return false;
}

function confidenceToScore(confidence) {
  if (typeof confidence === 'number') return confidence;

  const map = {
    high: 0.9,
    medium: 0.65,
    low: 0.35,
  };

  return map[confidence] || 0.35;
}
