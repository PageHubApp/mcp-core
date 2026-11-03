/**
 * Data-source apps (rental tools, calendar links, feeds, shops, Airtable) — wraps `/api/v1/sites/:id/apps*` and a
 * collection's `/sync` (app repo: docs/features/apps.md, docs/action-items/specs/mcp-apps-orders-rentals-tools.md).
 * Keys the user pastes go straight to the connect route, which stores them encrypted; nothing here prints one.
 */

const { apiFetch } = require("../core/api-fetch");
const { activeSiteId, collectionPath } = require("../helpers/collections");

const appsPath = siteId => `/api/v1/sites/${encodeURIComponent(siteId)}/apps`;
const text = t => ({ content: [{ type: "text", text: t }] });

function fmtApp(a) {
  const needs = a.inputs.map(i => `${i.key}${i.secret ? " (secret)" : ""}${i.optional ? " (optional)" : ""}`).join(", ");
  return `• ${a.name} [app: ${a.app}] ${a.kind} — ${needs}${a.allowed ? "" : " (not on this plan)"}`;
}

function fmtConnected(c) {
  const s = c.lastSync;
  const sync = s ? `last sync ${String(s.at).slice(0, 16).replace("T", " ")} ${s.status}${s.error ? `: ${s.error}` : ""}` : "never synced";
  return `• ${c.name} (slug: ${c.slug}, from ${c.sourceType}, rows: ${c.rowCount}) — ${sync}`;
}

module.exports = {
  /** @param {object} args - { id } */
  async list_apps(args = {}) {
    const { apps, connected, calendarLinks } = await apiFetch(appsPath(activeSiteId(args)));
    const links = [...calendarLinks.availability.map(l => ["availability", l]), ...calendarLinks.events.map(l => ["events", l])];
    return text(
      [
        "Apps (connect_app with app + inputs):",
        ...apps.map(fmtApp),
        "",
        connected.length ? "Connected:" : "Nothing connected yet.",
        ...connected.map(fmtConnected),
        ...(links.length ? ["", "Calendar links:", ...links.map(([kind, l]) => `• ${l.name} — ${l.host} [kind: ${kind}, feedId: ${l.id}]`)] : []),
      ].join("\n")
    );
  },

  /** @param {object} args - { id, app, inputs, name?, bookingUrl? } */
  async connect_app(args = {}) {
    const siteId = activeSiteId(args);
    const { app } = args;
    if (!app || typeof app !== "string") throw new Error("app is required: an [app: …] value from list_apps.");
    const inputs = args.inputs && typeof args.inputs === "object" ? args.inputs : {};
    const { apps } = await apiFetch(appsPath(siteId));
    const entry = apps.find(a => a.app === app);
    if (!entry) throw new Error(`No app "${app}". list_apps shows the ones this site can connect.`);
    if (!entry.allowed) throw new Error(`${entry.name} isn't on this site's plan. Upgrading the plan unlocks it.`);

    const body =
      entry.kind === "calendar"
        ? { app, name: args.name ?? inputs.name, url: inputs.url, bookingUrl: args.bookingUrl ?? inputs.bookingUrl }
        : { ...inputs, ...(args.name ? { name: args.name } : {}), ...(args.bookingUrl ? { bookingUrl: args.bookingUrl } : {}) };
    const r = await apiFetch(`${appsPath(siteId)}/${entry.kind === "calendar" ? "calendar-feed" : encodeURIComponent(app)}`, { method: "POST", body });

    const count = r.homes ?? r.records ?? r.count ?? r.found;
    const sync = r.sync ? `First sync: ${r.sync.status}${r.sync.error ? ` (${r.sync.error})` : ""}.` : "";
    return text(
      [
        `${entry.name} connected${r.created ? " (new collection)" : ""}.${count !== undefined ? ` Found ${count}.` : ""} ${sync}`.trim(),
        "Next: list_collections to see its slug, then list_collection_rows.",
      ].join("\n")
    );
  },

  /** @param {object} args - { id, slug } */
  async sync_collection(args = {}) {
    const r = await apiFetch(`${await collectionPath(args)}/sync`, { method: "POST" });
    return text(`Synced "${args.slug}": ${r.status}. Added ${r.rowsAdded}, updated ${r.rowsUpdated}, removed ${r.rowsDeleted}.${r.error ? ` Error: ${r.error}` : ""}`);
  },

  /** @param {object} args - { id, kind, feedId } */
  async remove_calendar_link(args = {}) {
    const siteId = activeSiteId(args);
    if (args.kind !== "availability" && args.kind !== "events") throw new Error('kind must be "availability" or "events" (from list_apps).');
    if (!args.feedId) throw new Error("feedId is required (from list_apps).");
    const qs = new URLSearchParams({ kind: args.kind, feedId: String(args.feedId) });
    await apiFetch(`${appsPath(siteId)}/calendar-feed?${qs}`, { method: "DELETE" });
    return text("Removed. The site stops reading that link, and the rows it filled are gone.");
  },
};
