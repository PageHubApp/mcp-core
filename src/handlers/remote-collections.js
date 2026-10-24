/**
 * Site Collections CRUD — schemas + rows on the active site. Wraps the
 * `/api/v1/sites/:id/collections` REST surface with consistent argument
 * validation and human-readable response text.
 */

const { randomBytes } = require("crypto");
const { apiFetch, normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");

function activeSiteId(args) {
  const ctx = getContext();
  const id = args?.id || ctx.activeSite?.id;
  if (!id) throw new Error("Site id is required (none provided and no active site set).");
  return id;
}

/**
 * A webhook-feed collection's ingest endpoint: senders POST rows signed with the collection's secret. The secret is the
 * collection's own credential (stored on `source.secret`), so reads never print it.
 */
function webhookFeedInfo(col) {
  const base = normalizeBaseUrl(getContext().apiBaseUrl) || "https://pagehub.dev";
  return {
    url: `${base}/api/collections/webhook/${col._id}`,
    hasSecret: !!col.source?.secret,
  };
}

function webhookFeedLines(info) {
  return [
    `Webhook feed: POST ${info.url}`,
    `Signing secret: ${info.hasSecret ? "set" : "NOT set (every POST is refused until set_collection_webhook sets one)"}.`,
    'Body: JSON — { "rows": [{ "externalId": "…", "data": { <field keys> } }] }, a bare array of rows, or one row. A row\'s externalId (or id) keys the upsert, so re-sending updates instead of duplicating.',
    'Header: X-PageHub-Signature: sha256=<hex HMAC-SHA256 of the raw body with the secret>.',
  ].join("\n");
}

function fmtCollection(c) {
  return `• ${c._id} — ${c.name} (slug: ${c.slug}, rows: ${c.rowCount ?? 0}, fields: ${
    (c.schema || []).length
  }${c.isPublic ? ", public" : ""})`;
}

module.exports = {
  /**
   * List all collections on the active site.
   * @param {object} args - { id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async list_collections(args = {}) {
    const siteId = activeSiteId(args);
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`);
    const cols = data.collections || [];
    const lines = cols.length ? cols.map(fmtCollection).join("\n") : "No collections on this site.";
    return { content: [{ type: "text", text: lines }] };
  },

  /**
   * Fetch one collection (schema + metadata) by slug.
   * @param {object} args - { slug, id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async get_collection(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
    const list = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`);
    const col = (list.collections || []).find(c => c.slug === args.slug);
    if (!col) throw new Error(`Collection "${args.slug}" not found.`);
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(col._id)}`
    );
    const collection = data.collection || data;
    const isFeed = collection.source?.type === "webhook-feed";
    const shown = isFeed ? { ...collection, source: { type: "webhook-feed", secret: collection.source.secret ? "(set)" : "" } } : collection;
    return {
      content: [
        {
          type: "text",
          text: `\`\`\`json\n${JSON.stringify(shown, null, 2)}\n\`\`\`${isFeed ? `\n\n${webhookFeedLines(webhookFeedInfo(collection))}` : ""}`,
        },
      ],
    };
  },

  /**
   * Make a collection a webhook feed, or set / rotate its signing secret (docs/features/collections.md, source
   * `webhook-feed`). A minted secret is shown once, here.
   * @param {object} args - { slug, rotate?, secret?, id? }
   */
  async set_collection_webhook(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
    const list = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`);
    const found = (list.collections || []).find(c => c.slug === args.slug);
    if (!found) throw new Error(`Collection "${args.slug}" not found.`);
    const url = `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(found._id)}`;
    const col = (await apiFetch(url)).collection;
    const type = col.source?.type || "manual";
    const isFeed = type === "webhook-feed";
    if (!isFeed && type !== "manual") {
      throw new Error(`"${args.slug}" syncs from ${type}. Making it a webhook feed would drop that source's settings: ask the user, then create a new collection with source { type: "webhook-feed" } instead.`);
    }
    if (args.secret !== undefined && (typeof args.secret !== "string" || args.secret.length < 16 || args.secret.length > 256 || /\s/.test(args.secret))) {
      throw new Error("secret must be 16 to 256 characters with no spaces. Leave it out and pass rotate: true to have one made.");
    }
    if (isFeed && col.source.secret && !args.rotate && args.secret === undefined) {
      return { content: [{ type: "text", text: `"${args.slug}" is already a webhook feed with a secret. Pass rotate: true for a new one (the old stops working), or secret to use the sender's own.\n\n${webhookFeedLines(webhookFeedInfo(col))}` }] };
    }
    const secret = args.secret !== undefined ? args.secret : randomBytes(32).toString("hex");
    const data = await apiFetch(url, { method: "PATCH", body: { source: { type: "webhook-feed", secret } } });
    const info = webhookFeedInfo(data.collection || col);
    const shown = args.secret !== undefined ? "Secret stored as given." : `New signing secret (shown ONCE, give it to the user to put in the sender):\n${secret}`;
    const lead = isFeed ? "Secret replaced: senders still using the old one are refused (401) until updated." : `"${args.slug}" is now a webhook feed.`;
    return { content: [{ type: "text", text: `${lead}\n${shown}\n\n${webhookFeedLines(info)}` }] };
  },

  /**
   * Create a new collection on the active site.
   * @param {object} args - { name, slug, description?, schema?, source?, isPublic?, id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async create_collection(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.name) throw new Error("name is required.");
    if (!args.slug) throw new Error("slug is required.");
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

  /**
   * Replace a collection's schema and/or set its membership gates
   * (docs/features/memberships.md "SiteCollection gating"). The server
   * validates plan slugs and field keys.
   * @param {object} args - { slug, schema?, requiredPlans?, memberFields?, requiresCustomerLogin?, id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async update_collection_schema(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
    if (args.schema !== undefined && !Array.isArray(args.schema)) {
      throw new Error("schema must be an array.");
    }
    const body = {};
    for (const key of ["schema", "requiredPlans", "memberFields", "requiresCustomerLogin"]) {
      if (args[key] !== undefined) body[key] = args[key];
    }
    if (!Object.keys(body).length) {
      throw new Error("Pass schema, requiredPlans, memberFields or requiresCustomerLogin.");
    }
    const list = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`);
    const col = (list.collections || []).find(c => c.slug === args.slug);
    if (!col) throw new Error(`Collection "${args.slug}" not found.`);
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(col._id)}`,
      { method: "PATCH", body }
    );
    const saved = data.collection || {};
    const lines = [`Updated "${args.slug}".`];
    if (body.schema) lines.push(`Fields: ${body.schema.length}.`);
    lines.push(
      `Plans that see the rows: ${(saved.requiredPlans || []).join(", ") || "any visitor"}.`,
      `Sign-in required: ${saved.requiresCustomerLogin || (saved.requiredPlans || []).length ? "yes" : "no"}.`,
      `Hidden on locked rows: ${(saved.memberFields || []).join(", ") || "none"}.`,
      `Per-row plan field: ${(saved.schema || []).some(f => f.key === "requiredPlans") ? "yes" : "no"}.`
    );
    return { content: [{ type: "text", text: lines.join(" ") }] };
  },

  /**
   * Delete a collection (and all its rows) by slug.
   * @param {object} args - { slug, id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async delete_collection(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
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

  /**
   * List rows for a collection with cursor pagination.
   * @param {object} args - { slug, limit?, cursor?, id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async list_collection_rows(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
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

  /**
   * Insert a row into a collection.
   * @param {object} args - { slug, data, id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async create_collection_row(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
    if (!args.data || typeof args.data !== "object")
      throw new Error("data is required (must be an object).");
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

  /**
   * Bulk-insert rows into a collection (server cap 500 per call). Each entry in
   * `rows` is a data object keyed by field key (or a `{ data }` wrapper), coerced
   * and validated against the schema. Plan-gated by maxRowsPerCollection.
   * @param {object} args - { slug, rows, id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async create_collection_rows(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
    if (!Array.isArray(args.rows) || args.rows.length === 0)
      throw new Error("rows is required (must be a non-empty array of row-data objects).");
    // Normalize: accept plain data objects OR pre-wrapped { data } entries.
    const rows = args.rows.map(r =>
      r && typeof r === "object" && r.data && typeof r.data === "object" ? r : { data: r }
    );
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(
        args.slug
      )}/rows`,
      { method: "POST", body: { rows } }
    );
    const created = data.created ?? data.rows?.length ?? rows.length;
    return {
      content: [{ type: "text", text: `Created ${created} rows in "${args.slug}".` }],
    };
  },

  /**
   * Import rows into a collection from CSV text or an uploaded CSV/TSV/XLSX
   * file (its mediaId). Columns are matched to schema field keys by name;
   * `mode` controls merge semantics. `upsert` keys on an `externalId` (or
   * `id`) column. Plan-gated by maxRowsPerCollection.
   * @param {object} args - { slug, csv?, mediaId?, mode?, id? } — exactly one of csv | mediaId
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async import_collection_csv(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
    const csv = typeof args.csv === "string" && args.csv.trim() ? args.csv : null;
    const mediaId = typeof args.mediaId === "string" && args.mediaId.trim() ? args.mediaId.trim() : null;
    if (!csv && !mediaId)
      throw new Error("Pass csv (CSV text with a header row) or mediaId (an uploaded CSV/TSV/XLSX file).");
    if (csv && mediaId) throw new Error("Pass either csv or mediaId, not both.");
    const mode = String(args.mode || "append").toLowerCase();
    if (!["append", "replace", "upsert"].includes(mode))
      throw new Error('mode must be one of "append", "replace", "upsert".');
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(
        args.slug
      )}/import?mode=${mode}`,
      { method: "POST", body: mediaId ? { mediaId } : { csv } }
    );
    return {
      content: [
        {
          type: "text",
          text: `CSV import (${mode}) into "${args.slug}": +${data.added ?? 0} added, ${
            data.updated ?? 0
          } updated, ${data.deleted ?? 0} deleted. Total rows: ${data.rowCount ?? "?"}.`,
        },
      ],
    };
  },

  /**
   * Patch one row's data by id.
   * @param {object} args - { slug, rowId, data, id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async update_collection_row(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
    if (!args.rowId) throw new Error("rowId is required.");
    if (!args.data || typeof args.data !== "object")
      throw new Error("data is required (must be an object).");
    await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(
        args.slug
      )}/rows/${encodeURIComponent(args.rowId)}`,
      { method: "PATCH", body: { data: args.data } }
    );
    return {
      content: [{ type: "text", text: `Row ${args.rowId} updated in "${args.slug}".` }],
    };
  },

  /**
   * Delete one row by id.
   * @param {object} args - { slug, rowId, id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async delete_collection_row(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.slug) throw new Error("slug is required.");
    if (!args.rowId) throw new Error("rowId is required.");
    await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(
        args.slug
      )}/rows/${encodeURIComponent(args.rowId)}`,
      { method: "DELETE" }
    );
    return {
      content: [{ type: "text", text: `Row ${args.rowId} deleted from "${args.slug}".` }],
    };
  },
};
