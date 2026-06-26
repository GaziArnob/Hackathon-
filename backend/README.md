# QueueStorm Investigator Backend

Express API for the preliminary round contract.

## Commands

```powershell
npm ci
npm start
```

## Endpoints

- `GET /health`
- `POST /analyze-ticket`

## Tests

```powershell
npm test
node tests/run-sample-cases.js "C:\Users\arnob\Downloads\SUST_Preli_Sample_Cases.json"
```

## Environment

See `.env.example`. `OPENAI_API_KEY` is optional; the service has a deterministic fallback.
