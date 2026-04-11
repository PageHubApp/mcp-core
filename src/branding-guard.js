/**
 * Single source for ROOT company identity checks (AI agent + MCP patch_site_node).
 * brandingCommitted: set by editor when user merges build-intent company or saves Site Settings branding.
 */

/** Acme-style template placeholders — disposable until user commits branding. */
function isPlaceholderCompanyName(name) {
  if (name == null || typeof name !== 'string') return true;
  const t = name.trim();
  if (!t) return true;
  return /^acme(\s|\.|$|,)/i.test(t);
}

/** User explicitly asked to change branding / company identity (not incidental copy edits). */
function userExplicitlyRequestsBrandingChange(msg) {
  if (!msg || typeof msg !== 'string') return false;
  return /\b(rebrand|re-brand|rename\s+(the\s+)?(business\s+|company\s+)?|change\s+(the\s+)?(business\s+|company\s+)?name|new\s+company\s+name|update\s+(my\s+)?brand|different\s+company|edit\s+(site\s+)?branding|change\s+the\s+tagline|change\s+our\s+(phone|email|address|contact))\b/i.test(
    msg
  );
}

const COMPANY_KEYS = ['name', 'tagline', 'type', 'location', 'address', 'phone', 'email', 'website'];

/**
 * Prevent silent overwrites of ROOT.props.company when branding is user-committed.
 * Deep-merges with existing company so partial patches do not wipe other fields.
 * When brandingCommitted is false/undefined, merges incoming without blocking (template demos stay replaceable).
 *
 * @param {Record<string, any>} flat
 * @param {Record<string, any>} propsPatch
 * @param {{ agentUserMessage?: string }} ctx
 */
function guardRootCompanyPropsPatch(flat, propsPatch, ctx) {
  if (!propsPatch || !propsPatch.company || typeof propsPatch.company !== 'object') return propsPatch;
  const rootProps = flat && flat.ROOT && flat.ROOT.props;
  const existing = (rootProps && rootProps.company) || {};
  const incoming = propsPatch.company;
  const merged = { ...existing, ...incoming };
  const committed = rootProps && rootProps.brandingCommitted === true;

  if (!committed) {
    return { ...propsPatch, company: merged };
  }

  const explicit = userExplicitlyRequestsBrandingChange(ctx && ctx.agentUserMessage);
  for (const key of COMPANY_KEYS) {
    if (incoming[key] === undefined) continue;
    const prev = existing[key];
    const next = incoming[key];
    if (key === 'name') {
      if (
        !isPlaceholderCompanyName(prev) &&
        String(prev || '').trim() !== '' &&
        String(next).trim() !== String(prev).trim() &&
        !explicit
      ) {
        merged[key] = prev;
      }
    } else if (
      prev != null &&
      String(prev).trim() !== '' &&
      String(next).trim() !== String(prev).trim() &&
      !explicit
    ) {
      merged[key] = prev;
    }
  }
  return { ...propsPatch, company: merged };
}

module.exports = {
  isPlaceholderCompanyName,
  userExplicitlyRequestsBrandingChange,
  guardRootCompanyPropsPatch,
};
