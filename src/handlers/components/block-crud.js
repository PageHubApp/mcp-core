const { apiFetch } = require("../../core/api-fetch");
const {
  applyNodePatches,
  normalizeNodePatchArgs,
  normalizeBulkPatchesFromArgs,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
} = require("../../helpers/index.js");
const {
  hierarchicalLibraryToFlat,
  flatLibraryToHierarchical,
  formatBlockNodeManifest,
} = require("../../codec/structure-ingest");
const { quickA11yAudit } = require("../../validation/a11y-check");
const { fetchComponent, decodeComponentStructure, encodeStructurePayload } = require("./api");

async function get_block(args) {
  const { slug } = args;
  if (!slug) throw new Error("slug is required.");

  const raw = await fetchComponent(slug);
  const c = decodeComponentStructure(raw.component || raw);

  return {
    content: [
      {
        type: "text",
        text: `# ${c.name} (\`${c.slug}\`)\n\n**Category:** ${c.category}${c.preset || c.source ? `\n**Preset:** ${c.preset || c.source}${c.source && !c.preset ? " (from legacy source field)" : ""}` : ""}${c.group ? `\n**Group:** ${c.group}` : ""}\n**Description:** ${c.description || ""}\n**Visual:** ${c.visual || ""}\n**Tags:** ${(c.tags || []).join(", ")}\n**Uses:** ${c.uses} · **Likes:** ${c.likes}\n\n**Patching:** Call \`list_block_nodes({ slug: "${c.slug}" })\` for deterministic \`lib_*\` node ids, then \`patch_block\` / \`patch_block_bulk\` (same patch fields as \`patch_site_node\`).\n\n## Structure\n\n\`\`\`json\n${JSON.stringify(c.structure, null, 2)}\n\`\`\``,
      },
    ],
  };
}

/**
 * Deterministic lib_* node id manifest for a library block (for patch_block / patch_block_bulk).
 */
async function list_block_nodes(args) {
  const { slug } = args;
  if (!slug) throw new Error("slug is required.");

  const raw = await fetchComponent(slug);
  const c = decodeComponentStructure(raw.component || raw);

  const { nodes, rootId } = hierarchicalLibraryToFlat(c.structure, slug);
  const manifest = formatBlockNodeManifest(nodes, rootId, slug);

  return {
    content: [
      {
        type: "text",
        text: `# ${c.name} (\`${c.slug}\`)\n\n${manifest}\n\nPatch with the same \`slug\` you passed here (\`${slug}\`) so ids stay aligned.`,
      },
    ],
  };
}

async function save_block(args) {
  const {
    name,
    slug,
    description,
    visual,
    category,
    subcategory,
    tags,
    preset,
    source,
    group,
    style,
    structure,
    isPublic,
    isCategoryPreview,
  } = args;
  if (!name || !slug || !category || !structure) {
    throw new Error("name, slug, category, and structure are required.");
  }

  const data = await apiFetch("/api/v1/components", {
    method: "POST",
    body: {
      name,
      slug,
      description,
      visual,
      category,
      subcategory,
      tags,
      preset,
      source,
      group,
      style,
      structure: encodeStructurePayload(structure),
      isPublic,
      isCategoryPreview,
    },
  });

  const auditInput = typeof structure === "string" ? null : structure;
  const audit = auditInput ? quickA11yAudit(auditInput) : null;
  const auditText = audit ? `\n\n---\n${audit.summary}` : "";
  return {
    content: [
      {
        type: "text",
        text: `Block saved: **${data.component.name}** (\`${data.component.slug}\`)\nPublic: ${data.component.isPublic}\nCategory: ${data.component.category}${auditText}`,
      },
    ],
  };
}

