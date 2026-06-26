const { z } = require("zod");

const TransactionSchema = z.object({
  transaction_id: z.string(),
  amount: z.number(),
  type: z.enum(["debit", "credit"]),
  recipient: z.string().optional(),
  merchant: z.string().optional(),
  timestamp: z.string(),
  status: z.enum(["success", "failed", "pending"]),
});

const TicketInputSchema = z.object({
  ticket_id: z.string(),
  complaint_text: z.string(),
  customer_id: z.string(),
  transaction_history: z.array(TransactionSchema),
});

const TicketOutputSchema = z.object({
  ticket_id: z.string(),
  relevant_transaction_id: z.string().nullable(),
  evidence_verdict: z.enum(["consistent", "inconsistent", "insufficient_data"]),
  case_type: z.string(),
  department: z.enum([
    "dispute_resolution",
    "fraud_prevention",
    "merchant_operations",
    "general_support",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  clarification_needed: z.boolean(),
  draft_reply: z.string(),
});

module.exports = { TicketInputSchema, TicketOutputSchema };


