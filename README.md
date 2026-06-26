# QueueStorm Investigator

AI-assisted support ticket investigator for the SUST CSE Carnival 2026 preliminary round.

## Required API

- `GET /health` returns `{"status":"ok"}`.
- `POST /analyze-ticket` accepts one ticket JSON and returns the required structured decision JSON.

## Run Backend

```powershell
cd backend
npm ci
npm start
```

The backend binds to `0.0.0.0` and uses port `3000` by default.

## Run Frontend

```powershell
cd frontend
npm ci
npm run dev
```

The frontend calls `http://localhost:3000/analyze-ticket` by default. Set `VITE_API_BASE_URL` if the backend is hosted elsewhere.

## Sample Request

```json
{
  "ticket_id": "TKT-001",
  "complaint": "I sent 5000 taka to a wrong number around 2pm today.",
  "language": "en",
  "channel": "in_app_chat",
  "user_type": "customer",
  "transaction_history": [
    {
      "transaction_id": "TXN-9101",
      "timestamp": "2026-04-14T14:08:22Z",
      "type": "transfer",
      "amount": 5000,
      "counterparty": "+8801719876543",
      "status": "completed"
    }
  ]
}
```

## Sample Response

```json
{
  "ticket_id": "TKT-001",
  "relevant_transaction_id": "TXN-9101",
  "evidence_verdict": "consistent",
  "case_type": "wrong_transfer",
  "severity": "high",
  "department": "dispute_resolution",
  "agent_summary": "Customer complaint involves 5000 BDT; evidence points to transaction TXN-9101.",
  "recommended_next_action": "Route the ticket to the assigned department with the matched evidence.",
  "customer_reply": "We found a transaction that matches the complaint details and routed it for review. Please do not share your PIN or OTP with anyone.",
  "human_review_required": true,
  "confidence": 0.9,
  "reason_codes": ["consistent", "wrong_transfer"]
}
```

## Safety

The service never asks for PIN, OTP, password, passcode, or full credential details. It also avoids unauthorized refund or reversal promises and uses official-channel language for any eligible money movement.

## Docker

```powershell
cd backend
docker build -t queuestorm-investigator .
docker run --rm -p 3000:3000 --env-file .env queuestorm-investigator
```

`OPENAI_API_KEY` is optional. Without it, the deterministic reasoning and safety pipeline still works.
