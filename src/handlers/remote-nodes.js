const { getContext, withPendingMapLock } = require("../core/context");
const {
  parseMaybeJson,
  applyNodePatches,
  normalizeNodePatchArgs,
  stripLockedStyling,
  normalizeBulkPatchesFromArgs,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  getActiveTarget,
  fetchTarget,
  saveTarget,
  assertFillModePatchAllowed,
  assertFillModeBulkPatchesAllowed,
  guardRootCompanyPropsPatch,
  mergeBlockModifiersIntoRoot,
} = require("../helpers/index.js");
const { recordFillPatch } = require("../helpers/fill-patch-merge");
const { collectSubtree, sanitizeNodes, findSectionRoot } = require("../utils/node-utils");
const { resultMsg } = require("./remote-shared");
const { resolveToolDefaultPageNodeId } = require("../core/active-page");
const { validateNodes, formatValidationReport } = require("../validation/node-validation");
const { consumePunchListAndFormatMissed } = require("./kit/punch-list-state");
const {
  normalizeButtonValidationMode,
  normalizeDesignValidationMode,
  runDesignValidation,
  formatDesignValidationReport,
  maybePreflightButton,
  formatButtonPreflightReport,
} = require("./remote-nodes/validation");
const {
  collectUnsplashSrcViolations,
  unsplashViolationMessage,
  assertNoImageSrcContentConflict,
} = require("./remote-nodes/unsplash-guard");

module.exports = {
  async add_nodes(args) {
    return withPendingMapLock(() => addNodesBody(args));
  },
  async patch_site_node(args) {
    return withPendingMapLock(() => patchSiteNodeBody(args));
  },
  async patch_site_bulk(args) {
    return withPendingMapLock(() => patchSiteBulkBody(args));
  },
};

