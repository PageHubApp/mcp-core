/**
 * Site lifecycle tools — create / list / select / pull / update / publish /
 * unpublish / duplicate / delete sites, plus custom domain CRUD. All tools
 * proxy `/api/v1/sites/*` and keep `getContext().activeSite` in sync.
 */

const { apiFetch, normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");

const { getActiveTarget, fetchTarget, decodeContentOrThrow } = require("../helpers/index.js");
const { pickSiteMetaArgs, pickSiteMetaUpdates } = require("../helpers/extra-meta-args");

const DEFAULT_BLANK_TEMPLATE = "acme";

/**
 * Render a `/api/v1/sites/[id]/domain` payload (GET or PATCH — both carry
 * `variants`) as agent-readable text: attachment state per variant, then the
 * DNS records the user still has to create.
 *
 * The records come from the route, never from here — an apex needs an A record
 * and a subdomain needs a CNAME, and the values are per-project, so guessing
 * them client-side hands the user DNS that silently never verifies.
 */
function formatDomainReport(data) {
  const lines = [];
  if (data.domain) {
    lines.push(`Current domain: ${data.domain} (redirect: ${data.domainRedirectMode})`);
  } else {
    lines.push("No custom domain set.");
  }
  if (data.checked && data.checked !== data.domain) lines.push(`Checked: ${data.checked}`);

  const variants = data.variants || [];
  if (variants.length) {
    lines.push("");
    for (const v of variants) {
      const dns = v.live ? "DNS live" : "DNS not pointing here yet";
      if (v.attachedToPagehub) {
        const r = v.redirect ? ` → redirects to ${v.redirect} (${v.redirectStatusCode})` : "";
        lines.push(`  ${v.name}: attached to pagehub${r} — ${dns}`);
      } else if (v.available) {
        lines.push(`  ${v.name}: available (or on another team) — ${dns}`);
      } else {
        lines.push(`  ${v.name}: ${v.error?.code || "unknown"} — ${v.error?.message || ""}`);
      }
      if (v.configError) {
        lines.push(`    warning: ${v.configError} — records below are Vercel's generic fallback.`);
      }
    }
  }

  const records = variants.flatMap(v => v.records || []);
  if (records.length) {
    lines.push("");
    lines.push("DNS records to create at the registrar:");
    for (const r of records) {
      const scope = r.domain && variants.length > 1 ? `   (for ${r.domain})` : "";
      lines.push(`  ${String(r.type).padEnd(5)} ${String(r.name).padEnd(6)} → ${r.value}${scope}`);
    }
  } else if (variants.length) {
    lines.push("");
    lines.push("No DNS changes needed — every variant already resolves here.");
  }

  return lines.join("\n");
}

module.exports = {
  /**
   * Create a new site from a template (defaults to "acme" blank template)
   * and set it as the active target.
   * @param {object} args - { template?, name?, title?, description? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async create_site(args = {}) {
    const slug = args.template || DEFAULT_BLANK_TEMPLATE;
    const tpl = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    const content = decodeContentOrThrow(tpl.content, `Template "${slug}" content`);

    const data = await apiFetch("/api/v1/sites", {
      method: "POST",
      body: {
        content,
        ...pickSiteMetaArgs(args),
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

  /**
   * List all sites owned by the authenticated user.
   * @param {object} _args - (none)
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
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

  /**
   * Mark a site as the active target for subsequent tool calls.
   * @param {object} args - { id }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
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

  /**
   * Dump the full CraftJS flat node map for the active site/template.
   * @param {object} args - { siteId?, templateSlug? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
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

  /**
   * Patch site-level metadata (name / title / description).
   * @param {object} args - { name?, title?, description?, siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async update_site(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site") throw new Error("update_site only works on sites, not templates.");
    const body = pickSiteMetaUpdates(args);
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

  /**
   * Mark the active site as published.
   * @param {object} args - { siteId?, static? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async publish_site(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site") throw new Error("publish_site only works on sites, not templates.");
    const body = { published: true };
    if (args.static !== undefined) body.staticPublish = !!args.static;
    const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`, {
      method: "PUT",
      body,
    });
    const mode =
      args.static === undefined
        ? ""
        : ` (turbo/static delivery ${args.static ? "on" : "off"})`;
    // Edits stage into the draft, so publishing is what promotes them. Say
    // whether that happened — "published" alone does not distinguish a promotion
    // from a no-op flag flip on a site that was already live.
    const promoted = put?.promoted ? " Staged draft promoted to live." : "";
    const ctx = getContext();
    if (ctx._lastSiteWrite && String(ctx._lastSiteWrite.id) === String(target.id)) {
      ctx._lastSiteWrite = null;
    }
    return {
      content: [{ type: "text", text: `Site ${target.id} published${mode}.${promoted}` }],
    };
  },

  /**
   * Unpublish the active site.
   * @param {object} args - { siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
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

  /**
   * Duplicate an existing site (defaults to the active one) and set the copy
   * as active.
   * @param {object} args - { id?, name?, title?, description? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async duplicate_site(args = {}) {
    const ctx = getContext();
    const sourceId = args.id || ctx.activeSite?.id;
    if (!sourceId) throw new Error("Site id is required (none provided and no active site set).");

    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(sourceId)}/duplicate`, {
      method: "POST",
      body: pickSiteMetaArgs(args),
    });

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

  /**
   * Inspect the current custom-domain status — attachment per variant plus the
   * DNS records still to create.
   * @param {object} args - { siteId?, check? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async get_domain_status(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site")
      throw new Error("get_domain_status only works on sites, not templates.");
    const qs = args.check ? `?check=${encodeURIComponent(args.check)}` : "";
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/domain${qs}`);
    return { content: [{ type: "text", text: formatDomainReport(data) }] };
  },

  /**
   * Probe a candidate domain without binding it (shortcut for get_domain_status).
   * @param {object} args - { domain, siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async check_domain(args = {}) {
    if (!args.domain) throw new Error("domain is required.");
    return module.exports.get_domain_status({ ...args, check: args.domain });
  },

  /**
   * Bind a custom domain to the active site, and report the DNS records to
   * create. Pass `domain: null` to detach (same as clear_domain).
   * @param {object} args - { domain, redirectMode?, siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async set_domain(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site") throw new Error("set_domain only works on sites, not templates.");
    if (args.domain === null) return module.exports.clear_domain(args);
    if (!args.domain) throw new Error("domain is required. Pass null (or use clear_domain) to remove.");
    const body = { domain: args.domain };
    if (args.redirectMode) body.domainRedirectMode = args.redirectMode;
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/domain`, {
      method: "PATCH",
      body,
    });
    if (data?.ok === false || data?.error) {
      const lines = [`Domain change failed: ${data.error || "unknown"}`];
      if (data.message) lines.push(data.message);
      if (Array.isArray(data.conflicts)) {
        for (const c of data.conflicts) {
          lines.push(`  - ${c.domain}: ${c.reason}${c.message ? ` (${c.message})` : ""}`);
        }
        lines.push("");
        lines.push(
          "Fix: open the conflicting Vercel project → Settings → Domains → remove the listed names, then retry."
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
    }
    const head = data.noop
      ? `Domain already set on site ${target.id} — nothing changed.`
      : `Domain set on site ${target.id}.`;
    return { content: [{ type: "text", text: `${head}\n${formatDomainReport(data)}` }] };
  },

  /**
   * Remove the active site's custom domain binding.
   * @param {object} args - { siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async clear_domain(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site") throw new Error("clear_domain only works on sites, not templates.");
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/domain`, {
      method: "DELETE",
    });
    const lines = [`Domain cleared from site ${target.id}.`];
    // The site is unbound regardless, but a variant Vercel refused to release
    // will block re-attaching that domain later — don't report a clean removal.
    for (const f of data?.detachFailures || []) {
      lines.push(
        `  warning: ${f.domain} is still attached to the Vercel project (${f.code || "error"}${f.message ? `: ${f.message}` : ""}). Remove it in the Vercel dashboard before reusing this domain.`
      );
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },

  /**
   * Change the apex ↔ www redirect mode without touching the domain itself.
   * @param {object} args - { redirectMode, siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async set_domain_redirect_mode(args = {}) {
    const target = getActiveTarget(args);
    if (target.type !== "site") throw new Error("set_domain_redirect_mode only works on sites.");
    if (!args.redirectMode) throw new Error("redirectMode is required.");
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/domain`, {
      method: "PATCH",
      body: { domainRedirectMode: args.redirectMode },
    });
    return {
      content: [
        {
          type: "text",
          text: `Redirect mode: ${data.domainRedirectMode} on ${data.domain || "(no domain)"}.`,
        },
      ],
    };
  },

  /**
   * Permanently delete a site by id.
   * @param {object} args - { id }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async delete_site(args) {
    const { id } = args;
    await apiFetch(`/api/v1/sites/${encodeURIComponent(id)}`, { method: "DELETE" });
    const ctx = getContext();
    if (ctx.activeSite?.id === id) ctx.activeSite = null;
    return { content: [{ type: "text", text: `Site ${id} deleted.` }] };
  },

  /**
   * Invite a person to a site by email with a role. Owner-gated: you can only
   * invite to sites you own. Sends the same invite email the dashboard Team
   * page sends (recipient signs in / signs up, then joins the site).
   * @param {object} args - { email, role?, id? } — role defaults to "editor".
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async invite_site_member(args = {}) {
    const ctx = getContext();
    const siteId = args.id || ctx.activeSite?.id;
    if (!siteId) throw new Error("Site id is required (none provided and no active site set).");
    if (!args.email) throw new Error("email is required.");
    const role = args.role || "editor";
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/invites`, {
      method: "POST",
      body: { email: args.email, role },
    });
    if (data?.alreadyMember) {
      return {
        content: [
          {
            type: "text",
            text: `${data.email} is already a member of site ${siteId} — no invite sent.`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Invited ${data.email} to site ${siteId} as ${data.role}. An invite email was sent.`,
        },
      ],
    };
  },

  /**
   * List a site's members and pending invites. Owner-gated.
   * @param {object} args - { id? } — defaults to active site.
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async list_site_members(args = {}) {
    const ctx = getContext();
    const siteId = args.id || ctx.activeSite?.id;
    if (!siteId) throw new Error("Site id is required (none provided and no active site set).");
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/invites`);
    const members = (data.members || []).map(m => `  • ${String(m.role).padEnd(6)} ${m.email}`);
    const invites = (data.invites || []).map(
      i => `  • ${String(i.role).padEnd(6)} ${i.email} — pending (id: ${i.id}, expires ${i.expiresAt})`
    );
    const lines = [
      `Site ${siteId}${data.name ? ` (${data.name})` : ""}`,
      `Members (${members.length}):`,
      ...(members.length ? members : ["  (none)"]),
      `Pending invites (${invites.length}):`,
      ...(invites.length ? invites : ["  (none)"]),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },

  /**
   * Revoke a pending site invite by its id (from list_site_members). Owner-gated.
   * @param {object} args - { invite_id, id? } — id defaults to active site.
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async revoke_site_invite(args = {}) {
    const ctx = getContext();
    const siteId = args.id || ctx.activeSite?.id;
    if (!siteId) throw new Error("Site id is required (none provided and no active site set).");
    if (!args.invite_id) throw new Error("invite_id is required (get it from list_site_members).");
    await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/invites?inviteId=${encodeURIComponent(args.invite_id)}`,
      { method: "DELETE" }
    );
    return {
      content: [
        { type: "text", text: `Revoked pending invite ${args.invite_id} on site ${siteId}.` },
      ],
    };
  },
};
