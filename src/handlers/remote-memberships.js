/**
 * Memberships — plans a site sells or gives away, and the site customers who
 * hold them. Wraps the owner routes `/api/user/sites/:id/memberships/*`
 * (docs/features/memberships.md "Owner UI" + "MCP tools"); every entitlement
 * rule lives server-side, these tools only shape requests and replies.
 */

const { apiFetch } = require("../core/api-fetch");
const { getActiveTarget } = require("../helpers/index.js");

function base(args, tool) {
  const target = getActiveTarget(args);
  return `/api/user/sites/${encodeURIComponent(target.id)}/memberships`;
}

const day = d => (d ? String(d).slice(0, 10) : null);

function fmtPlan(p) {
  const prices = (p.stripePriceIds || []).length ? `prices: ${p.stripePriceIds.join(", ")}` : "no prices (free)";
  const length = p.accessDays ? `${p.accessDays} days per one-time purchase` : "lifetime / while subscribed";
  const flags = [p.selfSignup && "free self-signup", p.archived && "archived"].filter(Boolean);
  return `• ${p.name} [slug: ${p.slug}] — ${prices}; ${length}${flags.length ? `; ${flags.join(", ")}` : ""}`;
}

function fmtMembership(m) {
  const exp = m.expiresAt ? ` until ${day(m.expiresAt)}` : "";
  return `${m.plan} (${m.status}, ${m.source}${exp})`;
}

function fmtMember(c) {
  const id = c.id || c._id;
  const plans = (c.memberships || []).map(fmtMembership).join("; ") || "no plans";
  const who = c.name ? `${c.name} <${c.email}>` : c.email;
  return `• ${who} [customerId: ${id}]${c.blocked ? " BLOCKED" : ""} — ${plans}`;
}

const PLAN_FIELDS = ["name", "description", "stripePriceIds", "accessDays", "selfSignup", "archived"];

/** Find a member's id by exact email, for actions given an email instead of a customerId. */
async function customerIdFor(root, email) {
  const data = await apiFetch(`${root}/members?${new URLSearchParams({ q: email })}`);
  const want = String(email).trim().toLowerCase();
  const hit = (data.members || []).find(c => String(c.email || "").toLowerCase() === want);
  if (!hit) throw new Error(`No member with email ${email}. Use action "add" to add them.`);
  return hit.id || hit._id;
}

/**
 * `set_member` args → the members route's request. One action per call so a
 * reply always says exactly what changed.
 */
function memberRequest(args) {
  const { action, plan, expiresAt, note } = args;
  const needPlan = () => {
    if (!plan) throw new Error(`plan is required for action "${action}".`);
  };
  switch (action) {
    case "add":
      if (!args.email) throw new Error('email is required for action "add".');
      return {
        method: "POST",
        body: {
          email: args.email,
          name: args.name,
          plan,
          expiresAt: expiresAt ?? undefined,
          note,
          sendInvite: args.sendInvite === true,
        },
      };
    case "grant":
      needPlan();
      return { method: "PATCH", body: { grant: { plan, expiresAt: expiresAt ?? null, note } } };
    case "revoke":
      needPlan();
      return { method: "PATCH", body: { revoke: plan } };
    case "extend":
      needPlan();
      if (expiresAt === undefined) throw new Error('expiresAt is required for "extend" (ISO date, or null for no expiry).');
      return { method: "PATCH", body: { extend: { plan, expiresAt } } };
    case "block":
      return { method: "PATCH", body: { blocked: true } };
    case "unblock":
      return { method: "PATCH", body: { blocked: false } };
    case "rename":
      if (!args.name) throw new Error('name is required for action "rename".');
      return { method: "PATCH", body: { name: args.name } };
    default:
      throw new Error('action must be one of: add, grant, revoke, extend, block, unblock, rename.');
  }
}

