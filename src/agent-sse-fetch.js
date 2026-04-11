const { normalizeBaseUrl } = require('./api-fetch');
const { getContext } = require('./context');
const { consumeAgentSseResponse } = require('../../../utils/ai/parseAgentSse');

/**
 * POST /api/ai/agent with JSON body, consume SSE (same protocol as Clippy).
 * @param {Record<string, unknown>} body
 * @returns {Promise<void>}
 */
async function postAgentSse(body) {
  const ctx = getContext();
  const apiKey = ctx.apiKey;
  if (!apiKey) {
    throw new Error('No API key in MCP context.');
  }
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
  const url = `${base}/api/ai/agent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let textOut = '';
  let lastError = null;
  let lastToolText = null;

  await consumeAgentSseResponse(
    response,
    {
      onText: (t) => {
        textOut += t;
      },
      onToolResult: (r) => {
        if (r?.result && typeof r.result === 'string') {
          lastToolText = r.result;
        }
      },
      onError: (msg) => {
        lastError = msg;
      },
    },
    undefined,
  );

  if (lastError) {
    throw new Error(lastError);
  }

  const trimmed = textOut.trim();
  if (trimmed) return trimmed;
  if (lastToolText && String(lastToolText).trim()) return String(lastToolText).trim();
  throw new Error('Agent returned no text output.');
}

module.exports = { postAgentSse };
