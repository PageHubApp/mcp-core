/**
 * The status lines select_site / update_site print for a `/api/v1/sites/[id]`
 * payload — one per site-level setting, each naming the update_site field
 * that changes it.
 */

/** Status lines for a `/api/v1/sites/[id]` payload's `crawlPolicy` mode + `blockAi`. */
function crawlLines(data) {
  return (
    `Search indexing: ${data?.crawlPolicy?.mode || "public"} (update_site crawlMode)\n` +
    `AI crawlers: ${data?.crawlPolicy?.blockAi ? "blocked" : "allowed"} (update_site blockAiCrawlers)`
  );
}

/** One status line for a `/api/v1/sites/[id]` payload's site-wide `ogImage`. */
function siteOgImageLine(data) {
  return `Site share image: ${data?.ogImage || "(unset — pages without their own og:image get the generated card)"}`;
}

/** One status line for a `/api/v1/sites/[id]` payload's `timezone`. */
function timezoneLine(data) {
  return `Timezone: ${data?.timezone || "(unset — Liquid dates, {{ year }} and notification emails use UTC)"} (update_site timezone)`;
}

/** One status line for a `/api/v1/sites/[id]` payload's `language`. */
function languageLine(data) {
  return `Language: ${data?.language || "(unset — pages declare en)"} (update_site language)`;
}

/** One status line for a `/api/v1/sites/[id]` payload's `mountOrigin`. */
function mountOriginLine(data) {
  return `Mount origin: ${data?.mountOrigin || "(unset — served on its own PageHub host)"} (update_site mountOrigin)`;
}

/**
 * The mount key line. Only an update_site that issued a key prints its value
 * (the PUT returns it once); otherwise it says whether one is set.
 */
function mountKeyLine(data, issued) {
  if (issued && data?.mountKey) {
    return (
      `Mount key: ${data.mountKey}\n` +
      `Set it as PAGEHUB_MOUNT_KEY in the host app's environment (then redeploy it) so PageHub sees each visitor's real IP.`
    );
  }
  if (!data?.mountOrigin) return null;
  return `Mount key: ${data?.mountKey ? "set" : "(none)"} (update_site rotateMountKey: true issues a new one)`;
}

module.exports = {
  crawlLines,
  siteOgImageLine,
  timezoneLine,
  languageLine,
  mountOriginLine,
  mountKeyLine,
};
