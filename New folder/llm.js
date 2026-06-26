'use strict';

const { ANALYSIS_SYSTEM_PROMPT } = require('./prompts');

async function getLlmDecision(ticket, reasoning, options = {}) {
  if (options.useLlm === false) return null;

  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = options.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const baseUrl = (options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/$/,
    ''
  );

  const payload = {
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify(
          {
            ticket,
            deterministic_reasoning: reasoning,
          },
          null,
          2
        ),
      },
    ],
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    return parseJsonObject(content);
  } catch (_error) {
    return null;
  }
}

function parseJsonObject(content) {
  if (typeof content !== 'string') return null;

  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_nestedError) {
      return null;
    }
  }
}

module.exports = {
  getLlmDecision,
};
