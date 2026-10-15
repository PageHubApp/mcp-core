const dns = require("node:dns");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

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

// ── Private-address check ─────────────────────────────────────────────────
// A copy of the app's `utils/net/publicHost.ts` (`isPrivateIPv4` /
// `isPrivateIPv6` / `isPrivateIp`): this package is published on its own and
// can't import app code. Keep the two identical — the monorepo's
// `utils/net/publicHost.parity.test.ts` fails when they disagree.

function isPrivateIPv4(ip) {
  const parts = String(ip)
    .split(".")
    .map(v => Number(v));
  if (parts.length !== 4 || parts.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-net, RFC 1918, loopback
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** The first 16-bit group of an IPv6 address (`"::1"` → 0, `"fd00::"` → 0xfd00). */
function firstHextet(ip) {
  const head = ip.split(":")[0];
  return head ? parseInt(head, 16) : 0;
}

function isPrivateIPv6(ip) {
  const v = String(ip).toLowerCase().replace(/%.*$/, "");
  if (v === "::1" || v === "::") return true; // loopback, unspecified
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) || v.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const first = firstHextet(v);
  if ((first & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0) return true; // ::/8 — IPv4-compatible and other reserved forms
  if (first === 0x2002) return true; // 6to4 — can carry any IPv4 inside
  return false;
}

function isPrivateIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true;
}

/**
 * The URLs come from the model, and the HEAD runs from the server that hosts
 * the MCP — so without this, image "validation" doubles as a probe for
 * internal hosts and ports (status / error text is echoed back to the model).
 * Returns the checked address; the HEAD connects to exactly that address.
 */
async function assertPublicHttpUrl(raw, lookup = host => dns.promises.lookup(host, { all: true, verbatim: true })) {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("URL must be http(s)");
  if (u.username || u.password) throw new Error("URL cannot include credentials");
  // `URL.hostname` keeps the brackets on an IPv6 literal.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("URL host is not allowed");
  }
  let addrs;
  try {
    addrs = await lookup(host);
  } catch {
    throw new Error("URL host could not be resolved");
  }
  if (!Array.isArray(addrs) || addrs.length === 0) throw new Error("URL host could not be resolved");
  if (addrs.some(a => !a?.address || isPrivateIp(a.address))) {
    throw new Error("URL resolves to a private or non-routable address");
  }
  return addrs[0].address;
}

/**
 * HEAD `url`, connecting to `address` (already checked) instead of resolving
 * the name again — a DNS-rebinding host can't swap in an internal address
 * between the check and the connect. The hostname still drives `Host`, SNI
 * and certificate checks. No redirect is followed.
 */
function headPinned(url, address, timeoutMs) {
  const u = new URL(url);
  const family = net.isIP(address);
  const transport = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      u,
      {
        method: "HEAD",
        agent: false,
        signal: AbortSignal.timeout(timeoutMs),
        lookup: (_host, opts, cb) => {
          const callback = typeof opts === "function" ? opts : cb;
          if (opts && typeof opts === "object" && opts.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
      },
      res => {
        res.resume();
        resolve({ status: res.statusCode || 0 });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function validateImageUrls(urls) {
  const failures = [];
  for (const url of urls) {
    try {
      const address = await assertPublicHttpUrl(url);
      // No redirect is followed: that would re-open the door to an internal
      // target after the public-host check. A 3xx counts as reachable; the
      // renderer's own fetch resolves it later client-side.
      const resp = await headPinned(url, address, 8000);
      if (!(resp.status >= 200 && resp.status < 400)) {
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
  assertPublicHttpUrl,
  isPrivateIp,
  extractImageUrls,
  validateImageUrls,
  collectAllImageUrls,
};
