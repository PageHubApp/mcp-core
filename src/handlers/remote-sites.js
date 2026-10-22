/**
 * Site lifecycle tools — create / list / select / pull / update / publish /
 * unpublish / duplicate / delete sites, plus custom domain CRUD. All tools
 * proxy `/api/v1/sites/*` and keep `getContext().activeSite` in sync.
 */

const { apiFetch, normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");

const { getActiveTarget, selectionNote, getEditorUrl } = require("../helpers/index.js");
const { pickSiteMetaArgs, pickSiteMetaUpdates } = require("../helpers/extra-meta-args");
const {
  crawlLines,
  siteOgImageLine,
  timezoneLine,
  languageLine,
  mountOriginLine,
  mountKeyLine,
} = require("../helpers/site-status-lines");

/**
 * The name the dashboard shows for a site (mirrors the app's
 * resolveSiteDisplayName): title, else name, else draft id, with slugs like
 * "fast-donkey" shown as "Fast Donkey".
 */
function siteDisplayName(s) {
  const raw = s.title || s.name || s.draftId || s._id;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(raw)) return raw;
  return raw
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const DEFAULT_BLANK_TEMPLATE = "acme";
const CRAWL_MODES = ["public", "noindex", "private_preview"];

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
    // The server makes the site from the template itself (its stored files); nothing is downloaded or sent back.
    const data = await apiFetch("/api/v1/sites", {
      method: "POST",
      body: { template: slug, ...pickSiteMetaArgs(args) },
    });

    const ctx = getContext();
    ctx.activeSite = { id: data.id, name: data.name, draftId: data.draftId };

    const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
    return {
      content: [
        {
          type: "text",
          text: `New site ${data.id} created from "${slug}".\nActive site set. Editor: ${data.url || `${getEditorUrl(data.id)}`}\nPreview: ${data.previewUrl || `${base}/view/${data.id}`}${selectionNote({ type: "site", id: data.id })}`,
        },
      ],
    };
  },

  /**
   * List all sites owned by the authenticated user, by the name the dashboard
   * shows (title, else name, else draft id) so "the X site" matches.
   * @param {object} _args - (none)
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async list_sites() {
    const data = await apiFetch("/api/v1/sites");
    const lines = (data.sites || []).map(s => {
      const address = s.domain || (s.name ? `${s.name}.pagehub.dev` : null);
      return `• ${s._id} — ${siteDisplayName(s)}${address ? ` [${address}]` : ""} (${s.published ? "published" : "not published"}, updated ${s.updatedAt})`;
    });
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
    // Echo the document-level title/description. They are the site-wide
    // fallback every page's <title> and <meta name="description"> resolve to
    // when that page sets no per-page SEO, and no other tool reads them back —
    // so an agent correcting stale meta had no way to see what was there.
    const lines = [
      `Active site set to ${data.id} (${data.name || "unnamed"})`,
      `Site title: ${data.title ? JSON.stringify(data.title) : "(unset)"}`,
      `Site description: ${data.description ? JSON.stringify(data.description) : "(unset)"}`,
      siteOgImageLine(data),
      `Published: ${data.published ? "yes" : "no"}`,
      crawlLines(data),
      timezoneLine(data),
      languageLine(data),
      mountOriginLine(data),
      mountKeyLine(data, false),
      `Change these with update_site; per-page overrides go through update_page seo.`,
      `Edit with list_site_files / read_site_file / edit_site_file (rules: get_style_reference({ topic: "liquid" })).`,
    ];
    return {
      content: [{ type: "text", text: lines.filter(Boolean).join("\n") + selectionNote({ type: "site", id: data.id }) }],
    };
  },

  /**
   * Patch site-level metadata (name / title / description / share image / crawler, timezone
   * and mount-origin settings).
   * @param {object} args - { name?, title?, description?, ogImage?, crawlMode?, blockAiCrawlers?, timezone?, language?, mountOrigin?, rotateMountKey?, siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async update_site(args = {}) {
    const target = getActiveTarget(args);
    const body = pickSiteMetaUpdates(args);
    // The v1 route keeps crawlPolicy fields that are omitted, so sending only
    // `mode` / `blockAi` leaves the rest (incl. custom robots.txt) untouched.
    const crawlPolicy = {};
    if (CRAWL_MODES.includes(args.crawlMode)) crawlPolicy.mode = args.crawlMode;
    else if (args.crawlMode !== undefined) {
      throw new Error(`crawlMode must be one of: ${CRAWL_MODES.join(", ")}.`);
    }
    if (typeof args.blockAiCrawlers === "boolean") crawlPolicy.blockAi = args.blockAiCrawlers;
    if (Object.keys(crawlPolicy).length) body.crawlPolicy = crawlPolicy;
    // "" clears it; the route validates the IANA name.
    if (typeof args.timezone === "string") body.timezone = args.timezone.trim();
    // "" clears it ("en"); the route validates the BCP 47 tag.
    if (typeof args.language === "string") body.language = args.language.trim();
    // "" clears it; the route validates the bare https origin.
    if (typeof args.mountOrigin === "string") body.mountOrigin = args.mountOrigin.trim();
    if (args.rotateMountKey === true) body.rotateMountKey = true;
    if (Object.keys(body).length === 0) {
      throw new Error(
        "update_site requires at least one of: name, title, description, ogImage, crawlMode, blockAiCrawlers, timezone, language, mountOrigin, rotateMountKey."
      );
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
          text:
            `Site ${target.id} updated (${changed}).\n` +
            `Site title: ${data?.title ? JSON.stringify(data.title) : "(unset)"}\n` +
            `Site description: ${data?.description ? JSON.stringify(data.description) : "(unset)"}\n` +
            `${siteOgImageLine(data)}\n` +
            crawlLines(data) +
            `\n${timezoneLine(data)}` +
            (body.language !== undefined ? `\n${languageLine(data)}` : "") +
            `\n${mountOriginLine(data)}` +
            (data?.mountKey ? `\n${mountKeyLine(data, true)}` : ""),
        },
      ],
    };
  },

  /**
   * Mark the active site as published.
   * @param {object} args - { id? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async publish_site(args = {}) {
    const target = getActiveTarget(args);
    const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`, {
      method: "PUT",
      body: { published: true },
    });
    // Edits stage into the draft, so publishing is what promotes them. Say
    // whether that happened — "published" alone does not distinguish a promotion
    // from a no-op flag flip on a site that was already live.
    const promoted = put?.promoted ? " Staged draft promoted to live." : "";
    return {
      content: [{ type: "text", text: `Site ${target.id} published.${promoted}` }],
    };
  },

  /**
   * Unpublish the active site.
   * @param {object} args - { siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async unpublish_site(args) {
    const target = getActiveTarget(args);
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

    const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
    return {
      content: [
        {
          type: "text",
          text: `Site ${data.id} duplicated from ${data.sourceId}.\nActive site set. Editor: ${data.url || `${getEditorUrl(data.id)}`}\nPreview: ${data.previewUrl || `${base}/view/${data.id}`}${selectionNote({ type: "site", id: data.id })}`,
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
    const qs = args.check ? `?check=${encodeURIComponent(args.check)}` : "";
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/domain${qs}`);
    return { content: [{ type: "text", text: formatDomainReport(data) }] };
  },

  /**
   * Screenshot the active site's draft preview in a real browser, so an agent
   * can compare what painted against the design it was building.
   * @param {object} args - { id?, path?, width?, height?, fullPage?, selector? }
   * @returns {Promise<{content: Array<object>}>}
   */
  async screenshot_site(args = {}) {
    const target = getActiveTarget(args);
    const { path, width, height, fullPage, selector } = args;
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/screenshot`, {
      method: "POST",
      body: { path, width, height, fullPage, selector },
    });
    return {
      content: [
        { type: "image", data: data.dataBase64, mimeType: data.contentType },
        { type: "text", text: `Draft preview: ${data.url}${selector ? ` (element ${selector})` : ""}` },
      ],
    };
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
   * create. Detaching is clear_domain.
   * @param {object} args - { domain, redirectMode?, siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async set_domain(args = {}) {
    const target = getActiveTarget(args);
    if (!args.domain) throw new Error("domain is required. To remove a domain, use clear_domain.");
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
   * @param {object} args - { inviteId, id? } — id defaults to active site.
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async revoke_site_invite(args = {}) {
    const ctx = getContext();
    const siteId = args.id || ctx.activeSite?.id;
    if (!siteId) throw new Error("Site id is required (none provided and no active site set).");
    if (!args.inviteId) throw new Error("inviteId is required (get it from list_site_members).");
    await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/invites?inviteId=${encodeURIComponent(args.inviteId)}`,
      { method: "DELETE" }
    );
    return {
      content: [
        { type: "text", text: `Revoked pending invite ${args.inviteId} on site ${siteId}.` },
      ],
    };
  },
};
