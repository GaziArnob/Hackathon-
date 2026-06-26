'use strict';

const fs = require('fs');
const path = require('path');

const KEY_FIELDS = [
  'relevant_transaction_id',
  'evidence_verdict',
  'case_type',
  'department',
  'severity',
];

async function main() {
  const samplePath = resolveSamplePath();
  const targetUrl = process.argv[3] || process.env.ANALYZE_URL || 'http://localhost:3000/analyze-ticket';

  if (!samplePath) {
    console.error(
      'Sample cases file not found. Pass it as the first argument or set SAMPLE_CASES_FILE.'
    );
    process.exit(1);
  }

  const cases = loadCases(samplePath);
  if (cases.length === 0) {
    console.error(`No cases found in ${samplePath}.`);
    process.exit(1);
  }

  let failed = 0;

  for (const sampleCase of cases) {
    const id = sampleCase.id || sampleCase.case_id || sampleCase.sample_id || 'unknown_case';
    const input = sampleCase.input || sampleCase.ticket || sampleCase.request || sampleCase.input_ticket;
    const expected = sampleCase.expected_output || sampleCase.expected || sampleCase.output;

    if (!input || !expected) {
      console.log(`SKIP ${id}: missing input or expected_output`);
      continue;
    }

    try {
      const actual = await postJson(targetUrl, input);
      const diff = diffKeyFields(actual, expected);

      if (diff.length === 0) {
        console.log(`PASS ${id}`);
      } else {
        failed += 1;
        console.log(`FAIL ${id}`);
        for (const line of diff) console.log(`  ${line}`);
      }
    } catch (error) {
      failed += 1;
      console.log(`ERROR ${id}: ${error.message}`);
    }
  }

  if (failed > 0) {
    console.error(`${failed} sample case(s) failed.`);
    process.exit(1);
  }

  console.log('All comparable sample cases passed.');
}

function resolveSamplePath() {
  const explicitPath = process.argv[2] || process.env.SAMPLE_CASES_FILE;
  const candidates = explicitPath
    ? [explicitPath]
    : [
        path.join(process.cwd(), 'SUST_Preli_Sample_Cases.json'),
        path.join(process.cwd(), 'data', 'SUST_Preli_Sample_Cases.json'),
        path.join(process.cwd(), '..', 'SUST_Preli_Sample_Cases.json'),
      ];

  return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => fs.existsSync(candidate));
}

function loadCases(samplePath) {
  const parsed = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.cases)) return parsed.cases;
  if (Array.isArray(parsed.sample_cases)) return parsed.sample_cases;
  if (Array.isArray(parsed.samples)) return parsed.samples;

  return [];
}

async function postJson(url, body) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable. Use Node.js 18 or newer.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`Endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function diffKeyFields(actual, expected) {
  const diff = [];

  for (const field of KEY_FIELDS) {
    const actualValue = actual?.[field] ?? null;
    const expectedValue = expected?.[field] ?? null;

    if (String(actualValue) !== String(expectedValue)) {
      diff.push(`${field}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
    }
  }

  return diff;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
