/**
 * Convert hierarchical block structure ({ type, props, children }) to a flat CraftJS node map
 * and attach the root under sectionContainerId (empty section canvas).
 */

const crypto = require("crypto");
const { VALID_COMPONENTS, CANVAS_COMPONENTS } = require("./node-utils");

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Craft expects every flat-map node to have a plain object `props`. */
function ensureNodeProps(node) {
  if (!node || typeof node !== "object") return;
  const p = node.props;
  if (p == null || typeof p !== "object" || Array.isArray(p)) {
    node.props = {};
  }
}

function deepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const k of Object.keys(source)) {
    const sv = source[k];
    const tv = target[k];
    if (
      sv &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      deepMerge(tv, sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}

function slugify(s) {
  return (
    String(s || "kit")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "kit"
  );
}

/**
 * Stable per-parent+slug prefix so one apply_kit_block run is deterministic.
 * Optional idSalt breaks collisions when the same block is applied again under the same parent.
 */
function makeKitInstancePrefix(slug, sectionContainerId, idSalt = "") {
  const h = crypto
    .createHash("sha256")
    .update(`${String(sectionContainerId)}\n${String(slug)}\n${String(idSalt)}`, "utf8")
    .digest("hex")
    .slice(0, 8);
  return `kit_${slugify(slug)}_${h}`;
}

function normalizeTemplateProps(props, resolvedName) {
  const p = deepClone(props || {});
  if (resolvedName === "FormElement") {
    if (p.fieldType && !p.type) p.type = p.fieldType;
    if (p.fieldName && !p.name) p.name = p.fieldName;
    delete p.fieldType;
    delete p.fieldName;
  }
  if (p.canDelete === undefined) p.canDelete = true;
  if (p.canEditName === undefined) p.canEditName = true;
  return p;
}

function applyContentOverride(node, resolvedName, override) {
  if (!override || typeof override !== "object") return;
  ensureNodeProps(node);
  const props = node.props;
  if (resolvedName === "Text" && override.text != null) props.text = override.text;
  if (resolvedName === "Text" && override.tagName) {
    const t = String(override.tagName).split(/[,\s]/)[0].toLowerCase();
    if (/^[a-z][a-z0-6]*$/.test(t)) props.tagName = t;
  }
  if (resolvedName === "Button") {
    if (override.text != null) props.text = override.text;
    if (override.url != null) props.url = override.url;
    if (override.icon) props.icon = { ...props.icon, ...override.icon };
  }
  if (resolvedName === "Image") {
    if (override.src != null) props.src = override.src;
    // Legacy compat: accept override.content too
    if (override.content != null && override.src == null) props.src = override.content;
    if (override.alt != null) props.alt = override.alt;
    if (override.type) props.type = override.type;
  }
  if (resolvedName === "FormElement") {
    if (override.placeholder != null) props.placeholder = override.placeholder;
    if (override.type) props.type = override.type;
    if (override.name) props.name = override.name;
    if (override.required != null) props.required = override.required;
  }
  if (resolvedName === "Form") {
    if (override.formName != null) props.formName = override.formName;
    if (override.formType != null) props.formType = override.formType;
    if (override.submissionType != null) props.submissionType = override.submissionType;
    if (override.mailto != null) props.mailto = override.mailto;
  }
}

function applyPropOverride(node, patch) {
  if (!patch || typeof patch !== "object") return;
  ensureNodeProps(node);
  if (patch.className) {
    if (patch.replaceClassName) {
      // Full replacement — use when the block's default classes conflict (e.g. btn-ghost vs btn-circle)
      node.props.className = patch.className;
    } else {
      // Default: merge via tailwind-merge
      let twMerge;
      try {
        twMerge = require("tailwind-merge").twMerge;
      } catch {
        twMerge = (a, b) => `${a} ${b}`.trim();
      }
      node.props.className = twMerge(node.props.className || "", patch.className);
    }
  }
  // Non-class props
  if (patch.props) deepMerge(node.props, patch.props);
}

/**
 * @param {object} structure - { type, props, children? }
 * @param {string} sectionContainerId - existing empty section container id
 * @param {string} slug - block slug (for id prefix)
 * @param {object} [sourceMeta] - provenance metadata stamped on root node's custom.source
 * @param {string} [idSalt] - optional extra entropy for kit_* ids (same slug + parent twice)
 * @returns {{ nodes: Record<string, object>, rootId: string }}
 */
function hierarchicalStructureToFlat(structure, sectionContainerId, slug, sourceMeta, idSalt = "") {
  if (!structure?.type) throw new Error('Block structure must have a root "type".');
  const prefix = makeKitInstancePrefix(slug, sectionContainerId, idSalt);
  let seq = 0;
  const nodes = {};

  function walk(s, parentId, parentIsExternal) {
    const resolvedName = s.type;
    if (!VALID_COMPONENTS.has(resolvedName)) {
      throw new Error(`Unsupported component type in block structure: "${resolvedName}"`);
    }
    const id = `${prefix}_n${seq++}`;
    const props = normalizeTemplateProps(s.props || {}, resolvedName);
    const customCopy = props.custom ? { ...props.custom } : undefined;
    if (props.custom) delete props.custom;
    const node = {
      type: { resolvedName },
      isCanvas: CANVAS_COMPONENTS.has(resolvedName),
      hidden: false,
      props,
      displayName: resolvedName,
      custom: customCopy || {},
      parent: parentId,
      nodes: [],
      linkedNodes: {},
    };
    nodes[id] = node;
    if (!parentIsExternal && parentId && nodes[parentId]) {
      nodes[parentId].nodes.push(id);
    }
    for (const ch of s.children || []) {
      walk(ch, id, false);
    }
    return id;
  }

  const rootId = walk(structure, sectionContainerId, true);
  nodes[rootId].parent = sectionContainerId;
  if (sourceMeta) {
    nodes[rootId].custom = { ...nodes[rootId].custom, source: sourceMeta };
  }
  return { nodes, rootId };
}

/**
 * Walk the kit node tree and apply content/prop overrides by displayName.
 *
 * Overrides are keyed by displayName. When a block has **repeated** nodes with the
 * same displayName (e.g. three "Title" nodes in a 3-pillar grid), the override value
 * can be an **array** — each matching node consumes the next element in DFS order.
 *
 * Examples:
 *   { "Heading": { "text": "What We Do" } }              — single override
 *   { "Title": [{ "text": "SEO" }, { "text": "PPC" }] }  — array for repeated nodes
 */
// Fuzzy-match override keys to displayNames. Agents often pass close-but-not-exact
// labels ("Description" for "Subhead", "Brand Name" for "Brand", "Tagline" for
// "About blurb", "Feature 1 Title" for "Title"). Without aliasing, every miss
// silently no-ops and the agent has to follow up with a corrective patch_site_bulk.
const OVERRIDE_ALIAS_GROUPS = [
  ["heading", "title", "headline", "head"],
  ["subhead", "subheading", "subtitle", "description", "desc", "body", "blurb", "tagline", "intro", "lede"],
  ["eyebrow", "kicker", "label", "badge", "pill"],
  ["primarycta", "ctaprimary", "primarybutton", "buttonprimary", "ctaone", "cta1", "cta"],
  ["secondarycta", "ctasecondary", "secondarybutton", "buttonsecondary", "ctatwo", "cta2"],
  ["brand", "brandname", "logo", "logotext", "company", "companyname"],
  ["copyright", "copyrighttext", "legaltext", "footnote"],
  ["image", "img", "photo", "picture", "hero image", "heroimage"],
];

function normalizeLabel(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function stripIndexSuffix(s) {
  // "Feature 1 Title" -> "Feature Title", "Title 2" -> "Title", "Pillar 3 Body" -> "Pillar Body"
  return String(s || "")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAliasIndex() {
  const map = new Map(); // normalized -> Set(synonyms normalized)
  for (const group of OVERRIDE_ALIAS_GROUPS) {
    const normGroup = group.map(normalizeLabel);
    const set = new Set(normGroup);
    for (const n of normGroup) {
      const existing = map.get(n) || new Set();
      for (const s of set) existing.add(s);
      map.set(n, existing);
    }
  }
  return map;
}

const ALIAS_INDEX = buildAliasIndex();

/**
 * Resolve an override key to an actual node displayName.
 * Returns the matched displayName, or null if no candidate is good enough.
 * Strategy (highest precedence first):
 *   1. Exact match
 *   2. Normalized exact (case + non-alnum stripped)
 *   3. Normalized exact after stripping numeric suffixes ("Feature 1 Title" → "Feature Title")
 *   4. Synonym-expanded normalized match
 *   5. Substring match on normalized form (only if unambiguous)
 */
function resolveOverrideKey(key, allLabels) {
  if (allLabels.has(key)) return key;
  const labelArr = [...allLabels];
  const normToLabel = new Map();
  for (const l of labelArr) {
    const n = normalizeLabel(l);
    if (!normToLabel.has(n)) normToLabel.set(n, l);
  }
  const keyNorm = normalizeLabel(key);
  if (normToLabel.has(keyNorm)) return normToLabel.get(keyNorm);

  const keyNormStripped = normalizeLabel(stripIndexSuffix(key));
  if (keyNormStripped !== keyNorm && normToLabel.has(keyNormStripped)) {
    return normToLabel.get(keyNormStripped);
  }

  const synonyms = ALIAS_INDEX.get(keyNorm) || ALIAS_INDEX.get(keyNormStripped);
  if (synonyms) {
    for (const syn of synonyms) {
      if (normToLabel.has(syn)) return normToLabel.get(syn);
    }
    // Try labels whose normalized form contains a synonym (e.g. "About blurb" → "aboutblurb" contains "blurb")
    for (const syn of synonyms) {
      const hits = labelArr.filter(l => normalizeLabel(l).includes(syn));
      if (hits.length === 1) return hits[0];
    }
  }

  // Last resort: unambiguous substring match
  const subHits = labelArr.filter(l => {
    const n = normalizeLabel(l);
    return n.includes(keyNorm) || keyNorm.includes(n);
  });
  if (subHits.length === 1) return subHits[0];
  return null;
}

function walkApplyKitOverrides(nodes, rootId, contentOverrides, propOverrides) {
  // Collect all displayNames first so we can resolve override keys to actual labels.
  const allLabels = new Set();
  const visitLabels = id => {
    const node = nodes[id];
    if (!node) return;
    if (node.custom?.displayName) allLabels.add(node.custom.displayName);
    for (const c of node.nodes || []) visitLabels(c);
  };
  visitLabels(rootId);

  // Pre-resolve override keys to actual displayNames via fuzzy match.
  // Multiple keys may resolve to the same label — last wins (warn).
  const aliasWarnings = [];
  const resolveOverrides = overrides => {
    if (!overrides) return { resolved: null, hits: [] };
    const resolved = {};
    const hits = [];
    for (const [key, value] of Object.entries(overrides)) {
      const matched = resolveOverrideKey(key, allLabels);
      if (matched) {
        if (resolved[matched] != null && key !== matched) {
          aliasWarnings.push(
            `override "${key}" resolved to "${matched}" but "${matched}" already had a value — last write wins`
          );
        }
        resolved[matched] = value;
        if (key !== matched) hits.push({ from: key, to: matched });
      } else {
        resolved[key] = value; // keep original so the unmatched-key warning fires below
      }
    }
    return { resolved, hits };
  };

  const co = resolveOverrides(contentOverrides);
  const po = resolveOverrides(propOverrides);
  const resolvedContent = co.resolved;
  const resolvedProps = po.resolved;

  // Track consumption index for array-valued overrides
  const coIndex = {};
  const poIndex = {};

  const visit = id => {
    const node = nodes[id];
    if (!node) return;
    const label = node.custom?.displayName;

    if (label && resolvedContent && resolvedContent[label] != null) {
      const raw = resolvedContent[label];
      if (Array.isArray(raw)) {
        const idx = coIndex[label] || 0;
        if (idx < raw.length) {
          applyContentOverride(node, node.type.resolvedName, raw[idx]);
        }
        coIndex[label] = idx + 1;
      } else {
        applyContentOverride(node, node.type.resolvedName, raw);
      }
    }

    if (label && resolvedProps && resolvedProps[label] != null) {
      const raw = resolvedProps[label];
      if (Array.isArray(raw)) {
        const idx = poIndex[label] || 0;
        if (idx < raw.length) {
          applyPropOverride(node, raw[idx]);
        }
        poIndex[label] = idx + 1;
      } else {
        applyPropOverride(node, raw);
      }
    }

    for (const c of node.nodes || []) visit(c);
  };
  visit(rootId);

  // Report unmatched override keys — these silently fail otherwise
  const warnings = [];
  if (resolvedContent) {
    for (const key of Object.keys(resolvedContent)) {
      if (!allLabels.has(key)) {
        warnings.push(
          `contentOverride "${key}" did not match any node (available: ${[...allLabels].join(", ") || "none — block has no displayName labels"})`
        );
      }
    }
  }
  if (resolvedProps) {
    for (const key of Object.keys(resolvedProps)) {
      if (!allLabels.has(key)) {
        warnings.push(`propOverride "${key}" did not match any node`);
      }
    }
  }
  // Surface alias hits as informational notes — helps the agent learn the actual labels.
  if (co.hits.length || po.hits.length) {
    const all = [...co.hits, ...po.hits];
    warnings.push(
      `override key aliases applied: ${all.map(h => `"${h.from}"→"${h.to}"`).join(", ")}`
    );
  }
  for (const w of aliasWarnings) warnings.push(w);
  return warnings;
}

/** Stable prefix for library block patching (same slug always yields same lib_* ids). */
function makeLibraryInstancePrefix(slug) {
  const h = crypto
    .createHash("sha256")
    .update(`library-block\n${String(slug)}`, "utf8")
    .digest("hex")
    .slice(0, 8);
  return `lib_${slugify(slug)}_${h}`;
}

/**
 * Flatten stored hierarchical block structure for MCP patching (deterministic node ids).
 * @param {object} structure - { type, props, children? }
 * @param {string} slug - Block slug (use the same string as list_block_nodes / get_block)
 * @returns {{ nodes: Record<string, object>, rootId: string }}
 */
function hierarchicalLibraryToFlat(structure, slug) {
  if (!structure?.type) throw new Error('Block structure must have a root "type".');
  const prefix = makeLibraryInstancePrefix(slug);
  let seq = 0;
  const nodes = {};

  function walk(s, parentId, parentIsExternal) {
    const resolvedName = s.type;
    if (!VALID_COMPONENTS.has(resolvedName)) {
      throw new Error(`Unsupported component type in block structure: "${resolvedName}"`);
    }
    const id = `${prefix}_n${seq++}`;
    const props = normalizeTemplateProps(s.props || {}, resolvedName);
    const customCopy = props.custom ? { ...props.custom } : undefined;
    if (props.custom) delete props.custom;
    const node = {
      type: { resolvedName },
      isCanvas: CANVAS_COMPONENTS.has(resolvedName),
      hidden: false,
      props,
      displayName: resolvedName,
      custom: customCopy || {},
      parent: parentId,
      nodes: [],
      linkedNodes: {},
    };
    nodes[id] = node;
    if (!parentIsExternal && parentId && nodes[parentId]) {
      nodes[parentId].nodes.push(id);
    }
    for (const ch of s.children || []) {
      walk(ch, id, false);
    }
    return id;
  }

  const rootId = walk(structure, null, true);
  nodes[rootId].parent = null;
  return { nodes, rootId };
}

/**
 * Convert patched flat map back to hierarchical block structure for PUT /api/v1/components.
 */
function flatLibraryToHierarchical(flatMap, rootId) {
  if (!flatMap || !flatMap[rootId]) {
    throw new Error("Invalid flat map or missing rootId after patch.");
  }

  function toHier(id) {
    const n = flatMap[id];
    if (!n || !n.type?.resolvedName) {
      throw new Error(`Missing or invalid node "${id}" while rebuilding hierarchy.`);
    }
    const props = deepClone(n.props || {});
    const custom =
      n.custom && typeof n.custom === "object" && Object.keys(n.custom).length
        ? { ...n.custom }
        : null;
    if (custom) {
      props.custom = { ...(props.custom || {}), ...custom };
    }
    const childIds = n.nodes || [];
    const children = childIds.map(cid => toHier(cid));
    const out = { type: n.type.resolvedName, props };
    if (children.length) out.children = children;
    return out;
  }

  return toHier(rootId);
}

/** DFS node ids from root (stable human order for manifests). */
function collectLibraryFlatIdsDfs(flatMap, rootId) {
  const out = [];
  const walk = id => {
    if (!flatMap[id]) return;
    out.push(id);
    for (const c of flatMap[id].nodes || []) walk(c);
  };
  walk(rootId);
  return out;
}

/**
 * Text manifest of lib_* node ids for agents (same idea as apply_kit_block kit_* list).
 */
function formatBlockNodeManifest(flatMap, rootId, slug, maxLines = 120) {
  const ids = collectLibraryFlatIdsDfs(flatMap, rootId);
  const head = ids.slice(0, maxLines);
  const lines = head.map(id => {
    const n = flatMap[id];
    const rn = n?.type?.resolvedName || "?";
    const label = n?.custom?.displayName ? ` label="${n.custom.displayName}"` : "";
    return `  ${id} | ${rn}${label}`;
  });
  const tail =
    ids.length > maxLines ? `\n  …and ${ids.length - maxLines} more (same \`lib_…\` prefix)` : "";
  return (
    `Block slug: \`${slug}\`\n` +
    `Library root id: \`${rootId}\`\n` +
    `Use these node ids in patch_block / patch_block_bulk (copy exactly):\n` +
    `${lines.join("\n")}${tail}`
  );
}

/**
 * Stamp provenance metadata on a flat node map's ROOT node.
 * @param {Record<string, object>} flatMap - the flat CraftJS node map (mutated in place)
 * @param {object} meta - { template, version, ... } to store under ROOT.custom.source
 */
function stampRootSource(flatMap, meta) {
  if (!flatMap?.ROOT || !meta) return;
  const root = flatMap.ROOT;
  root.custom = { ...(root.custom || {}), source: meta };
}

module.exports = {
  hierarchicalStructureToFlat,
  hierarchicalLibraryToFlat,
  flatLibraryToHierarchical,
  formatBlockNodeManifest,
  walkApplyKitOverrides,
  stampRootSource,
};
