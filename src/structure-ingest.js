/**
 * Convert hierarchical block structure ({ type, props, children }) to a flat CraftJS node map
 * and attach the root under sectionContainerId (empty section canvas).
 */

const crypto = require('crypto');
const { VALID_COMPONENTS, CANVAS_COMPONENTS } = require('./node-utils');

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const k of Object.keys(source)) {
    const sv = source[k];
    const tv = target[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      deepMerge(tv, sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}

function slugify(s) {
  return String(s || 'kit')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'kit';
}

/**
 * Stable per-parent+slug prefix so one apply_kit_block run is deterministic.
 * Optional idSalt breaks collisions when the same block is applied again under the same parent.
 */
function makeKitInstancePrefix(slug, sectionContainerId, idSalt = '') {
  const h = crypto
    .createHash('sha256')
    .update(`${String(sectionContainerId)}\n${String(slug)}\n${String(idSalt)}`, 'utf8')
    .digest('hex')
    .slice(0, 8);
  return `kit_${slugify(slug)}_${h}`;
}

function normalizeTemplateProps(props, resolvedName) {
  const p = deepClone(props || {});
  if (resolvedName === 'FormElement') {
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
  if (!override || typeof override !== 'object') return;
  const props = node.props;
  if (resolvedName === 'Text' && override.text != null) props.text = override.text;
  if (resolvedName === 'Text' && override.tagName) {
    const t = String(override.tagName).split(/[,\s]/)[0].toLowerCase();
    if (/^[a-z][a-z0-6]*$/.test(t)) props.tagName = t;
  }
  if (resolvedName === 'Button') {
    if (override.text != null) props.text = override.text;
    if (override.url != null) props.url = override.url;
    if (override.icon) props.icon = { ...props.icon, ...override.icon };
  }
  if (resolvedName === 'Image') {
    if (override.content != null) props.content = override.content;
    if (override.alt != null) props.alt = override.alt;
    if (override.type) props.type = override.type;
    if (override.src != null) props.src = override.src;
  }
  if (resolvedName === 'FormElement') {
    if (override.placeholder != null) props.placeholder = override.placeholder;
    if (override.type) props.type = override.type;
    if (override.name) props.name = override.name;
    if (override.required != null) props.required = override.required;
  }
  if (resolvedName === 'Form') {
    if (override.formName != null) props.formName = override.formName;
    if (override.formType != null) props.formType = override.formType;
    if (override.submissionType != null) props.submissionType = override.submissionType;
    if (override.mailto != null) props.mailto = override.mailto;
  }
}

function applyPropOverride(node, patch) {
  if (!patch || typeof patch !== 'object') return;
  // New className-based patching
  if (patch.className) {
    let twMerge;
    try { twMerge = require('tailwind-merge').twMerge; } catch { twMerge = (a, b) => `${a} ${b}`.trim(); }
    node.props.className = twMerge(node.props.className || '', patch.className);
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
function hierarchicalStructureToFlat(structure, sectionContainerId, slug, sourceMeta, idSalt = '') {
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

function walkApplyKitOverrides(nodes, rootId, contentOverrides, propOverrides) {
  const visit = (id) => {
    const node = nodes[id];
    if (!node) return;
    const label = node.custom?.displayName;
    if (label && contentOverrides && contentOverrides[label]) {
      applyContentOverride(node, node.type.resolvedName, contentOverrides[label]);
    }
    if (label && propOverrides && propOverrides[label]) {
      applyPropOverride(node, propOverrides[label]);
    }
    for (const c of node.nodes || []) visit(c);
  };
  visit(rootId);
}

/** Stable prefix for library block patching (same slug always yields same lib_* ids). */
function makeLibraryInstancePrefix(slug) {
  const h = crypto
    .createHash('sha256')
    .update(`library-block\n${String(slug)}`, 'utf8')
    .digest('hex')
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
    throw new Error('Invalid flat map or missing rootId after patch.');
  }

  function toHier(id) {
    const n = flatMap[id];
    if (!n || !n.type?.resolvedName) {
      throw new Error(`Missing or invalid node "${id}" while rebuilding hierarchy.`);
    }
    const props = deepClone(n.props || {});
    const custom = n.custom && typeof n.custom === 'object' && Object.keys(n.custom).length ? { ...n.custom } : null;
    if (custom) {
      props.custom = { ...(props.custom || {}), ...custom };
    }
    const childIds = n.nodes || [];
    const children = childIds.map((cid) => toHier(cid));
    const out = { type: n.type.resolvedName, props };
    if (children.length) out.children = children;
    return out;
  }

  return toHier(rootId);
}

/** DFS node ids from root (stable human order for manifests). */
function collectLibraryFlatIdsDfs(flatMap, rootId) {
  const out = [];
  const walk = (id) => {
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
  const lines = head.map((id) => {
    const n = flatMap[id];
    const rn = n?.type?.resolvedName || '?';
    const label = n?.custom?.displayName ? ` label="${n.custom.displayName}"` : '';
    return `  ${id} | ${rn}${label}`;
  });
  const tail = ids.length > maxLines ? `\n  …and ${ids.length - maxLines} more (same \`lib_…\` prefix)` : '';
  return (
    `Block slug: \`${slug}\`\n` +
    `Library root id: \`${rootId}\`\n` +
    `Use these node ids in patch_block / patch_block_bulk (copy exactly):\n` +
    `${lines.join('\n')}${tail}`
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
