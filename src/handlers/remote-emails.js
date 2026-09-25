/**
 * Site email tools — the emails a site's visitors get (order receipt, gift
 * card, sign-in link, downloads), designed as PageHub node trees. All proxy
 * `/api/v1/sites/[id]/emails/*`. See docs/features/site-email-templates.md.
 */

const { apiFetch } = require("../core/api-fetch");
const { compressJsonToBase64Lz } = require("../codec/lz");
const { getActiveTarget, decodeContentOrThrow } = require("../helpers/index.js");

/** Site id for an email tool; emails belong to sites, never templates. */
function siteIdFor(args, tool) {
  const target = getActiveTarget(args);
  if (target.type !== "site") throw new Error(`${tool} only works on sites, not templates.`);
  return encodeURIComponent(target.id);
}

function kindPath(args, tool) {
  if (!args.kind) throw new Error("kind is required. Call list_site_emails to see the kinds.");
  return `/api/v1/sites/${siteIdFor(args, tool)}/emails/${encodeURIComponent(args.kind)}`;
}

const text = t => ({ content: [{ type: "text", text: t }] });

module.exports = {
  /**
   * Every email kind for the site: customized or default, and whether it's sent.
   * @param {object} args - { id? }
   */
  async list_site_emails(args = {}) {
    const rows = await apiFetch(`/api/v1/sites/${siteIdFor(args, "list_site_emails")}/emails`);
    const lines = rows.map(
      r =>
        `- ${r.kind} (${r.group}: ${r.name}) — ${r.customized ? "customized" : "default"}` +
        (r.enabled ? "" : `; not sent: ${r.reason}`)
    );
    return text(lines.join("\n"));
  },

  /**
   * One email: subject, preheader, the node tree (decompressed; the default when
   * not customized), its variables and slots.
   * @param {object} args - { id?, kind }
   */
  async get_site_email(args = {}) {
    const data = await apiFetch(kindPath(args, "get_site_email"));
    const nodes = decodeContentOrThrow(data.content || data.defaults.content, "email content");
    return text(
      JSON.stringify(
        {
          customized: !!data.content,
          subject: data.subject,
          preheader: data.preheader,
          defaults: { subject: data.defaults.subject, preheader: data.defaults.preheader },
          variables: data.variables.map(v => ({ token: `{{variables.${v.key}}}`, label: v.label })),
          slots: data.slots,
          nodes,
        },
        null,
        2
      )
    );
  },

  /**
   * Save subject / preheader / node tree, or reset the email to the default.
   * @param {object} args - { id?, kind, subject?, preheader?, nodes?, reset? }
   */
  async update_site_email(args = {}) {
    const path = kindPath(args, "update_site_email");
    if (args.reset) {
      await apiFetch(path, { method: "DELETE" });
      return text(`${args.kind} reset to the default.`);
    }
    const body = {};
    if (args.subject !== undefined) body.subject = args.subject;
    if (args.preheader !== undefined) body.preheader = args.preheader;
    if (args.nodes !== undefined) body.content = compressJsonToBase64Lz(args.nodes);
    if (!Object.keys(body).length) throw new Error("Pass subject, preheader, nodes, or reset: true.");
    const res = await apiFetch(path, { method: "PUT", body });
    const warnings = (res.issues || []).map(i => `- ${i.nodeId}: ${i.message}`);
    return text(`${args.kind} saved.${warnings.length ? `\nWarnings:\n${warnings.join("\n")}` : ""}`);
  },

  /**
   * Render the saved email with sample data: subject, problems and plain text.
   * @param {object} args - { id?, kind }
   */
  async preview_site_email(args = {}) {
    const data = await apiFetch(`${kindPath(args, "preview_site_email")}/preview`, {
      method: "POST",
      body: {},
    });
    const list = items => items.map(i => `- ${i.nodeId ? `${i.nodeId}: ` : ""}${i.message}`).join("\n");
    const parts = [`Subject: ${data.subject}`];
    if (data.errors.length) parts.push(`Errors (the default email renders instead):\n${list(data.errors)}`);
    if (data.warnings.length) parts.push(`Warnings:\n${list(data.warnings)}`);
    parts.push(`Plain text:\n${data.text}`);
    return text(parts.join("\n\n"));
  },
};
