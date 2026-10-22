/**
 * Site Chat tools — the site's chat bot settings (on/off, name, greeting,
 * owner instructions, lead fields, where leads go, daily spend cap). Both
 * proxy `/api/v1/sites/[id]/chat`. See docs/features/site-chat.md §8.
 */

const { apiFetch } = require("../core/api-fetch");
const { getActiveTarget } = require("../helpers/index.js");

const SETTABLE = [
  "enabled",
  "assistantName",
  "greeting",
  "instructions",
  "leadFields",
  "leadCollectionSlug",
  "notifyEmail",
  "dailyCreditCap",
];

function chatPath(args, tool) {
  const target = getActiveTarget(args);
  return `/api/v1/sites/${encodeURIComponent(target.id)}/chat`;
}

function summarize({ config, creditsAvailable, dailyCreditCapDefault, spentToday }) {
  const cap = config.dailyCreditCap ?? dailyCreditCapDefault;
  const lines = [
    `Chat is ${config.enabled ? "on" : "off"}.`,
    `Assistant name: ${config.assistantName}`,
    `Greeting: ${config.greeting}`,
    `Asks visitors for: ${config.leadFields.join(", ")}`,
    `Leads go to: Form Submissions ("Chat")${config.leadCollectionSlug ? ` and collection "${config.leadCollectionSlug}"` : ""}${config.notifyEmail ? `, plus an email to ${config.notifyEmail}` : ""}`,
    config.instructions ? `Instructions: ${config.instructions}` : "Instructions: (none)",
    `Daily spend cap: ${cap} credits${config.dailyCreditCap == null ? " (plan default)" : ""}; ${spentToday ?? 0} used today.`,
  ];
  if (config.enabled && !creditsAvailable) {
    lines.push("The bubble is hidden on the site: the owner has no AI credits left.");
  } else if (config.enabled && (spentToday ?? 0) >= cap) {
    lines.push("Chat is paused until the next UTC day: today's spend cap is used up.");
  }
  if (config.enabled) {
    lines.push(
      "Visitors only see chat where the page has an AgentFloatingBubble or AgentChat node. It answers from the published site, so publish after content changes."
    );
  }
  return lines.join("\n");
}

module.exports = {
  /** @param {object} args - { id? } */
  async get_site_chat(args = {}) {
    const data = await apiFetch(chatPath(args, "get_site_chat"));
    return { content: [{ type: "text", text: summarize(data) }], structuredContent: data };
  },

  /** @param {object} args - { id?, enabled?, assistantName?, greeting?, instructions?, leadFields?, leadCollectionSlug?, notifyEmail?, dailyCreditCap? } */
  async set_site_chat(args = {}) {
    const body = {};
    for (const k of SETTABLE) if (args[k] !== undefined) body[k] = args[k];
    if (!Object.keys(body).length) {
      throw new Error(`Pass at least one setting to change: ${SETTABLE.join(", ")}.`);
    }
    const data = await apiFetch(chatPath(args, "set_site_chat"), { method: "PUT", body });
    return {
      content: [{ type: "text", text: `Chat settings saved.\n${summarize(data)}` }],
      structuredContent: data,
    };
  },
};
