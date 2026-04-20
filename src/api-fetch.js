const { getContext } = require("./context");

/** Strip trailing slash from base URL. */
function normalizeBaseUrl(url) {
  if (url == null || url === "") return null;
  const s = String(url).trim().replace(/\/$/, "");
  return s || null;
}

/**
 * Authenticated fetch against the PageHub API.
 * Reads apiKey and apiBaseUrl from the per-request context.
 */
async function apiFetch(pathStr, opts = {}) {
  const ctx = getContext();
  const apiKey = ctx.apiKey;
  if (!apiKey)
    throw new Error(
      "No API key configured. " +
        "Set PAGEHUB_API_KEY in your MCP server env config (from https://pagehub.dev/dashboard), then restart the MCP server."
    );
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
  const url = `${base}${pathStr}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  const resp = await fetch(url, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text || `API ${resp.status}: ${resp.statusText}` };
  }
  if (!resp.ok) {
    const code = json?.code ? `[${json.code}] ` : "";
    const detail =
      json?.currentUpdatedAt || json?.currentVersion
        ? ` (current: ${json.currentUpdatedAt || json.currentVersion})`
        : "";
    throw new Error(`${code}${json.error || `API ${resp.status}: ${resp.statusText}`}${detail}`);
  }
  return json;
}

module.exports = { apiFetch, normalizeBaseUrl };
