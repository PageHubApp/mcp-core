// Canonical block-library categories. Mirror of `components/marketing/blocks/categories.ts`
// (the app-side source of truth) so the MCP package can constrain tool inputs
// without importing TS. If the app-side list changes, update both.
const CATEGORIES = [
  "hero",
  "features",
  "content",
  "testimonials",
  "team",
  "pricing",
  "newsletter",
  "contact",
  "cta",
  "faq",
  "commerce",
  "social-proof",
  "navigation",
  "interactive",
  "stripe",
];

module.exports = { CATEGORIES };