async function update_block(args) {
  const { slug } = args;
  if (!slug) throw new Error("slug is required.");
  const existing = await fetchComponent(slug);
  const existingComponent = existing.component || existing;
  const expectedVersion = Number(existingComponent?.version || 1);

  const body = {};
  const fields = [
    "name",
    "description",
    "visual",
    "category",
    "subcategory",
    "tags",
    "preset",
    "source",
    "group",
    "style",
    "structure",
    "isPublic",
    "isFeatured",
    "isCategoryPreview",
    "newSlug",
  ];
  for (const f of fields) {
    if (args[f] !== undefined) {
      body[f === "newSlug" ? "slug" : f] =
        f === "structure" ? encodeStructurePayload(args[f]) : args[f];
    }
  }

  if (Object.keys(body).length === 0) {
    throw new Error("Nothing to update. Provide at least one field.");
  }

  const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, {
    method: "PUT",
    body: { ...body, expectedVersion },
  });

  const c = data.component;
  const audit =
    args.structure && typeof args.structure === "object" ? quickA11yAudit(args.structure) : null;
  const auditText = audit ? `\n\n---\n${audit.summary}` : "";
  return {
    content: [
      {
        type: "text",
        text: `Block updated: **${c.name}** (\`${c.slug}\`)\nCategory: ${c.category}\nPublic: ${c.isPublic}${auditText}`,
      },
    ],
  };
}

async function patch_block(args) {
  const { slug, nodeId } = args;
  if (!slug) throw new Error("slug is required.");
  if (!nodeId) throw new Error("nodeId is required.");
  assertPatchBlockNodeArgs(args);

  const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
  const c = decodeComponentStructure(data.component);

  const { nodes, rootId } = hierarchicalLibraryToFlat(c.structure, slug);
  const flat = JSON.parse(JSON.stringify(nodes));
  const { nodesPatch, unsetProps, unsetClasses } = args;
  applyNodePatches(
    flat,
    nodeId,
    normalizeNodePatchArgs({ ...args, nodesPatch, unsetProps, unsetClasses })
  );
  const newStructure = flatLibraryToHierarchical(flat, rootId);

  await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, {
    method: "PUT",
    body: {
      structure: encodeStructurePayload(newStructure),
      expectedVersion: Number(c.version || 1),
    },
  });

  return {
    content: [
      {
        type: "text",
        text: `Block \`${slug}\` patched (node \`${nodeId}\`). Structure saved. Re-run list_block_nodes if you renamed the slug.`,
      },
    ],
  };
}

async function patch_block_bulk(args) {
  const { slug } = args;
  if (!slug) throw new Error("slug is required.");

  const list = normalizeBulkPatchesFromArgs(args);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      "patches must be a non-empty array of { nodeId, classNamePatch?, propsPatch?, ... } (same shape as patch_site_bulk)."
    );
  }

  const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
  const c = decodeComponentStructure(data.component);

  const { nodes, rootId } = hierarchicalLibraryToFlat(c.structure, slug);
  const flat = JSON.parse(JSON.stringify(nodes));
  const touched = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item.nodeId !== "string") {
      throw new Error(`patches[${i}]: missing nodeId`);
    }
    assertPatchBlockBulkItem(item, i);
    const { nodeId: nid, patches: _patches, ...rest } = item;
    applyNodePatches(flat, nid, normalizeNodePatchArgs(rest));
    touched.push(nid);
  }

  const newStructure = flatLibraryToHierarchical(flat, rootId);

  await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, {
    method: "PUT",
    body: {
      structure: encodeStructurePayload(newStructure),
      expectedVersion: Number(c.version || 1),
    },
  });

  return {
    content: [
      {
        type: "text",
        text: `Block \`${slug}\` patched (${touched.length} nodes): ${touched.join(", ")}. Structure saved.`,
      },
    ],
  };
}

async function delete_block(args) {
  const { slug } = args;
  if (!slug) throw new Error("slug is required.");
  await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, { method: "DELETE" });
  return { content: [{ type: "text", text: `Block "${slug}" deleted.` }] };
}

module.exports = {
  get_block,
  list_block_nodes,
  save_block,
  update_block,
  patch_block,
  patch_block_bulk,
  delete_block,
};
