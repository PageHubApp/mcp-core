const SLOT_MAP = { header: "hdr_root", footer: "ftr_root" };

/**
 * Slot-target guardrail: qwen (and friends) read "header" as "top of page" and route
 * heroes / features / CTAs into hdr_root, which clears real header chrome and buries
 * the section inside a layout slot that downstream code assembles differently (the
 * kit also then tends to drop before final save — see AiLog 2026-04-24T15:48 for the
 * "wills balls" case where the hero was applied under hdr_root and vanished from
 * sharedDraft). Auto-recover by routing to `target: "page"` and surfacing a warning
 * in the response so the kit lands somewhere visible instead of throwing — the agent
 * then sees the warning in the tool reply and can correct future calls (see Yury's
 * 2026-05-22 restaurant demo where hero-split → target="header" was rejected and the
 * hero never got placed at all).
 *
 * Returns { slotTarget, slotMismatchWarning }. If the slug shape doesn't match the
 * requested slot, `slotTarget` is cleared (undefined) and a warning string is set.
 */
function resolveSlotTarget(slotTarget, slug) {
  let slotMismatchWarning = null;
  if (slotTarget && SLOT_MAP[slotTarget]) {
    const slugLower = String(slug).toLowerCase();
    const isHeaderSlug = /(^|[-_])(header|nav(bar)?|top[-_]?bar|menu[-_]?bar)(-|$)/.test(
      slugLower
    );
    const isFooterSlug = /(^|[-_])footer(-|$)/.test(slugLower);
    if (slotTarget === "header" && !isHeaderSlug) {
      slotMismatchWarning =
        `Note: requested target "header" but slug "${slug}" doesn't look like a header block (navbars / menu bars). ` +
        `Routed to target: "page" so the kit appears as a page section. ` +
        `For future calls: only use target: "header" for navbar/menu/topbar slugs; everything else should use target: "page" (or omit target).`;
      slotTarget = undefined;
    } else if (slotTarget === "footer" && !isFooterSlug) {
      slotMismatchWarning =
        `Note: requested target "footer" but slug "${slug}" doesn't look like a footer block. ` +
        `Routed to target: "page" so the kit appears as a page section. ` +
        `For future calls: only use target: "footer" for footer-* slugs; everything else should use target: "page" (or omit target).`;
      slotTarget = undefined;
    }
  }
  return { slotTarget, slotMismatchWarning };
}

module.exports = { SLOT_MAP, resolveSlotTarget };
