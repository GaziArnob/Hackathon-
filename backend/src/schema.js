const { z } = require("zod");

const TransactionSchema = z.object({
  transaction_id: z.string(),
  amount: z.number(),
  type: z.string().optional(),
  recipient: z.string().optional(),
  merchant: z.string().optional(),
  counterparty: z.string().optional(),
  timestamp: z.string(),
  status: z.string().optional(),
}).passthrough();

const TicketInputSchema = z.object({
  ticket_id: z.string(),
  complaint_text: z.string().optional(),
  complaint: z.string().optional(),
  customer_id: z.string().optional(),
  language: z.string().optional(),
  channel: z.string().optional(),
  user_type: z.string().optional(),
  campaign_context: z.string().optional(),
  transaction_history: z.array(TransactionSchema).optional().default([]),
  metadata: z.record(z.string(), z.any()).optional(),
}).passthrough().refine((ticket) => ticket.complaint_text || ticket.complaint, {
  message: "complaint_text or complaint is required",
  path: ["complaint_text"],
});

const TicketOutputSchema = z.object({
  ticket_id: z.string(),
  relevant_transaction_id: z.string().nullable(),
  evidence_verdict: z.enum(["consistent", "inconsistent", "insufficient_data"]),
  case_type: z.enum([
    "wrong_transfer",
    "payment_failed",
    "refund_request",
    "duplicate_payment",
    "merchant_settlement_delay",
    "agent_cash_in_issue",
    "phishing_or_social_engineering",
    "other",
  ]),
  department: z.enum([
    "customer_support",
    "dispute_resolution",
    "payments_ops",
    "merchant_operations",
    "agent_operations",
    "fraud_risk",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  agent_summary: z.string(),
  recommended_next_action: z.string(),
  customer_reply: z.string(),
  human_review_required: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  reason_codes: z.array(z.string()).optional(),
}).passthrough();

module.exports = { TicketInputSchema, TicketOutputSchema };
