 require("dotenv").config();
const express = require("express");
const { TicketInputSchema } = require("./schema");
const { investigateTicket } = require("./reasoning");
const { applySafetyFilters } = require("./safety");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/analyze-ticket", async (req, res) => {
  try {
    // Validate input
    const parsed = TicketInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    // Investigate
    const result = await investigateTicket(parsed.data);

    // Apply safety
    const safeResult = applySafetyFilters(result);

    res.json(safeResult);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`QueueStorm Investigator running on port ${PORT}`);
});