module.exports = {
  /** @param {object} args - { id? } */
  async list_membership_plans(args = {}) {
    const data = await apiFetch(`${base(args, "list_membership_plans")}/plans`);
    const plans = data.plans || [];
    const text = plans.length
      ? `${plans.map(fmtPlan).join("\n")}\n\nGate content with auth conditions: customer.plans.<slug> exists.`
      : "No membership plans on this site yet. Create one with set_membership_plan.";
    return { content: [{ type: "text", text }], structuredContent: data };
  },

  /**
   * Create a plan (new slug) or edit one; only the fields passed change. The
   * slug can't be renamed — gates reference it.
   * @param {object} args - { id?, slug, name?, description?, stripePriceIds?, accessDays?, selfSignup?, archived? }
   */
  async set_membership_plan(args = {}) {
    const root = base(args, "set_membership_plan");
    if (!args.slug) throw new Error("slug is required (lowercase letters, digits, dashes).");
    const body = {};
    for (const k of PLAN_FIELDS) if (args[k] !== undefined) body[k] = args[k];
    const { plans = [] } = await apiFetch(`${root}/plans`);
    const exists = plans.some(p => p.slug === args.slug);
    if (!exists && !body.name) throw new Error("name is required when creating a plan.");
    if (exists && !Object.keys(body).length) {
      throw new Error(`Pass at least one field to change: ${PLAN_FIELDS.join(", ")}.`);
    }
    const data = exists
      ? await apiFetch(`${root}/plans/${encodeURIComponent(args.slug)}`, { method: "PATCH", body })
      : await apiFetch(`${root}/plans`, { method: "POST", body: { slug: args.slug, ...body } });
    const plan = data.plan || { slug: args.slug, ...body };
    return {
      content: [{ type: "text", text: `Plan ${exists ? "updated" : "created"}.\n${fmtPlan(plan)}` }],
      structuredContent: data,
    };
  },

  /** @param {object} args - { id?, plan?, status?, q?, cursor? } */
  async list_members(args = {}) {
    const qs = new URLSearchParams();
    for (const k of ["plan", "status", "q", "cursor"]) if (args[k]) qs.set(k, String(args[k]));
    const data = await apiFetch(`${base(args, "list_members")}/members${qs.size ? `?${qs}` : ""}`);
    const members = data.members || [];
    const more = data.nextCursor ? `\n\nMore: list_members({ cursor: "${data.nextCursor}" })` : "";
    const text = members.length ? members.map(fmtMember).join("\n") + more : "No members match.";
    return { content: [{ type: "text", text }], structuredContent: data };
  },

  /**
   * Add a member, or change one: grant / revoke / extend a plan, block or
   * unblock, rename. Identify an existing member by customerId or email.
   * @param {object} args - { id?, action, customerId?, email?, name?, plan?, expiresAt?, note?, sendInvite? }
   */
  async set_member(args = {}) {
    const root = base(args, "set_member");
    const req = memberRequest(args);
    let url = `${root}/members`;
    if (req.method === "PATCH") {
      const customerId = args.customerId || (args.email ? await customerIdFor(root, args.email) : null);
      if (!customerId) throw new Error("customerId or email is required.");
      url += `/${encodeURIComponent(customerId)}`;
    }
    const data = await apiFetch(url, req);
    const member = data.member || data.customer;
    const note =
      args.action === "revoke" || args.action === "block"
        ? "\nTakes effect on their next page load. A Stripe subscription keeps billing — cancel it in Stripe."
        : "";
    return {
      content: [{ type: "text", text: `${member ? fmtMember(member) : "Saved."}${note}` }],
      structuredContent: data,
    };
  },

  /**
   * Delete a member's customer record; their sign-in stops working at once.
   * @param {object} args - { id?, customerId?, email? }
   */
  async remove_member(args = {}) {
    const root = base(args, "remove_member");
    const customerId = args.customerId || (args.email ? await customerIdFor(root, args.email) : null);
    if (!customerId) throw new Error("customerId or email is required.");
    await apiFetch(`${root}/members/${encodeURIComponent(customerId)}`, { method: "DELETE" });
    return {
      content: [
        {
          type: "text",
          text: "Member removed; their sign-in stops working now. A Stripe subscription keeps billing — cancel it in Stripe.",
        },
      ],
    };
  },
};
