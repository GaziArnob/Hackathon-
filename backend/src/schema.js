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
  transaction_history: z.array(TransactionSchema),
}).passthrough().refine((ticket) => ticket.complaint_text || ticket.complaint, {
  message: "complaint_text or complaint is required",
  path: ["complaint_text"],
});

const TicketOutputSchema = z.object({
  ticket_id: z.string(),
  relevant_transaction_id: z.string().nullable(),
  evidence_verdict: z.enum(["consistent", "inconsistent", "insufficient_data"]),
  case_type: z.string(),
  department: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  clarification_needed: z.boolean(),
  draft_reply: z.string(),
}).passthrough();

module.exports = { TicketInputSchema, TicketOutputSchema };

