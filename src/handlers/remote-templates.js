const { apiFetch } = require("../api-fetch");
const { getContext } = require("../context");
const { parseMaybeJson, getActiveTarget } = require("../helpers");
const { quickA11yAudit } = require("../a11y-check");

module.exports = {
  async select_template(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required.");
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    const ctx = getContext();
    ctx.activeTemplate = { slug: data.slug, title: data.title };
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

  async pull_template(args) {
    const { slug } = args;
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    const nodeCount = data.content ? Object.keys(data.content).length : 0;
    return {
      content: [
        {
          type: "text",
          text: `Template "${slug}" fetched (${nodeCount} nodes).\n\n\`\`\`json\n${JSON.stringify(data.content, null, 2)}\n\`\`\``,
        },
      ],
    };
  },

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
      throw new Error("slug, title, and content are required");
    }
    const data = await apiFetch("/api/v1/templates", {
      method: "POST",
      body: {
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
      },
    });
    const audit = quickA11yAudit(content);
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
      content: siteData.content,
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

  async update_template(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required");
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
    if (Object.keys(body).length === 0) {
      throw new Error("Nothing to update. Provide at least one field.");
    }
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`, {
      method: "PUT",
      body,
    });
    const audit = args.content ? quickA11yAudit(args.content) : null;
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

  async delete_template(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required");
    await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`, { method: "DELETE" });
    return { content: [{ type: "text", text: `Template "${slug}" deleted.` }] };
  },
};
