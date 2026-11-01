/**
 * Promo codes on the site's own Stripe account — wraps `/api/v1/sites/:id/promo-codes`.
 */

const { apiFetch } = require("../core/api-fetch");

function path(args) {
  if (!args.siteId) throw new Error("siteId is required.");
  return `/api/v1/sites/${encodeURIComponent(args.siteId)}/promo-codes`;
}

function fmt(p) {
  const off = p.percentOff ? `${p.percentOff}% off` : `${(p.amountOff / 100).toFixed(2)} ${String(p.currency).toUpperCase()} off`;
  const uses = `used ${p.timesRedeemed}${p.maxRedemptions ? ` of ${p.maxRedemptions}` : ""}`;
  const ends = p.expiresAt ? `, ends ${p.expiresAt.slice(0, 10)}` : "";
  return `• ${p.code} [promoCodeId: ${p.id}] — ${off}, ${uses}${ends}${p.active ? "" : " (OFF)"}`;
}

module.exports = {
  /** @param {object} args - { siteId } */
  async list_promo_codes(args = {}) {
    const { promoCodes } = await apiFetch(path(args));
    return { content: [{ type: "text", text: promoCodes.length ? promoCodes.map(fmt).join("\n") : "No promo codes on this site." }] };
  },

  /**
   * Make a code, or turn one off or on.
   * @param {object} args - { siteId, code, percentOff | amountOff (+ currency), maxRedemptions?, expiresAt? } or { siteId, promoCodeId, active }
   */
  async set_promo_code(args = {}) {
    const url = path(args);
    if (args.promoCodeId) {
      if (typeof args.active !== "boolean") throw new Error("active (true or false) is required with promoCodeId.");
      const { promoCode } = await apiFetch(url, { method: "PATCH", body: { id: args.promoCodeId, active: args.active } });
      return { content: [{ type: "text", text: fmt(promoCode) }] };
    }
    const { code, percentOff, amountOff, currency, maxRedemptions, expiresAt } = args;
    const { promoCode } = await apiFetch(url, { method: "POST", body: { code, percentOff, amountOff, currency, maxRedemptions, expiresAt } });
    return { content: [{ type: "text", text: `Created.\n${fmt(promoCode)}` }] };
  },
};
