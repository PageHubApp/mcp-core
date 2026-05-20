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

  async update_site(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site") throw new Error("update_site only works on sites, not templates.");
    const body = {};
    if (typeof args.name === "string") body.name = args.name.trim() || null;
    if (typeof args.title === "string") body.title = args.title.trim() || null;
    if (typeof args.description === "string") body.description = args.description.trim() || null;
    if (Object.keys(body).length === 0) {
      throw new Error("update_site requires at least one of: name, title, description.");
    }
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`, {
      method: "PUT",
      body,
    });
    const changed = Object.entries(body)
      .map(([k, v]) => `${k}=${v === null ? "(cleared)" : JSON.stringify(v)}`)
      .join(", ");
    return {
      content: [
        {
          type: "text",
          text: `Site ${target.id} updated (${changed}). Current name=${data?.name ?? "(none)"}, title=${data?.title ?? "(none)"}.`,
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

  async get_domain_status(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site")
      throw new Error("get_domain_status only works on sites, not templates.");
    const qs = args.check ? `?check=${encodeURIComponent(args.check)}` : "";
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(target.id)}/domain${qs}`
    );
    const lines = [];
    if (data.domain)
      lines.push(`Current domain: ${data.domain} (redirect: ${data.domainRedirectMode})`);
    else lines.push("No custom domain set.");
    if (data.checked && data.checked !== data.domain)
      lines.push(`Checked: ${data.checked}`);
    if (data.variants?.length) {
      lines.push("");
      for (const v of data.variants) {
        if (v.attachedToPagehub) {
          const r = v.redirect ? ` → redirects to ${v.redirect} (${v.redirectStatusCode})` : "";
          lines.push(`  ${v.name}: attached to pagehub${r}`);
        } else if (v.available) {
          lines.push(`  ${v.name}: available (or on another team)`);
        } else {
          lines.push(`  ${v.name}: ${v.error?.code || "unknown"} — ${v.error?.message || ""}`);
        }
      }
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },

  async check_domain(args = {}) {
    if (!args.domain) throw new Error("domain is required");
    return module.exports.get_domain_status({ ...args, check: args.domain });
  },

  async set_domain(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site")
      throw new Error("set_domain only works on sites, not templates.");
    if (!args.domain) throw new Error("domain is required (use clear_domain to remove)");
    const body = { domain: args.domain };
    if (args.redirectMode) body.domainRedirectMode = args.redirectMode;
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(target.id)}/domain`,
      { method: "PATCH", body }
    );
    if (data?.ok === false || data?.error) {
      const lines = [`Domain change failed: ${data.error || "unknown"}`];
      if (data.message) lines.push(data.message);
      if (Array.isArray(data.conflicts)) {
        for (const c of data.conflicts) {
          lines.push(
            `  - ${c.domain}: ${c.reason}${c.message ? ` (${c.message})` : ""}`
          );
        }
        lines.push("");
        lines.push(
          "Fix: open the conflicting Vercel project → Settings → Domains → remove the listed names, then retry."
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
    }
    return {
      content: [
        {
          type: "text",
          text: `Domain set: ${data.domain} (redirect: ${data.domainRedirectMode}).\nDNS: point apex (A → 76.76.21.21) and www (CNAME → cname.vercel-dns.com) at Vercel.`,
        },
      ],
    };
  },

  async clear_domain(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site")
      throw new Error("clear_domain only works on sites, not templates.");
    await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/domain`, {
      method: "DELETE",
    });
    return { content: [{ type: "text", text: `Domain cleared from site ${target.id}.` }] };
  },

  async set_domain_redirect_mode(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site")
      throw new Error("set_domain_redirect_mode only works on sites.");
    if (!args.redirectMode) throw new Error("redirectMode is required");
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(target.id)}/domain`,
      { method: "PATCH", body: { domainRedirectMode: args.redirectMode } }
    );
    return {
      content: [
        {
          type: "text",
          text: `Redirect mode: ${data.domainRedirectMode} on ${data.domain || "(no domain)"}.`,
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
