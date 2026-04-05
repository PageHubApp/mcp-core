const { twMerge } = require('tailwind-merge');
const { apiFetch } = require('../api-fetch');
const {
  parseMaybeJson, applyNodePatches,
  fetchTarget, saveTarget,
  extractImageUrls, validateImageUrls, collectAllImageUrls,
} = require('../helpers');
const { getContext } = require('../context');

function mergeNodeClassName(prev, ...parts) {
  return twMerge(
    typeof prev === 'string' ? prev : '',
    ...parts.filter(p => typeof p === 'string' && p.trim())
  );
}

const PROTECTED_IDS = ['ROOT', 'page_home'];

module.exports = {
  async update_node(args) {
    const { nodeId, ...patches } = args;
    const { targetId, targetType, flat } = await fetchTarget(args);
    const patchedProps = patches.propsPatch ? parseMaybeJson(patches.propsPatch) : {};
    const imgUrls = [];
    if (patchedProps?.content && typeof patchedProps.content === 'string' && patchedProps.content.startsWith('http')) {
      imgUrls.push(patchedProps.content);
    }
    if (patchedProps?.backgroundImage && typeof patchedProps.backgroundImage === 'string' && patchedProps.backgroundImage.startsWith('http')) {
      imgUrls.push(patchedProps.backgroundImage);
    }
    if (imgUrls.length > 0) {
      const failures = await validateImageUrls(imgUrls);
      if (failures.length > 0) {
        const msg = failures.map(f => `  ${f.url} → ${f.status}`).join('\n');
        throw new Error(`Image validation failed — these URLs are broken:\n${msg}\n\nFix the URLs and try again.`);
      }
    }
    applyNodePatches(flat, nodeId, patches);
    const result = await saveTarget(targetId, targetType, flat);
    const label = targetType === 'template' ? `Node ${nodeId} updated in template "${targetId}".` : `Node ${nodeId} updated.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },

  async delete_node(args) {
    const { nodeId } = args;
    if (PROTECTED_IDS.includes(nodeId)) throw new Error(`Cannot delete structural node: ${nodeId}`);
    const ctx = getContext();
    // In draftMode, operate on _pendingFlatMap if available; otherwise fetch live content
    let flat, targetId, targetType;
    if (ctx.draftMode && ctx._pendingFlatMap) {
      flat = JSON.parse(JSON.stringify(ctx._pendingFlatMap));
      const target = require('../helpers').getActiveTarget(args);
      targetId = target.id;
      targetType = target.type;
    } else {
      ({ targetId, targetType, flat } = await fetchTarget(args));
    }
    if (!flat[nodeId]) throw new Error(`Node ${nodeId} not found`);
    const parentId = flat[nodeId].parent;
    if (parentId && flat[parentId]) {
      flat[parentId].nodes = (flat[parentId].nodes || []).filter(id => id !== nodeId);
    }
    const deleteSubtree = (id) => {
      const node = flat[id];
      if (!node) return;
      for (const child of [...(node.nodes || [])]) deleteSubtree(child);
      delete flat[id];
    };
    deleteSubtree(nodeId);
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      return { content: [{ type: 'text', text: `Node ${nodeId} (and descendants) deleted.` }] };
    }
    const result = await saveTarget(targetId, targetType, flat);
    const label = targetType === 'template' ? `Node ${nodeId} (and descendants) deleted from template "${targetId}".` : `Node ${nodeId} (and descendants) deleted.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },

  async insert_node(args) {
    const { nodeId, parentId, position, node } = args;
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (flat[nodeId]) throw new Error(`Node ID "${nodeId}" already exists. Use a unique ID.`);
    if (!flat[parentId]) throw new Error(`Parent node "${parentId}" not found.`);
    const nodeDef = parseMaybeJson(node) || node;
    nodeDef.parent = parentId;
    if (!nodeDef.linkedNodes) nodeDef.linkedNodes = {};
    if (!nodeDef.nodes) nodeDef.nodes = [];
    if (!nodeDef.hidden) nodeDef.hidden = false;
    if (!nodeDef.displayName && nodeDef.type?.resolvedName) nodeDef.displayName = nodeDef.type.resolvedName;
    const imgUrls = extractImageUrls(nodeDef.props, nodeDef.type?.resolvedName);
    if (imgUrls.length > 0) {
      const failures = await validateImageUrls(imgUrls);
      if (failures.length > 0) {
        const msg = failures.map(f => `  ${f.url} → ${f.status}`).join('\n');
        throw new Error(`Image validation failed — these URLs are broken:\n${msg}\n\nFix the URLs and try again.`);
      }
    }
    flat[nodeId] = nodeDef;
    const list = flat[parentId].nodes || (flat[parentId].nodes = []);
    const pos = position != null ? position : list.length;
    list.splice(pos, 0, nodeId);
    const result = await saveTarget(targetId, targetType, flat);
    const label = targetType === 'template' ? `Node ${nodeId} inserted into ${parentId} at position ${pos} in template "${targetId}".` : `Node ${nodeId} inserted into ${parentId} at position ${pos}.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },

  async set_footer(args) {
    const { targetId, targetType, flat } = await fetchTarget(args);

    // Patch footer container background/color
    if (!flat.ftr_content) throw new Error('No ftr_content node found. Is this a PageHub site?');
    if (args.contentBackground || args.contentColor) {
      const p = flat.ftr_content.props;
      p.className = mergeNodeClassName(p.className, args.contentBackground, args.contentColor);
    }

    // Patch copyright text node
    if (flat.ftr_text) {
      if (args.copyrightHtml) flat.ftr_text.props.text = args.copyrightHtml;
      if (args.copyrightTagName) flat.ftr_text.props.tagName = args.copyrightTagName;
      if (args.copyrightRootColor) {
        const tp = flat.ftr_text.props;
        tp.className = mergeNodeClassName(tp.className, args.copyrightRootColor);
      }
    }

    const result = await saveTarget(targetId, targetType, flat);
    const label = targetType === 'template' ? `Footer updated in template "${targetId}".` : `Footer updated.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },

  async set_nav(args) {
    const { targetId, targetType, flat } = await fetchTarget(args);

    if (!flat.hdr_section) throw new Error('No hdr_section node found. Is this a PageHub site?');
    if (!flat.hdr_nav) throw new Error('No hdr_nav node found.');

    // Patch header background/color (className only)
    const hdr = flat.hdr_section.props;
    hdr.className = mergeNodeClassName(hdr.className, args.headerBg, args.headerColor);

    // Patch logo
    if (flat.hdr_logo) {
      if (args.logoText) flat.hdr_logo.props.text = args.logoText;
      if (args.logoFont) {
        const raw = String(args.logoFont).trim().replace(/\s+/g, '_').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const cls = `font-['${raw}']`;
        const prev = flat.hdr_logo.props.className;
        flat.hdr_logo.props.className = mergeNodeClassName(prev, cls);
      }
    }

    // Remove old deletable desktop nav links from hdr_nav
    const oldDesktopLinks = (flat.hdr_nav.nodes || []).filter(id => flat[id]?.props?.canDelete !== false);
    for (const id of oldDesktopLinks) delete flat[id];
    flat.hdr_nav.nodes = (flat.hdr_nav.nodes || []).filter(id => flat[id]);

    // Remove old mobile link items from acme-mobile-items
    const mobileItems = flat['acme-mobile-items'];
    if (mobileItems) {
      for (const id of (mobileItems.nodes || [])) delete flat[id];
      mobileItems.nodes = [];
    }

    // Add new nav links
    if (args.links && Array.isArray(args.links)) {
      const linkColor = args.headerColor || 'text-(--foreground)';
      for (let i = 0; i < args.links.length; i++) {
        const link = args.links[i];
        const desktopId = `nav_link_${i}`;
        const mobileId = `nav_mobile_link_${i}`;

        // Desktop button (hidden on mobile)
        flat[desktopId] = {
          type: { resolvedName: 'Button' }, isCanvas: false,
          props: { canDelete: true, canEditName: true, text: link.text, url: link.url || '#',
            className: mergeNodeClassName('', 'bg-transparent', linkColor, 'hidden md:block text-sm px-(--button-padding-x) py-(--button-padding-y)'),
            custom: { displayName: link.text } },
          displayName: 'Button', parent: 'hdr_nav', nodes: [], linkedNodes: {}
        };
        flat.hdr_nav.nodes.push(desktopId);

        // Mobile menu button
        if (mobileItems) {
          flat[mobileId] = {
            type: { resolvedName: 'Button' }, isCanvas: false,
            props: { canDelete: true, canEditName: true, text: link.text, url: link.url || '#',
              className: mergeNodeClassName('', 'bg-transparent', 'text-(--foreground)', 'w-full text-lg font-medium px-4 py-3'),
              custom: { displayName: link.text } },
            displayName: 'Button', parent: 'acme-mobile-items', nodes: [], linkedNodes: {}
          };
          mobileItems.nodes.push(mobileId);
        }
      }
    }

    // Add phone link to header if provided
    if (args.phone) {
      const phoneId = 'nav_phone';
      if (flat[phoneId]) delete flat[phoneId];
      flat[phoneId] = {
        type: { resolvedName: 'Button' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, text: args.phone.text, url: args.phone.url,
          className: mergeNodeClassName('', 'bg-transparent', args.headerColor || 'text-(--foreground)', 'text-sm px-(--button-padding-x) py-(--button-padding-y)'),
          custom: { displayName: 'Phone' } },
        displayName: 'Button', parent: 'hdr_nav', nodes: [], linkedNodes: {}
      };
      flat.hdr_nav.nodes.push(phoneId);
    }

    const result = await saveTarget(targetId, targetType, flat);
    const label = targetType === 'template' ? `Nav updated in template "${targetId}".` : `Nav updated.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },

  async set_integrations(args) {
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat.ROOT?.props) throw new Error('No ROOT node found.');
    const integrations = {};
    if (args.googleAnalytics) integrations.googleAnalytics = { measurementId: args.googleAnalytics };
    if (args.googleTagManager) integrations.googleTagManager = { containerId: args.googleTagManager };
    if (args.googleSearchConsole) integrations.googleSearchConsole = { verificationCode: args.googleSearchConsole };
    if (args.metaPixel) integrations.metaPixel = { pixelId: args.metaPixel };
    flat.ROOT.props.integrations = { ...(flat.ROOT.props.integrations || {}), ...integrations };
    const result = await saveTarget(targetId, targetType, flat);
    const providers = Object.keys(integrations).join(', ') || 'none';
    const label = targetType === 'template' ? `Integrations updated in template "${targetId}": ${providers}.` : `Integrations updated: ${providers}.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },

  async set_redirects(args) {
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat.ROOT?.props) throw new Error('No ROOT node found.');
    const redirects = (args.redirects || []).map(r => ({
      from: r.from,
      to: r.to,
      permanent: r.permanent !== false,
    }));
    flat.ROOT.props.redirects = redirects.length ? redirects : undefined;
    const result = await saveTarget(targetId, targetType, flat);
    const label = targetType === 'template' ? `${redirects.length} redirect rule(s) saved in template "${targetId}".` : `${redirects.length} redirect rule(s) saved.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },
};
