/**
 * PayPal connection for a site — wraps `/api/v1/sites/:id/paypal`.
 *
 * Two connect modes, each switched on platform-wide: "email" (payments go to the PayPal email the owner gives,
 * no sign-in) and "partner" (the owner signs in to PayPal from a link). The agent only passes along an email the
 * owner typed, never one it guessed.
 */

const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");

function activeSiteId(args) {
  const id = args?.id || getContext().activeSite?.id;
  if (!id) throw new Error("Site id is required (none provided and no active site set).");
  return id;
}

const text = t => ({ content: [{ type: "text", text: t }] });

function describe(s, siteId) {
  if (!s.configured) return "PayPal isn't available on PageHub yet. Payments go through Stripe: stripe_connect.";
  if (s.connected) {
    return s.paymentsReceivable
      ? `PayPal is connected to site ${siteId}: payments go to ${s.payee}. A data-cart="checkout" button with data-cart-gateway="paypal" pays with PayPal.`
      : `PayPal is connected to site ${siteId} (${s.payee}) but can't receive payments yet: the owner finishes setup in PayPal.`;
  }
  const ways = [s.modes?.email && "payeeEmail (the PayPal email the owner gives)", s.modes?.partner && 'mode: "partner" (a PayPal sign-in link)'].filter(Boolean);
  return ways.length
    ? `PayPal isn't connected to site ${siteId}. Connect with ${ways.join(" or ")}.`
    : "PayPal connecting is switched off right now. Payments go through Stripe: stripe_connect.";
}

module.exports = {
  /**
   * Show or set the site's PayPal connection.
   * @param {object} args - { id?, payeeEmail?, mode?, disconnect? }
   */
  async paypal_connect(args = {}) {
    const siteId = activeSiteId(args);
    const path = `/api/v1/sites/${encodeURIComponent(siteId)}/paypal`;
    if (args.disconnect) {
      await apiFetch(path, { method: "DELETE" });
      return text(`PayPal is disconnected from site ${siteId}. Past PayPal orders keep their refunds.`);
    }
    if (args.mode === "partner") {
      const { actionUrl } = await apiFetch(path, { method: "PUT", body: { mode: "partner" } });
      return text(
        `Give the owner this link to sign in to PayPal (only they can finish it):\n${actionUrl}\n\nCall paypal_connect again afterwards to confirm.`
      );
    }
    if (args.payeeEmail) {
      const s = await apiFetch(path, { method: "PUT", body: { mode: "email", payeeEmail: args.payeeEmail } });
      return text(describe(s, siteId));
    }
    return text(describe(await apiFetch(path), siteId));
  },
};