async function addNodesBody(args) {
    const target = getActiveTarget(args);
    const ctx = getContext();
    if (ctx.fillMode && ctx._fillStructureLocked) {
      throw new Error(
        "This fill already created structure (kit or prior add_nodes). Use patch_site_node / patch_site_bulk only — do not call add_nodes again."
      );
    }
    const { flat } = await fetchTarget(args);
    const rawNodes = parseMaybeJson(args.nodes);
    if (!rawNodes || typeof rawNodes !== "object")
      throw new Error("nodes must be an object map of nodeId → node definition.");

    const rootNodeId =
      args.rootNodeId != null && args.rootNodeId !== "" ? String(args.rootNodeId) : null;
    if (!rootNodeId) {
      throw new Error(
        "add_nodes requires rootNodeId. Pass the top-level node id from your nodes payload to attach."
      );
    }
    if (!rawNodes[rootNodeId]) {
      throw new Error(
        `rootNodeId "${rootNodeId}" was not found in nodes payload. Include that node in args.nodes.`
      );
    }

    let parentId =
      args.parentId != null && args.parentId !== ""
        ? String(args.parentId)
        : ctx.fillMode
          ? "page_home"
          : resolveToolDefaultPageNodeId({ flat, ctx }) || "page_home";
    if (ctx.fillMode && ctx.sectionNodeId) {
      const sec = String(ctx.sectionNodeId);
      if (args.parentId == null || args.parentId === "") {
        parentId = sec;
      } else if (parentId !== sec) {
        throw new Error(
          `Parallel fill: add_nodes parentId must be your section "${sec}". Omit parentId to default there — never use page_home or another section.`
        );
      }
    }

    if (!flat[parentId]) {
      if (rawNodes[parentId]) {
        throw new Error(
          `Parent node "${parentId}" not found in the current site/template. parentId must be an EXISTING node, but "${parentId}" appears in your new nodes payload.\n` +
            `Use parentId as an existing container (for example "page_home" or your section id), and set rootNodeId to your new top-level node id.`
        );
      }
      throw new Error(`Parent node "${parentId}" not found.`);
    }

    // Validate & auto-fix new nodes before sanitizing
    const validation = validateNodes(rawNodes, { autoFix: true, warnColors: true });
    const validationReport = formatValidationReport(validation);

    // Sanitize: parse strings, validate types, rebuild parent↔children, reparent orphans
    const { nodes: cleanNodes, roots } = sanitizeNodes(rawNodes, flat, parentId);
    if (Object.keys(cleanNodes).length === 0) {
      return { content: [{ type: "text", text: "No valid nodes to add." }], changedNodes: {} };
    }
    if (!cleanNodes[rootNodeId]) {
      throw new Error(
        `rootNodeId "${rootNodeId}" was filtered out during sanitization (invalid type, duplicate id, or malformed node).`
      );
    }
    if (!roots.includes(rootNodeId)) {
      throw new Error(
        `rootNodeId "${rootNodeId}" is not a top-level root in the provided nodes map.\n` +
          `Ensure "${rootNodeId}" has no parent inside args.nodes and is the subtree root you want attached to "${parentId}".`
      );
    }
    const extraRoots = roots.filter(id => id !== rootNodeId);
    if (extraRoots.length > 0) {
      throw new Error(
        `add_nodes received multiple root candidates (${[rootNodeId, ...extraRoots].join(", ")}).\n` +
          `Provide one subtree rooted at rootNodeId, or split into multiple add_nodes calls.`
      );
    }

    // Merge sanitized nodes into the flat map
    for (const [id, node] of Object.entries(cleanNodes)) {
      flat[id] = node;
    }

    // Register the requested root as child of the parent container
    const parentNodes = flat[parentId].nodes || [];
    const position = args.position != null ? args.position : parentNodes.length;
    parentNodes.splice(position, 0, rootNodeId);
    flat[rootNodeId].parent = parentId;
    flat[parentId].nodes = parentNodes;

    mergeBlockModifiersIntoRoot(flat, parseMaybeJson(args.modifiers) || args.modifiers);

    const changedNodes = {};
    for (const id of Object.keys(cleanNodes)) {
      Object.assign(changedNodes, collectSubtree(flat, id));
    }

    // Dry run
    if (ctx.draftMode) {
      if (ctx.fillMode) {
        // Build a minimal patch: only new nodes + the updated section container
        const patch = { ...cleanNodes };
        patch[parentId] = flat[parentId];
        recordFillPatch(ctx, patch);
        ctx._pendingFlatMap = flat;
      } else {
        ctx._pendingFlatMap = flat;
      }
      return {
        content: [
          {
            type: "text",
            text: `${Object.keys(cleanNodes).length} nodes added to ${parentId} (root: ${rootNodeId}) successfully.`,
          },
        ],
        pendingContent: ctx.fillMode ? ctx._pendingFlatMap : flat,
        changedNodes,
      };
    }

    const result = await saveTarget(target.id, target.type, flat);
    const reportSuffix = validationReport ? `\n\n---\n${validationReport}` : "";
    return {
      content: [
        {
          type: "text",
          text:
            resultMsg(target.id, target.type, `${Object.keys(cleanNodes).length} nodes added.`) +
            reportSuffix,
        },
      ],
      changedNodes,
    };
}

