/**
 * Site email tools — the emails a site's visitors get (order receipt, gift card, sign-in link, downloads). Each is a
 * Liquid file of the site (`emails/<kind>.liquid`, subject / preview text in `emails/<kind>.json`). All proxy
 * `/api/v1/sites/[id]/emails/*`, which reads and writes those files. See docs/features/site-email-templates.md.
 */

const { apiFetch } = require("../core/api-fetch");
const { getActiveTarget } = require("../helpers/index.js");

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

/** One issue as a line: Liquid issues point at a line of the source, not at a node. */
const issueLine = i => `- ${i.nodeId ? `${i.nodeId}: ` : ""}${i.message}`;

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
   * One email: subject, preheader, its Liquid source (the default when not customized), the objects it can use and
   * its parts.
   * @param {object} args - { id?, kind }
   */
  async get_site_email(args = {}) {
    const data = await apiFetch(kindPath(args, "get_site_email"));
    return text(
      JSON.stringify(
        {
          customized: typeof data.source === "string",
          subject: data.subject,
          preheader: data.preheader,
          defaults: { subject: data.defaults.subject, preheader: data.defaults.preheader },
          objects: data.variables.map(v => ({ token: `{{ ${v.key} }}`, label: v.label })),
          parts: data.slots,
          source: data.source ?? data.defaults.source,
        },
        null,
        2
      )
    );
  },

  /**
   * Save subject / preheader / Liquid source, or reset the email to the default.
   * @param {object} args - { id?, kind, subject?, preheader?, source?, reset? }
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
    if (args.source !== undefined) body.source = args.source;
    if (!Object.keys(body).length) throw new Error("Pass subject, preheader, source, or reset: true.");
    const res = await apiFetch(path, { method: "PUT", body });
    const warnings = (res.warnings || []).map(issueLine);
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
    const list = items => items.map(issueLine).join("\n");
    const parts = [`Subject: ${data.subject}`];
    if (data.errors.length) parts.push(`Errors (the default email renders instead):\n${list(data.errors)}`);
    if (data.warnings.length) parts.push(`Warnings:\n${list(data.warnings)}`);
    parts.push(`Plain text:\n${data.text}`);
    return text(parts.join("\n\n"));
  },
};
