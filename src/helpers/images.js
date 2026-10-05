const dns = require("node:dns");

function extractImageUrls(props, resolvedName) {
  const urls = [];
  if (!props) return urls;
  const imgSrc = resolvedName === "Image" ? (props.src ?? props.content) : null;
  if (imgSrc && typeof imgSrc === "string") {
    if (props.type === "url" || (!props.type && imgSrc.startsWith("http"))) {
      urls.push(imgSrc);
    }
  }
  const bgImage = props.background?.image;
  if (bgImage && typeof bgImage === "string" && bgImage.startsWith("http")) {
    urls.push(bgImage);
  }
  return urls;
}

function isPrivateIp(ip) {
  const v = String(ip).toLowerCase();
  // IPv6 (including IPv4-mapped).
  if (v.includes(":")) {
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  const parts = v.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * The URLs come from the model, and the HEAD runs from the server that hosts
 * the MCP — so without this, image "validation" doubles as a probe for
 * internal hosts and ports (status / error text is echoed back to the model).
 */
async function assertPublicHttpUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("URL must be http(s)");
  if (u.username || u.password) throw new Error("URL cannot include credentials");
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("URL host is not allowed");
  }
  const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(addrs) || addrs.length === 0) throw new Error("URL host could not be resolved");
  if (addrs.some(a => !a?.address || isPrivateIp(a.address))) {
    throw new Error("URL resolves to a private or non-routable address");
  }
}

async function validateImageUrls(urls) {
  const failures = [];
  for (const url of urls) {
    try {
      await assertPublicHttpUrl(url);
      // `redirect: "manual"`: following a redirect would re-open the door to
      // an internal target after the public-host check. A 3xx counts as
      // reachable; the renderer's own fetch resolves it later client-side.
      const resp = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok && !(resp.status >= 300 && resp.status < 400)) {
        failures.push({ url, status: resp.status });
      }
    } catch (e) {
      failures.push({ url, status: `error: ${e.message}` });
    }
  }
  return failures;
}

function collectAllImageUrls(nodes) {
  const urls = [];
  for (const [id, node] of Object.entries(nodes)) {
    const found = extractImageUrls(node.props, node.type?.resolvedName);
    for (const url of found) urls.push({ nodeId: id, url });
  }
  return urls;
}

module.exports = {
  extractImageUrls,
  validateImageUrls,
  collectAllImageUrls,
};
