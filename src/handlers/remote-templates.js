/**
 * Template lifecycle tools — select / list / pull / save / update / delete /
 * publish-site-as-template. Wraps `/api/v1/templates/*` and keeps
 * `getContext().activeTemplate` in sync.
 */

const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");

const {
  parseMaybeJson,
  getActiveTarget,
  compressJsonToBase64Lz,
  decodeContentOrThrow,
} = require("../helpers/index.js");

const { quickA11yAudit } = require("../validation/a11y-check");

module.exports = {
  /**
   * Mark a template as the active target for subsequent tool calls.
   * @param {object} args - { slug }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async select_template(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required.");
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    const ctx = getContext();
    ctx.activeTemplate = { slug: data.slug, title: data.title };
    if (!ctx._targetRevisions || typeof ctx._targetRevisions !== "object")
      ctx._targetRevisions = {};
    if (Number.isFinite(Number(data.version))) {
      ctx._targetRevisions[`template:${data.slug}`] = { expectedVersion: Number(data.version) };
    }
    // Clear activeSite so template takes priority
    ctx.activeSite = null;
    return {
      content: [
        {
          type: "text",
          text: `Active template set to "${data.slug}" (${data.title || "untitled"})`,
        },
      ],
    };
  },

  /**
   * Browse the template catalog with optional filters.
   * @param {object} args - { category?, tag?, q? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async list_templates(args = {}) {
    const params = new URLSearchParams();
    if (args.category) params.set("category", args.category);
    if (args.tag) params.set("tag", args.tag);
    if (args.q) params.set("q", args.q);
    const qs = params.toString();
    const data = await apiFetch(`/api/v1/templates${qs ? `?${qs}` : ""}`);
    const lines = (data.templates || []).map(t => {
      let line = `• ${t.slug} — ${t.title}`;
      if (t.category) line += ` [${t.category}]`;
      if (t.tags?.length) line += ` (${t.tags.join(", ")})`;
      if (t.hidden) line += " (hidden)";
      return line;
    });
    return {
      content: [{ type: "text", text: lines.length ? lines.join("\n") : "No templates found." }],
    };
  },

  /**
   * Fetch a template's full decoded node map by slug.
   * @param {object} args - { slug }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async pull_template(args) {
    const { slug } = args;
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    const ctx = getContext();
    if (!ctx._targetRevisions || typeof ctx._targetRevisions !== "object")
      ctx._targetRevisions = {};
    if (Number.isFinite(Number(data.version))) {
      ctx._targetRevisions[`template:${slug}`] = { expectedVersion: Number(data.version) };
    }
    const decodedContent = decodeContentOrThrow(data.content, `Template "${slug}" content`);
    const nodeCount = Object.keys(decodedContent).length;
    return {
      content: [
        {
          type: "text",
          text: `Template "${slug}" fetched (${nodeCount} nodes).\n\n\`\`\`json\n${JSON.stringify(decodedContent, null, 2)}\n\`\`\``,
        },
      ],
    };
  },

  /**
   * Create a new template from a raw or compressed content payload.
   * @param {object} args - { slug, title, description?, image?, category?, tags?, content, hidden?, isPublic?, sortOrder? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async save_template(args) {
    const {
      slug,
      title,
      description,
      image,
      category,
      tags,
      content,
      hidden,
      isPublic,
      sortOrder,
    } = args;
    if (!slug || !title || !content) {
      throw new Error("slug, title, and content are required.");
    }
    const resolvedContent = parseMaybeJson(content) || content;
    const encodedContent =
      typeof resolvedContent === "string"
        ? resolvedContent
        : compressJsonToBase64Lz(resolvedContent);
    const data = await apiFetch("/api/v1/templates", {
      method: "POST",
      body: {
        slug,
        title,
        description,
        image,
        category,
        tags,
        content: encodedContent,
        hidden,
        isPublic,
        sortOrder,
      },
    });
    const audit = typeof resolvedContent === "object" ? quickA11yAudit(resolvedContent) : null;
    const auditText = audit ? `\n\n---\n${audit.summary}` : "";
    return {
      content: [
        {
          type: "text",
          text: `Template saved: **${data.title}** (\`${data.slug}\`)${auditText}`,
        },
      ],
    };
  },

  /**
   * Snapshot the active site into a new template entry.
   * @param {object} args - { slug?, title?, description?, image?, category?, tags?, hidden?, isPublic?, sortOrder? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async publish_site_as_template(args) {
    const { slug, title, description, image, category, tags, hidden, isPublic, sortOrder } = args;
    const target = getActiveTarget(args);
    if (target.type !== "site")
      throw new Error("Active target must be a site. Use select_site first.");
    const siteData = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`);
    if (!siteData.content) throw new Error("Site has no content.");
    const finalSlug = slug || siteData.slug || target.id;
    const finalTitle = title || siteData.name || siteData.title || finalSlug;
    const body = {
      slug: finalSlug,
      title: finalTitle,
      content: compressJsonToBase64Lz(siteData.content),
      ...(description && { description }),
      ...(image && { image }),
      ...(category && { category }),
      ...(tags && { tags }),
      ...(hidden !== undefined && { hidden }),
      ...(isPublic !== undefined && { isPublic }),
      ...(sortOrder !== undefined && { sortOrder }),
    };
    const data = await apiFetch("/api/v1/templates", { method: "POST", body });
    const audit = quickA11yAudit(siteData.content);
    const auditText = audit ? `\n\n---\n${audit.summary}` : "";
    return {
      content: [
        {
          type: "text",
          text: `Site published as template: **${data.title}** (\`${data.slug}\`)\nPreview: ${data.image || "no image set"}${auditText}`,
        },
      ],
    };
  },

  /**
   * Patch an existing template (optimistic-concurrency on `version`).
   * @param {object} args - { slug, title?, description?, image?, category?, tags?, content?, hidden?, sortOrder? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async update_template(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required.");
    const current = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    const expectedVersion = Number(current?.version || 1);
    const body = {};
    for (const f of [
      "title",
      "description",
      "image",
      "category",
      "tags",
      "content",
      "hidden",
      "sortOrder",
    ]) {
      if (args[f] !== undefined) body[f] = args[f];
    }
    if (body.content !== undefined) {
      const resolvedContent = parseMaybeJson(body.content) || body.content;
      body.content =
        typeof resolvedContent === "string"
          ? resolvedContent
          : compressJsonToBase64Lz(resolvedContent);
    }
    if (Object.keys(body).length === 0) {
      throw new Error("Nothing to update. Provide at least one field.");
    }
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`, {
      method: "PUT",
      body: { ...body, expectedVersion },
    });
    const parsedAuditContent = parseMaybeJson(args.content);
    const audit =
      parsedAuditContent && typeof parsedAuditContent === "object"
        ? quickA11yAudit(parsedAuditContent)
        : null;
    const auditText = audit ? `\n\n---\n${audit.summary}` : "";
    return {
      content: [
        {
          type: "text",
          text: `Template updated: **${data.title}** (\`${data.slug}\`)${auditText}`,
        },
      ],
    };
  },

  /**
   * Delete a template by slug.
   * @param {object} args - { slug }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async delete_template(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required.");
    await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`, { method: "DELETE" });
    return { content: [{ type: "text", text: `Template "${slug}" deleted.` }] };
  },
};
