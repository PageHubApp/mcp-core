/**
 * Mutate a flat CraftJS node map in place, applying a single patch.
 * All shape validation happens in patch/schema.js before reaching here;
 * this module is the pure mutator + per-call arg normalization.
 */

const { twMerge } = require("tailwind-merge");
const { parseMaybeJson, isSameChildIdMultiset, removeClasses } = require("../args");
const { normalizeTypePatch, CANVAS_TYPE_PATCH_COMPONENTS } = require("./schema");
const { getContext } = require("../../context");

const INVALID_ID_HARD_STOP_THRESHOLD = 3;

function nth(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Resolve semantic / hallucinated node ids to real ids using the kit label
 * map stashed on the request context by apply_kit_block.
 *
 * Accepts:
 *   kit_<slug>_<label>            → looked up by label (e.g. "heading", "primary_cta")
 *   kit_<slug>_<semanticTail>     → also tried against component type ("text")
 *   anything starting with the kit slug prefix
 *
 * Returns the real id if found, or null.
 */
function resolveSemanticKitId(flatMap, nodeId) {
  if (!String(nodeId).startsWith("kit_")) return null;
  let ctx;
  try {
    ctx = getContext();
  } catch {
    return null;
  }
  const maps = ctx?._kitLabelMaps;
  if (!maps || typeof maps !== "object") return null;
  // Find the longest matching slug prefix (handles slugs with underscores).
  let bestSlug = null;
  for (const slug of Object.keys(maps)) {
    const prefix = `kit_${String(slug).replace(/-/g, "_")}_`;
    const prefixDash = `kit_${slug}_`;
    if (nodeId.startsWith(prefix) || nodeId.startsWith(prefixDash)) {
      if (!bestSlug || slug.length > bestSlug.length) bestSlug = slug;
    }
  }
  if (!bestSlug) return null;
  const entry = maps[bestSlug];
  if (!entry) return null;
  const prefix = nodeId.startsWith(`kit_${String(bestSlug).replace(/-/g, "_")}_`)
    ? `kit_${String(bestSlug).replace(/-/g, "_")}_`
    : `kit_${bestSlug}_`;
  const tail = nodeId.slice(prefix.length);
  // Real ids end in `_nN` — never try to resolve those here; they should be
  // direct hits in flatMap.
  if (/^n\d+$/.test(tail) || /_n\d+$/.test(tail) || /^[0-9a-f]{6,}_n\d+$/.test(tail)) return null;
  const key = tail
    .toLowerCase()
    .replace(/[\s\-_]+/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  const byLabelHit = entry.byLabel?.[key];
  if (byLabelHit && flatMap[byLabelHit]) return byLabelHit;
  const byTypeHit = entry.byType?.[key];
  if (byTypeHit && flatMap[byTypeHit]) return byTypeHit;
  return null;
}

/** Shallow-merge patch objects into a flat node map entry. */
function applyNodePatches(flatMap, nodeId, patchArgs) {
  const { typePatch, propsPatch, classNamePatch, nodesPatch, unsetProps, unsetClasses } =
    patchArgs;
  // If the model invented a semantic kit id (kit_cta_simple_heading) or
  // otherwise misquoted, try to resolve it from the label map stashed by
  // apply_kit_block. Turns hallucination into a valid shortcut.
  if (!flatMap[nodeId]) {
    const resolved = resolveSemanticKitId(flatMap, nodeId);
    if (resolved) {
      nodeId = resolved;
    }
  }
  if (!flatMap[nodeId]) {
    let hint = "";
    if (String(nodeId).startsWith("kit_")) {
      const similar = Object.keys(flatMap)
        .filter(k => k.startsWith("kit_"))
        .slice(0, 12);
      hint =
        similar.length > 0
          ? ` Known kit_* ids in this map start with: ${similar.join(", ")}. Use ids from the apply_kit_block tool reply, not get_component_schema.`
          : " Use node ids from the latest apply_kit_block tool reply (copy exactly).";
    } else if (String(nodeId).startsWith("lib_")) {
      hint =
        " Use node ids from list_block_nodes for this block slug (copy exactly). Ids are deterministic from the slug.";
    }

    // Per-turn hard stop: agents sometimes get stuck hallucinating semantic
    // ids (kit_cta_simple_heading, kit_cta_simple_text) and retry forever.
    // After N consecutive "Node not found" failures in one turn, throw a
    // terminal error so the agent stops instead of burning credits.
    try {
      const ctx = getContext();
      if (ctx) {
        ctx._invalidIdFailureCount = (ctx._invalidIdFailureCount || 0) + 1;
        if (ctx._invalidIdFailureCount >= INVALID_ID_HARD_STOP_THRESHOLD) {
          throw new Error(
            `Node ${nodeId} not found — and this is the ${ctx._invalidIdFailureCount}${nth(ctx._invalidIdFailureCount)} invalid-id patch this turn. ` +
              `STOP inventing ids. The kit_* ids are only valid when copied EXACTLY from the most recent apply_kit_block reply ` +
              `(format: \`kit_<slug>_<hash>_n<number>\`, e.g. \`kit_cta_simple_82028ff0_n2\`). ` +
              `Semantic ids like \`kit_cta_simple_heading\` do NOT exist. ` +
              `End this turn and tell the user what went wrong.${hint}`
          );
        }
      }
    } catch (inner) {
      if (inner && inner.message && inner.message.startsWith("Node ")) throw inner;
      // getContext missing in some test harnesses — fall through to normal throw.
    }

    throw new Error(`Node ${nodeId} not found.${hint}`);
  }
  const entry = flatMap[nodeId];
  const p = entry.props;
  if (p == null || typeof p !== "object" || Array.isArray(p)) {
    entry.props = {};
  }
  // typePatch — update component type and keep isCanvas aligned with container semantics
  const normalizedTypePatch = normalizeTypePatch(typePatch);
  if (normalizedTypePatch) {
    entry.type = { ...(entry.type || {}), resolvedName: normalizedTypePatch };
    entry.isCanvas = CANVAS_TYPE_PATCH_COMPONENTS.has(normalizedTypePatch);
    if (!Array.isArray(entry.nodes)) entry.nodes = [];
  }
  // className patch — merge Tailwind classes into props.className via twMerge
  if (classNamePatch) {
    const existing = flatMap[nodeId].props.className || "";
    flatMap[nodeId].props.className = twMerge(existing, classNamePatch);
  }
  // Remove specific classes from props.className
  if (Array.isArray(unsetClasses) && unsetClasses.length > 0) {
    flatMap[nodeId].props.className = removeClasses(
      flatMap[nodeId].props.className || "",
      unsetClasses
    );
  }
  // propsPatch — shallow merge non-class props (text, src, href, alt, style, animation, etc.)
  // Deep-merge `root` to preserve existing keys (animation, pattern, activeModifiers, etc.)
  // Guard: propsPatch must be an object, never a string. A string here means parseMaybeJson
  // failed to parse malformed model JSON — spreading a string scatters chars as numeric keys.
  if (propsPatch && typeof propsPatch === "string") {
    throw new Error(
      `propsPatch for node "${nodeId}" is a string (invalid JSON from model). ` +
        `propsPatch must be a JSON object, not a string. Raw value starts with: ${propsPatch.substring(0, 120)}…`
    );
  }
  // Sanitize tagName to prevent corrupted data from crashing createElement
  if (propsPatch && typeof propsPatch.tagName === "string") {
    const t = propsPatch.tagName.split(/[,\s]/)[0].toLowerCase();
    if (/^[a-z][a-z0-6]*$/.test(t)) propsPatch.tagName = t;
    else delete propsPatch.tagName;
  }
  // Guard: `type: "cdn" | "url" | "svg" | "r2"` is the Image-node source
  // discriminator. If the model aims at a Text / Button / anything else, the
  // patch would silently set a meaningless prop and the model believes the
  // swap worked. Reject loudly with the exact fix.
  if (propsPatch && typeof propsPatch.type === "string") {
    const IMAGE_SOURCE_TYPES = new Set(["cdn", "url", "svg", "r2"]);
    const sourceType = propsPatch.type;
    const currentResolved =
      entry?.type?.resolvedName || (normalizedTypePatch ? normalizedTypePatch : null);
    if (IMAGE_SOURCE_TYPES.has(sourceType) && currentResolved !== "Image") {
      throw new Error(
        `propsPatch.type: "${sourceType}" is the Image-node source discriminator, ` +
          `but node "${nodeId}" is a ${currentResolved || "unknown"}. ` +
          `To replace this node with an Image, pass \`typePatch: "Image"\` in the SAME patch ` +
          `(alongside propsPatch: { type: "${sourceType}", src: "<mediaId>", alt: "..." } — ` +
          `use \`src\`, NOT the legacy \`content\` prop). ` +
          `If you want to keep the existing node and add an image elsewhere, use \`add_nodes\` or ` +
          `\`insert_node\` with a new Image child — do not patch a non-Image node's props.type.`
      );
    }
  }
  if (propsPatch) {
    // Deep-merge the typed nested namespaces so targeted updates
    // (e.g. propsPatch: { seo: { title: "X" } }) preserve sibling fields
    // on the existing object. Shallow-merge is fine for flat props.
    const DEEP_MERGE_KEYS = [
      "root",
      "background",
      "overflow",
      "seo",
      "design",
      "inject",
      "relation",
      "richText",
    ];
    const rest = { ...propsPatch };
    for (const key of DEEP_MERGE_KEYS) {
      if (rest[key] && typeof rest[key] === "object" && !Array.isArray(rest[key])) {
        flatMap[nodeId].props[key] = {
          ...(flatMap[nodeId].props[key] || {}),
          ...rest[key],
        };
        delete rest[key];
      }
    }
    flatMap[nodeId].props = { ...flatMap[nodeId].props, ...rest };
  }
  if (nodesPatch) {
    const prevNodes = flatMap[nodeId].nodes;
    if (!isSameChildIdMultiset(prevNodes, nodesPatch)) {
      const prevJson = JSON.stringify(prevNodes || []);
      const nextJson = JSON.stringify(nodesPatch);
      throw new Error(
        `nodesPatch must list the exact same child node ids as currently on "${nodeId}" (reorder only). ` +
          `Existing: ${prevJson}. Received: ${nextJson}. ` +
          `Do not use nodesPatch for design changes, "main areas", or partial lists — use classNamePatch and propsPatch. ` +
          `To add/remove sections use add_nodes / delete_node.`
      );
    }
    flatMap[nodeId].nodes = nodesPatch;
  }
  if (Array.isArray(unsetProps)) {
    for (const k of unsetProps) delete flatMap[nodeId].props[k];
  }
}

/** Normalize raw patch args (parse JSON strings). */
function normalizeNodePatchArgs(raw) {
  return {
    typePatch: parseMaybeJson(raw.typePatch) ?? raw.typePatch,
    propsPatch: parseMaybeJson(raw.propsPatch) ?? raw.propsPatch,
    classNamePatch: typeof raw.classNamePatch === "string" ? raw.classNamePatch : undefined,
    nodesPatch: raw.nodesPatch,
    unsetProps: raw.unsetProps,
    unsetClasses: raw.unsetClasses,
  };
}

module.exports = {
  applyNodePatches,
  normalizeNodePatchArgs,
};
