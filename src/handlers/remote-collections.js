const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");

function activeSiteId(args) {
  const ctx = getContext();
  const id = args?.site_id || args?.id || ctx.activeSite?.id;
  if (!id) throw new Error("No site_id provided and no active site set.");
  return id;
}

function fmtCollection(c) {
  return `• ${c._id} — ${c.name} (slug: ${c.slug}, rows: ${c.rowCount ?? 0}, fields: ${
    (c.schema || []).length
  }${c.isPublic ? ", public" : ""})`;
}

module.exports = {
  async list_collections(args = {}) {
    const siteId = activeSiteId(args);
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`);
    const cols = data.collections || [];
    const lines = cols.length ? cols.map(fmtCollection).join("\n") : "No collections on this site.";
    return { content: [{ type: "text", text: lines }] };
  },

  async get_collection(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required");
    const list = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`);
    const col = (list.collections || []).find(c => c.slug === args.slug);
    if (!col) throw new Error(`Collection "${args.slug}" not found.`);
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(col._id)}`
    );
    return {
      content: [
        {
          type: "text",
          text: `\`\`\`json\n${JSON.stringify(data.collection || data, null, 2)}\n\`\`\``,
        },
      ],
    };
  },

  async create_collection(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.name) throw new Error("name is required");
    if (!args.slug) throw new Error("slug is required");
    const body = {
      name: args.name,
      slug: args.slug,
      description: args.description,
      schema: args.schema || [],
      source: args.source,
      isPublic: !!args.isPublic,
    };
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`, {
      method: "POST",
      body,
    });
    return {
      content: [
        {
          type: "text",
          text: `Created collection "${data.collection.name}" (slug: ${data.collection.slug}, id: ${data.collection._id}).`,
        },
      ],
    };
  },

  async update_collection_schema(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required");
    if (!Array.isArray(args.schema)) throw new Error("schema must be an array");
    const list = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`);
    const col = (list.collections || []).find(c => c.slug === args.slug);
    if (!col) throw new Error(`Collection "${args.slug}" not found.`);
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(col._id)}`,
      { method: "PATCH", body: { schema: args.schema } }
    );
    return {
      content: [
        {
          type: "text",
          text: `Schema updated on "${args.slug}" (${args.schema.length} fields).`,
        },
      ],
    };
  },

  async delete_collection(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required");
    const list = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`);
    const col = (list.collections || []).find(c => c.slug === args.slug);
    if (!col) throw new Error(`Collection "${args.slug}" not found.`);
    await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(col._id)}`,
      { method: "DELETE" }
    );
    return {
      content: [{ type: "text", text: `Collection "${args.slug}" deleted.` }],
    };
  },

  async list_collection_rows(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required");
    const qs = new URLSearchParams();
    if (args.limit) qs.set("limit", String(args.limit));
    if (args.cursor) qs.set("cursor", String(args.cursor));
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(
        args.slug
      )}/rows${qs.toString() ? `?${qs}` : ""}`
    );
    const rows = data.rows || [];
    const lines = [
      `${rows.length} rows (total ${data.totalCount ?? "?"})${
        data.hasMore ? `, nextCursor: ${data.nextCursor}` : ""
      }`,
      "",
      `\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },

  async create_collection_row(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required");
    if (!args.data || typeof args.data !== "object") throw new Error("data is required (object)");
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(
        args.slug
      )}/rows`,
      { method: "POST", body: { data: args.data } }
    );
    const created = data.rows?.[0] || data;
    return {
      content: [
        {
          type: "text",
          text: `Row created (id: ${created?._id || "?"}) in "${args.slug}".`,
        },
      ],
    };
  },

  async update_collection_row(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required");
    if (!args.row_id) throw new Error("row_id is required");
    if (!args.data || typeof args.data !== "object") throw new Error("data is required (object)");
    await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(
        args.slug
      )}/rows/${encodeURIComponent(args.row_id)}`,
      { method: "PATCH", body: { data: args.data } }
    );
    return {
      content: [{ type: "text", text: `Row ${args.row_id} updated in "${args.slug}".` }],
    };
  },

  async delete_collection_row(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required");
    if (!args.row_id) throw new Error("row_id is required");
    await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(
        args.slug
      )}/rows/${encodeURIComponent(args.row_id)}`,
      { method: "DELETE" }
    );
    return {
      content: [{ type: "text", text: `Row ${args.row_id} deleted from "${args.slug}".` }],
    };
  },
};
