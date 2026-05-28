// Reject hand-typed Unsplash photo URLs in patches. The agent has find_image
// for verified URLs, but it routinely guesses photo IDs from training data
// and ships 404s. Better to fail loudly than render a broken hero.
const HAND_TYPED_UNSPLASH_RE = /https?:\/\/images\.unsplash\.com\/photo-[a-z0-9-]+/i;

function collectUnsplashSrcViolations(patch, nodeId) {
  const hits = [];
  const visit = (val, path) => {
    if (val == null) return;
    if (typeof val === "string") {
      if (HAND_TYPED_UNSPLASH_RE.test(val)) hits.push({ nodeId, path, value: val });
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }
    if (typeof val === "object") {
      for (const k of Object.keys(val)) visit(val[k], path ? `${path}.${k}` : k);
    }
  };
  if (patch?.propsPatch) visit(patch.propsPatch, "propsPatch");
  return hits;
}

// `content` is the deprecated alias for `src` on Image nodes. Reject any patch
// that writes a non-empty `content` value — the canonical field is `src`. The
// renderer still falls back `src ?? content` so legacy saved data keeps
// rendering, but no new write should land on `content`.
//
// History: `Image` used to ship both `props.src` and `props.content`, and the
// dual-field shadow caused recurring "I patched the image and nothing
// changed" bugs (see
// `.claude/known-issues/image-src-content-shadowing.md`). The fix collapses
// to `src`; this guard prevents regressions.
function assertNoImageSrcContentConflict(flat, nodeIds) {
  const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
  for (const id of ids) {
    if (!id) continue;
    const node = flat?.[id];
    if (!node || node.type?.resolvedName !== "Image") continue;
    const props = node.props || {};
    const content = props.content;
    if (content == null) continue;
    if (typeof content === "string" && content.trim() === "") continue;
    throw new Error(
      `Image node "${id}" was written with deprecated prop "content" — ` +
        `use "src" instead. The renderer falls back to "content" only for ` +
        `unmigrated saved data. Update the patch to write \`src\` and pass ` +
        `\`unsetProps: ["content"]\` to clear any legacy value.`
    );
  }
}

function unsplashViolationMessage(hits) {
  const lines = hits.slice(0, 8).map(h => `  - ${h.nodeId}.${h.path}: ${h.value.slice(0, 100)}`);
  return (
    `Error: hand-typed images.unsplash.com URL(s) rejected — these IDs are usually invented and 404 in production.\n` +
    `${lines.join("\n")}\n\n` +
    `Call find_image({ q: "<descriptive query>", category: "<hero|product|background|avatar|...>" }) and use the URL it returns. ` +
    `Do NOT guess Unsplash photo-<id>s; only URLs returned by find_image are verified.`
  );
}

module.exports = {
  HAND_TYPED_UNSPLASH_RE,
  collectUnsplashSrcViolations,
  assertNoImageSrcContentConflict,
  unsplashViolationMessage,
};
