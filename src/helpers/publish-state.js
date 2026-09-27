/**
 * The publish-state trailer appended to every mutating tool response.
 *
 * A site write stages into the draft; `publish_site` promotes it. Without a
 * line saying so on every response, an agent can author a month of correct
 * work and be told "Updated" each time — which is what happened: five rounds
 * of per-page SEO, a working checkout, none of it live, no tool ever saying so.
 *
 * The line carries the age of the live version, not just the fact of drift.
 * "Saved to DRAFT" reads as routine and gets skimmed; "the live site is 4 weeks
 * behind" is what makes a caller run the publish step.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarse relative age — precision past the leading unit is noise here. */
function relativeAge(from, now = Date.now()) {
  const then = from instanceof Date ? from.getTime() : Date.parse(from);
  if (!Number.isFinite(then)) return null;
  const ms = now - then;
  if (ms < 2 * MINUTE) return "moments";
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} minutes`;
  if (ms < DAY) {
    const h = Math.round(ms / HOUR);
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  const d = Math.round(ms / DAY);
  if (d < 14) return d === 1 ? "1 day" : `${d} days`;
  const w = Math.round(d / 7);
  return w < 9 ? `${w} weeks` : `${Math.round(d / 30)} months`;
}

/** Name a few pages without letting a 40-page site fill the response. */
function namePages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return "";
  const shown = pages.slice(0, 4).join(", ");
  const rest = pages.length - 4;
  return rest > 0 ? ` (${shown}, +${rest} more)` : ` (${shown})`;
}

/**
 * @param {{ wroteTo?: string, published?: boolean, hasUnpublishedChanges?: boolean,
 *           unpublishedPages?: string[], lastPublishedAt?: string|Date|null }} write
 * @returns {string} Trailer line, or "" when the write went straight to `content`.
 */
function formatPublishTrailer(write) {
  if (!write || write.wroteTo !== "draft") return "";

  if (!write.published) {
    return "\nSaved to DRAFT. This site has never been published — nothing is live yet. Run publish_site.";
  }
  if (!write.hasUnpublishedChanges) {
    return "\nSaved to DRAFT. The live site already matches — nothing to publish.";
  }

  const pages = write.unpublishedPages || [];
  const count = pages.length;
  const what =
    count > 0
      ? `${count} page${count === 1 ? "" : "s"} staged but not live${namePages(pages)}`
      : "changes staged but not live";
  // No age rather than a wrong one: `lastPublishedAt` is only stamped by
  // publishes that promoted a draft, so a site that has not published since it
  // landed has none, and `publishedAt` means FIRST publish and would read as a
  // months-long lag on a site published yesterday.
  const age = relativeAge(write.lastPublishedAt);
  const behind = age ? ` The live site is ${age} behind.` : "";
  return `\nSaved to DRAFT — ${what}.${behind} Run publish_site to go live.`;
}

/**
 * Run a tool handler and append the publish-state trailer to its result.
 *
 * The one place the trailer is attached. Handlers assemble their own messages
 * and only a few route through `resultMsg`, so per-handler appends reached some
 * responses and not others; what every write shares is `saveTarget`, which
 * records the state on the context. Both dispatch surfaces — `executeTool`
 * (hosted MCP + in-app agent) and the stdio package's `delegateHandlers` —
 * wrap through here, so a tool added later reports it for free.
 */
async function runToolWithPublishTrailer(fn, args, ctx) {
  // Clear first: the trailer must describe THIS call's write, never one left
  // over from an earlier tool in the same request context.
  if (ctx) ctx._lastSiteWrite = null;
  const result = await fn(args);

  const write = ctx?._lastSiteWrite;
  if (!write) return result;
  const trailer = formatPublishTrailer(write);
  if (!trailer) return result;
  const content = result?.content;
  if (!Array.isArray(content)) return result;
  const lastText = [...content].reverse().find(c => c?.type === "text");
  if (!lastText || typeof lastText.text !== "string") return result;
  if (lastText.text.includes("Run publish_site")) return result;
  lastText.text += trailer;
  return result;
}

module.exports = { formatPublishTrailer, relativeAge, runToolWithPublishTrailer };
