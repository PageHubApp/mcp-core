/**
 * Merge a block's `modifiers` object into the site's ROOT.props.modifiers.
 *
 * Shape:
 *   blockModifiers = { Text: [{ name, classes, requires }, ...], Container: [...] }
 *
 * Upserts by name — a newer def with the same name overwrites the stale one.
 * Without this, shortcut class names (section-heading, body-text, eyebrow, etc.)
 * reference definitions that never reach the site and render as dead strings.
 */
function mergeBlockModifiersIntoRoot(flat, blockModifiers) {
  if (!blockModifiers || typeof blockModifiers !== "object") return;
  const rootNode = flat.ROOT || flat.root;
  if (!rootNode) return;
  const rootProps = rootNode.props || rootNode;
  if (!rootProps.modifiers) rootProps.modifiers = {};

  for (const [typeName, mods] of Object.entries(blockModifiers)) {
    if (!Array.isArray(mods)) continue;
    if (!rootProps.modifiers[typeName]) rootProps.modifiers[typeName] = [];
    const bucket = rootProps.modifiers[typeName];
    for (const mod of mods) {
      if (!mod?.name) continue;
      const idx = bucket.findIndex(m => m?.name === mod.name);
      if (idx >= 0) bucket[idx] = mod;
      else bucket.push(mod);
    }
  }
}

module.exports = { mergeBlockModifiersIntoRoot };