async function patchSiteNodeBody(args) {
    const target = getActiveTarget(args);
    assertPatchSiteNodeArgs(args);
    const {
      nodeId,
      name: siteName,
      title,
      description,
      nodesPatch,
      unsetProps,
      unsetClasses,
    } = args;
    const buttonValidationMode = normalizeButtonValidationMode(args.buttonValidation);
    const designValidationMode = normalizeDesignValidationMode(args.designValidation);
    const ctx = getContext();
    const { flat } = await fetchTarget(args);
    assertFillModePatchAllowed(flat, nodeId, ctx);
    let patchArgs = normalizeNodePatchArgs({ ...args, nodesPatch, unsetProps, unsetClasses });
    if (String(nodeId) === "ROOT" && patchArgs.propsPatch) {
      patchArgs = {
        ...patchArgs,
        propsPatch: guardRootCompanyPropsPatch(flat, patchArgs.propsPatch, ctx),
      };
    }
    // Weak/auto-tier models aren't trusted to freestyle className — strip any
    // styling mutations when ctx.stylingLocked is set by the fill caller.
    const stripped = stripLockedStyling(patchArgs, ctx);
    patchArgs = stripped.patch;
    const stylingDropNote = stripped.dropped.length
      ? `\n\n[styling locked] Dropped: ${stripped.dropped.join(", ")}. Blocks are pre-styled in auto mode — patch text/images/icons only.`
      : "";
    {
      const hits = collectUnsplashSrcViolations(patchArgs, nodeId);
      if (hits.length) {
        return { content: [{ type: "text", text: unsplashViolationMessage(hits) }] };
      }
    }
    applyNodePatches(flat, nodeId, patchArgs);
    assertNoImageSrcContentConflict(flat, nodeId);
    const buttonReport = maybePreflightButton(flat, nodeId, buttonValidationMode);
    const designReport = runDesignValidation(flat, [nodeId], designValidationMode);
    const changedNodes = collectSubtree(flat, findSectionRoot(flat, nodeId));

    // Dry run: return proposed changes without saving
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      if (ctx.fillMode && changedNodes) {
        recordFillPatch(ctx, changedNodes);
      }
      return {
        content: [
          {
            type: "text",
            text:
              `Node ${nodeId} updated successfully.` +
              `${buttonReport ? `\n\n${formatButtonPreflightReport([buttonReport])}` : ""}` +
              `${designReport ? `\n\n${formatDesignValidationReport(designReport)}` : ""}` +
              stylingDropNote,
          },
        ],
        pendingContent: flat,
        changedNodes,
      };
    }

    const extra = {};
    if (siteName !== undefined) extra.name = siteName;
    if (title !== undefined) extra.title = title;
    if (description !== undefined) extra.description = description;
    const result = await saveTarget(target.id, target.type, flat, extra);
    return {
      content: [
        {
          type: "text",
          text:
            `${resultMsg(result.id, target.type, `Updated (node ${nodeId}).`)}` +
            `${buttonReport ? `\n\n${formatButtonPreflightReport([buttonReport])}` : ""}` +
            `${designReport ? `\n\n${formatDesignValidationReport(designReport)}` : ""}`,
        },
      ],
      changedNodes,
    };
}

