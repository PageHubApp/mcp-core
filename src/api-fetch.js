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

  // Single silent retry on STALE_REVISION: swap in the server's current
  // updatedAt/version and replay. Most races inside an agent turn come from
  // rapid back-to-back tool calls where the caller's stored expectedUpdatedAt
  // just missed the previous write — retrying is strictly safer than surfacing
  // the error and letting the model pivot strategy (see AI-LOGS pattern
  // where STALE errors triggered delete+reapply loops).
  async function doFetch(bodyObj) {
    const resp = await fetch(url, {
      ...opts,
      headers,
      body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined,
    });
    const text = await resp.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text || `API ${resp.status}: ${resp.statusText}` };
    }
    return { resp, json };
  }

  let bodyObj = opts.body;
  let { resp, json } = await doFetch(bodyObj);

  if (
    !resp.ok &&
    json?.code === "STALE_REVISION" &&
    bodyObj &&
    typeof bodyObj === "object" &&
    (json.currentUpdatedAt || json.currentVersion)
  ) {
    const retryBody = { ...bodyObj };
    if (json.currentUpdatedAt && "expectedUpdatedAt" in retryBody) {
      retryBody.expectedUpdatedAt = json.currentUpdatedAt;
    }
    if (json.currentVersion && "expectedVersion" in retryBody) {
      retryBody.expectedVersion = json.currentVersion;
    }
    ({ resp, json } = await doFetch(retryBody));
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
