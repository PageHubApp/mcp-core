const { apiFetch, normalizeBaseUrl } = require("../api-fetch");
const { getContext } = require("../context");
const { getActiveTarget, fetchTarget, decodeContentOrThrow } = require("../helpers/index.js");

const DEFAULT_BLANK_TEMPLATE = "acme";

module.exports = {
  async create_site(args = {}) {
    const slug = args.template || DEFAULT_BLANK_TEMPLATE;
    const tpl = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    const content = decodeContentOrThrow(tpl.content, `Template "${slug}" content`);

    const data = await apiFetch("/api/v1/sites", {
      method: "POST",
      body: {
        content,
        name: args.name,
        title: args.title,
        description: args.description,
        sourceTemplate: { slug, ...(tpl.version ? { version: tpl.version } : {}) },
      },
    });

    const ctx = getContext();
    ctx.activeSite = { id: data.id, name: data.name, draftId: data.draftId };
    ctx.activeTemplate = null;
    if (!ctx._targetRevisions || typeof ctx._targetRevisions !== "object")
      ctx._targetRevisions = {};

    const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
    return {
      content: [
        {
          type: "text",
          text: `New site ${data.id} created from "${slug}" (${Object.keys(content).length} nodes).\nActive site set. Editor: ${data.url || `${base}/build/${data.id}`}\nPreview: ${base}/view/${data.id}`,
        },
      ],
    };
  },

  async list_sites() {
    const data = await apiFetch("/api/v1/sites");
    const lines = (data.sites || []).map(
      s =>
        `• ${s._id} — ${s.name || "(unnamed)"}${s.domain ? ` [${s.domain}]` : ""} (updated ${s.updatedAt})`
    );
    return {
      content: [{ type: "text", text: lines.length ? lines.join("\n") : "No sites found." }],
    };
  },

  async select_site(args) {
    const { id } = args;
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(id)}`);
    const ctx = getContext();
    ctx.activeSite = { id: data.id, name: data.name, draftId: data.draftId };
    if (!ctx._targetRevisions || typeof ctx._targetRevisions !== "object")
      ctx._targetRevisions = {};
    if (data.updatedAt) {
      ctx._targetRevisions[`site:${data.id}`] = { expectedUpdatedAt: String(data.updatedAt) };
    }
    // Clear activeTemplate so site takes priority
    ctx.activeTemplate = null;
    return {
      content: [
        { type: "text", text: `Active site set to ${data.id} (${data.name || "unnamed"})` },
      ],
    };
  },

  async pull_site(args) {
    const ctx = getContext();
    const target = getActiveTarget(args);
    let content;
    if (ctx._pendingFlatMap) {
      content = ctx._pendingFlatMap;
    } else {
      const fetched = await fetchTarget(args);
      content = fetched?.flat;
    }
    if (!content)
      throw new Error(`${target.type === "template" ? "Template" : "Site"} has no content.`);
    const nodeCount = Object.keys(content).length;
    const label = target.type === "template" ? `Template "${target.id}"` : `Site ${target.id}`;
    return {
      content: [
        {
          type: "text",
          text: `${label} fetched (${nodeCount} nodes).\n\n\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``,
        },
      ],
    };
  },

  async publish_site(args) {
    const target = getActiveTarget(args);
    if (target.type !== "site") throw new Error("publish_site only works on sites, not templates.");
    await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`, {
      method: "PUT",
      body: { published: true },
    });
    return { content: [{ type: "text", text: `Site ${target.id} published.` }] };
  },

  async unpublish_site(args) {
    const target = getActiveTarget(args);
    if (target.type !== "site")
      throw new Error("unpublish_site only works on sites, not templates.");
    await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`, {
      method: "PUT",
      body: { published: false },
    });
    return { content: [{ type: "text", text: `Site ${target.id} unpublished.` }] };
  },

  async duplicate_site(args = {}) {
    const ctx = getContext();
    const sourceId = args.id || ctx.activeSite?.id;
    if (!sourceId) throw new Error("No site id provided and no active site set.");

    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(sourceId)}/duplicate`,
      {
        method: "POST",
        body: {
          name: args.name,
          title: args.title,
          description: args.description,
        },
      }
    );

    ctx.activeSite = { id: data.id, name: data.name, draftId: data.draftId };
    ctx.activeTemplate = null;
    if (!ctx._targetRevisions || typeof ctx._targetRevisions !== "object")
      ctx._targetRevisions = {};

    const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
    return {
      content: [
        {
          type: "text",
          text: `Site ${data.id} duplicated from ${data.sourceId}.\nActive site set. Editor: ${data.url || `${base}/build/${data.id}`}\nPreview: ${base}/view/${data.id}`,
        },
      ],
    };
  },

  async delete_site(args) {
    const { id } = args;
    await apiFetch(`/api/v1/sites/${encodeURIComponent(id)}`, { method: "DELETE" });
    const ctx = getContext();
    if (ctx.activeSite?.id === id) ctx.activeSite = null;
    return { content: [{ type: "text", text: `Site ${id} deleted.` }] };
  },
};