async function patchSiteBulkBody(args) {
    const target = getActiveTarget(args);
    const buttonValidationMode = normalizeButtonValidationMode(args.buttonValidation);
    const designValidationMode = normalizeDesignValidationMode(args.designValidation);
    const list = normalizeBulkPatchesFromArgs(args);
    if (!Array.isArray(list) || list.length === 0) {
      const p = args.patches !== undefined ? args.patches : args.patch;
      let received = "missing patches";
      if (p !== undefined) {
        if (p === null) received = "null";
        else if (typeof p === "string") received = `string (length ${p.length})`;
        else if (Array.isArray(p)) received = `array length ${p.length}`;
        else if (typeof p === "object")
          received = `object keys: ${Object.keys(p).slice(0, 12).join(", ")}`;
        else received = typeof p;
      }
      let jsonHint = "";
      if (typeof p === "string" && p.length > 0) {
        jsonHint =
          " Prefer patches as a native JSON array (not a string). If string: valid JSON only — escape quotes in text or use patch_site_node.";
      }
      throw new Error(
        `patches must be a non-empty array of { nodeId, classNamePatch?, propsPatch?, ... }. ` +
          `Always use an array even for one node, e.g. [{ "nodeId": "kit_text_1", "propsPatch": { ... } }]. (${received})${jsonHint}`
      );
    }
    const ctx = getContext();
    const { flat } = await fetchTarget(args);
    assertFillModeBulkPatchesAllowed(flat, list, ctx);
    // Pre-scan for hand-typed Unsplash URLs across ALL patches so we reject
    // before any partial write — keeps the bulk semantics clean.
    {
      const allHits = [];
      for (const item of list) {
        if (!item || typeof item.nodeId !== "string") continue;
        const tmp = normalizeNodePatchArgs({ ...item });
        const hits = collectUnsplashSrcViolations(tmp, item.nodeId);
        if (hits.length) allHits.push(...hits);
      }
      if (allHits.length) {
        return { content: [{ type: "text", text: unsplashViolationMessage(allHits) }] };
      }
    }
    const touched = [];
    const buttonReports = [];
    const droppedByNode = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || typeof item.nodeId !== "string") {
        throw new Error(`patches[${i}]: missing nodeId`);
      }
      assertPatchBulkItem(item, i);
      const {
        nodeId: nid,
        name: _name,
        title: _title,
        description: _desc,
        id: _id,
        patches: _patches,
        ...rest
      } = item;
      assertFillModePatchAllowed(flat, nid, ctx);
      let bulkPatch = normalizeNodePatchArgs(rest);
      if (String(nid) === "ROOT" && bulkPatch.propsPatch) {
        bulkPatch = {
          ...bulkPatch,
          propsPatch: guardRootCompanyPropsPatch(flat, bulkPatch.propsPatch, ctx),
        };
      }
      const stripped = stripLockedStyling(bulkPatch, ctx);
      bulkPatch = stripped.patch;
      if (stripped.dropped.length) droppedByNode.push(`${nid}: ${stripped.dropped.join(", ")}`);
      applyNodePatches(flat, nid, bulkPatch);
      assertNoImageSrcContentConflict(flat, nid);
      const report = maybePreflightButton(flat, nid, buttonValidationMode);
      if (report) buttonReports.push(report);
      touched.push(nid);
    }
    const designReport = runDesignValidation(flat, touched, designValidationMode);
    const changedNodes = Object.assign(
      {},
      ...touched.map(id => collectSubtree(flat, findSectionRoot(flat, id)))
    );

    // Surface anything from a recent kit's punch list the agent didn't include.
    const missedTail = consumePunchListAndFormatMissed(ctx, touched);
    const stylingTail = droppedByNode.length
      ? `\n\n[styling locked] Dropped className mutations on: ${droppedByNode.join("; ")}. Blocks are pre-styled in auto mode — patch text/images/icons only.`
      : "";

    // Dry run: return proposed changes without saving
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      if (ctx.fillMode && changedNodes) {
        recordFillPatch(ctx, changedNodes);
      }
      return {
        content: [
          {
            type: "text",
            text:
              `${touched.length} nodes updated successfully: ${touched.join(", ")}.` +
              `${buttonReports.length ? `\n\n${formatButtonPreflightReport(buttonReports)}` : ""}` +
              `${designReport ? `\n\n${formatDesignValidationReport(designReport)}` : ""}` +
              missedTail +
              stylingTail,
          },
        ],
        pendingContent: flat,
        changedNodes,
      };
    }

    const { name: siteName, title, description } = args;
    const extra = {};
    if (siteName !== undefined) extra.name = siteName;
    if (title !== undefined) extra.title = title;
    if (description !== undefined) extra.description = description;
    const result = await saveTarget(target.id, target.type, flat, extra);
    return {
      content: [
        {
          type: "text",
          text:
            `${resultMsg(result.id, target.type, `Updated (${touched.length} nodes: ${touched.join(", ")}).`)}` +
            `${buttonReports.length ? `\n\n${formatButtonPreflightReport(buttonReports)}` : ""}` +
            `${designReport ? `\n\n${formatDesignValidationReport(designReport)}` : ""}` +
            missedTail +
            stylingTail,
        },
      ],
      changedNodes,
    };
}
