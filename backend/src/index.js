require("dotenv").config();
const express = require("express");
const { TicketInputSchema, TicketOutputSchema } = require("./schema");
const { analyze } = require("./services/analyze");

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/analyze-ticket", async (req, res) => {
  try {
    const parsed = TicketInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const normalizedTicket = normalizeTicket(parsed.data);
    const result = await analyze(normalizedTicket);
    const response = buildApiResponse(normalizedTicket, result);
    const safeResponse = TicketOutputSchema.parse(response);

    res.json(safeResponse);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`QueueStorm Investigator running on port ${PORT}`);
});

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
    department: normalizeDepartment(result.department),
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
    extracted_entities: result.extracted_entities,
    matched_transaction_ids: result.matched_transaction_ids || [],
  };
}

function normalizeDepartment(department) {
  return department || "customer_support";
}

function shouldRequireHumanReview(result) {
  if (result.ambiguity?.length > 0) return true;
  if (result.severity === "critical") return true;
  if (["wrong_transfer", "duplicate_payment", "agent_cash_in_issue"].includes(result.case_type)) return true;
  return false;
}

function confidenceToScore(confidence) {
  if (typeof confidence === "number") return confidence;

  const map = {
    high: 0.9,
    medium: 0.65,
    low: 0.35,
  };

  return map[confidence] || 0.35;
}
