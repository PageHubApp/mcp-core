/**
 * Site meta args ({ name, title, description }) helpers.
 *
 * Two flavors:
 *
 * - `pickSiteMetaArgs(args)` — raw passthrough. Returns a `{ name, title,
 *   description }` triple suitable for spreading into a POST body when the
 *   downstream API accepts undefined fields (create / duplicate site).
 *
 * - `pickSiteMetaUpdates(args)` — strict PATCH semantics. Only includes keys
 *   present as strings on `args`; trims whitespace; empty strings become
 *   `null` (explicit clear). Returns `{}` if nothing was supplied so callers
 *   can validate "at least one field" themselves.
 */

const META_KEYS = ["name", "title", "description"];

function pickSiteMetaArgs(args = {}) {
  return {
    name: args.name,
    title: args.title,
    description: args.description,
  };
}

function pickSiteMetaUpdates(args = {}) {
  const body = {};
  for (const key of META_KEYS) {
    if (typeof args[key] === "string") {
      body[key] = args[key].trim() || null;
    }
  }
  return body;
}

module.exports = { pickSiteMetaArgs, pickSiteMetaUpdates };
