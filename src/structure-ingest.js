/**
 * Convert hierarchical block structure ({ type, props, children }) to a flat CraftJS node map
 * and attach the root under sectionContainerId (empty section canvas).
 */

const crypto = require('crypto');

const VALID_COMPONENTS = new Set([
  'Audio', 'Background', 'Button', 'ButtonList', 'Container', 'ContainerGroup',
  'Divider', 'Embed', 'Footer', 'Form', 'FormElement', 'Header', 'Image',
  'ImageList', 'Map', 'MapPoint', 'Modal', 'Nav', 'Spacer', 'Text', 'Video',
]);

const CANVAS_COMPONENTS = new Set([
  'Container', 'ContainerGroup', 'Footer', 'Header', 'Nav', 'Form', 'Background', 'Modal',
]);

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

/** Stable per-section+slug prefix so patch steps match apply_kit_block (no Math.random() drift). */
function makeKitInstancePrefix(slug, sectionContainerId) {
  const h = crypto
    .createHash('sha256')
    .update(`${String(sectionContainerId)}\n${String(slug)}`, 'utf8')
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
  if (resolvedName === 'Text' && override.tagName) props.tagName = override.tagName;
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
  if (patch.root) deepMerge(node.props.root || (node.props.root = {}), patch.root);
  if (patch.mobile) deepMerge(node.props.mobile || (node.props.mobile = {}), patch.mobile);
  if (patch.desktop) deepMerge(node.props.desktop || (node.props.desktop = {}), patch.desktop);
  if (patch.props) deepMerge(node.props, patch.props);
}

/**
 * @param {object} structure - { type, props, children? }
 * @param {string} sectionContainerId - existing empty section container id
 * @param {string} slug - block slug (for id prefix)
 * @returns {{ nodes: Record<string, object>, rootId: string }}
 */
function hierarchicalStructureToFlat(structure, sectionContainerId, slug) {
  if (!structure?.type) throw new Error('Block structure must have a root "type".');
  const prefix = makeKitInstancePrefix(slug, sectionContainerId);
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

module.exports = {
  hierarchicalStructureToFlat,
  walkApplyKitOverrides,
  VALID_COMPONENTS,
};
