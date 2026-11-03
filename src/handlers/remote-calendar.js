/**
 * Rental dates across a collection's homes — wraps `/api/v1/sites/:id/collections/:colId/{calendar,calendar/close,
 * booking-pushes,claim-feeds}` (app repo: docs/features/entry-claims.md, docs/features/calendar-feeds.md,
 * docs/action-items/specs/mcp-apps-orders-rentals-tools.md). Dates tied to an order are the order's: reopening them is
 * refused by the route; `update_order` `unbook` frees them.
 */

const { apiFetch, normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { collectionPath } = require("../helpers/collections");

const text = t => ({ content: [{ type: "text", text: t }] });
const DONE_PUSH = new Set(["closed", "opened"]);
const STATE_LABEL = { booked: "booked", blocked: "closed by owner", tool_closed: "closed in the rental tool", pending: "being booked" };

/** "2026-11-03 to 2026-11-05 closed by owner [claimId: …] "note"" runs of one state, in date order. */
function dayRuns(days) {
  const runs = [];
  for (const day of Object.keys(days).sort()) {
    const d = days[day];
    if (d.state === "open") continue;
    const last = runs[runs.length - 1];
    const prev = last && new Date(Date.parse(`${last.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    if (last && prev === day && last.state === d.state && last.claimId === d.claimId) last.to = day;
    else runs.push({ from: day, to: day, ...d });
  }
  return runs.map(r => {
    const span = r.from === r.to ? r.from : `${r.from} to ${r.to}`;
    const ids = r.claimId ? ` [claimId: ${r.claimId}]` : r.sessionId ? ` [orderId: ${r.sessionId}]` : "";
    return `  ${span} ${STATE_LABEL[r.state] || r.state}${ids}${r.note ? ` ${JSON.stringify(r.note)}` : ""}`;
  });
}

const feedUrl = path => `${normalizeBaseUrl(getContext().apiBaseUrl) || "https://pagehub.dev"}${path}`;

module.exports = {
  /** @param {object} args - { id, slug, from, to } */
  async get_calendar(args = {}) {
    const base = await collectionPath(args);
    const qs = new URLSearchParams({ from: String(args.from || ""), to: String(args.to || "") });
    const [{ homes, days }, { pushes }] = await Promise.all([apiFetch(`${base}/calendar?${qs}`), apiFetch(`${base}/booking-pushes`)]);
    const lines = [`${args.from} to ${args.to} (days not listed are open):`];
    for (const h of homes) {
      const runs = dayRuns(days[h.rowId] || {});
      lines.push(`• ${h.title} [rowId: ${h.rowId}]${runs.length ? "" : " — all open"}`, ...runs);
    }
    const stuck = pushes.filter(p => !DONE_PUSH.has(p.status));
    if (stuck.length) {
      lines.push("", "Not yet in the rental tool (set_dates retryPushId runs a failed one again):");
      lines.push(...stuck.map(p => `• ${p.home} ${p.dates} — wanted ${p.wanted}, ${p.status}${p.lastError ? `: ${p.lastError}` : ""} [pushId: ${p.id}]`));
    }
    return text(lines.join("\n"));
  },

  /** @param {object} args - { id, slug, close?: { rowIds, from, to, note? }, reopen?: { rowId, claimId }, retryPushId? } */
  async set_dates(args = {}) {
    const given = ["close", "reopen", "retryPushId"].filter(k => args[k] !== undefined);
    if (given.length !== 1) throw new Error("Pass exactly one of close, reopen or retryPushId.");
    const base = await collectionPath(args);

    if (args.retryPushId) {
      await apiFetch(`${base}/booking-pushes`, { method: "POST", body: { pushId: String(args.retryPushId) } });
      return text("Trying again. get_calendar shows how it went.");
    }
    if (args.reopen) {
      const { rowId, claimId } = args.reopen;
      try {
        await apiFetch(`${base}/calendar/close`, { method: "DELETE", body: { rowId, claimId } });
      } catch (e) {
        if (e.status === 409) throw new Error("Those dates belong to an order. update_order with action unbook frees them (it never refunds).");
        throw e;
      }
      return text("Reopened.");
    }
    const { rowIds, from, to, note } = args.close;
    const { results, message } = await apiFetch(`${base}/calendar/close`, { method: "POST", body: { rowIds, from, to, note } });
    const detail = results.map(r =>
      r.state === "closed"
        ? `• ${r.title}: closed ${r.keys.length} day${r.keys.length === 1 ? "" : "s"} [claimId: ${r.claimId}]`
        : r.state === "conflict"
          ? `• ${r.title}: not closed, ${r.conflict.map(c => `${c.key} ${c.pending ? "is being booked" : "is booked"}`).join(", ")}`
          : `• ${r.title}: already closed`
    );
    return text([message, ...detail].join("\n"));
  },

  /** @param {object} args - { id, slug, rowId?, rotate? } */
  async share_calendar_link(args = {}) {
    const base = await collectionPath(args);
    if (!args.rowId) {
      const { homes } = await apiFetch(`${base}/claim-feeds`);
      if (!homes.length) return text("No homes with dates in this collection.");
      return text(homes.map(h => `• ${h.title} [rowId: ${h.rowId}] — ${h.path ? feedUrl(h.path) : "no link yet (call with rowId to make one)"}`).join("\n"));
    }
    if (args.rotate === true && getContext().client === "ai") {
      throw new Error("Changing the link stops the old one working on Airbnb. Do it in the dashboard. Nothing was changed.");
    }
    const { path } = await apiFetch(`${base}/claim-feeds`, { method: "POST", body: { rowId: String(args.rowId), rotate: args.rotate === true } });
    return text(
      [
        feedUrl(path),
        "Paste it into Airbnb, Vrbo or Booking.com where they import another calendar, so dates booked on the site close there too.",
        ...(args.rotate ? ["The old link has stopped working: update it everywhere it was pasted."] : []),
      ].join("\n")
    );
  },
};
