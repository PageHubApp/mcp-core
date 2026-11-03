/**
 * Money from the app's routes is in minor units (Stripe's): 12000 USD is $120.00, 12000 JPY is ¥12,000. The digit
 * count comes from the currency itself, so yen never shows a hundredth.
 */

function digitsOf(currency) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

/** "$120.00", "¥12,000", "€4.50". An unknown code prints as "12.00 XYZ". */
function formatMoney(amount, currency = "usd") {
  const code = String(currency || "usd").toUpperCase();
  const major = Number(amount || 0) / 10 ** digitsOf(code);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code }).format(major);
  } catch {
    return `${major.toFixed(2)} ${code}`;
  }
}

module.exports = { formatMoney };
