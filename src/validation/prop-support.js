/**
 * Writes that are accepted, stored, and then never rendered.
 *
 * Every entry here is a prop an agent can set successfully and watch do
 * nothing. They are the worst class of bug this API has: the tool says
 * "updated", the publish says "published", the page serves without it, and
 * nothing anywhere says why. One of them — per-page `headCode` on a
 * static-publish site — silently broke a live password-reset flow.
 *
 * A TABLE, not conditionals scattered through the handlers, because the set
 * shrinks as the render paths are fixed: `headCode` and `FormElement.attrs`
 * were both on this list until the static path learned to emit them. Deleting
 * a row must be the whole change.
 *
 * WARN ONLY. Several rows describe things that render on one delivery mode and
 * not another, and a caller may be writing for the mode that works.
 */

/**
 * @typedef {object} PropSupportRow
 * @property {string} id
 * @property {(input: DropCheckInput) => boolean} dropped — true when this write will not render
 * @property {(input: DropCheckInput) => string} message — what the caller should do instead
 *
 * @typedef {object} DropCheckInput
 * @property {string} [component] — resolvedName of the node being written
 * @property {string} key — prop name
 * @property {any} value
 * @property {boolean} [staticPublish] — site is on turbo/static delivery
 * @property {string} [nodeId]
 */

const ROWS = [
  {
    id: "page-body-class-static",
    dropped: i => i.key === "bodyClass" && !!i.staticPublish,
    message: () =>
      "bodyClass is applied by the React viewer after hydration; the static-publish renderer emits a bare <body> and never reads it. " +
      "For a class the page genuinely needs, put the rule in ROOT.props.inject.head as `<style>body{…}</style>` instead — that ships on both paths, and before first paint.",
  },
  {
    id: "page-theme-overrides-static",
    dropped: i => i.key === "themeOverrides" && !!i.staticPublish,
    message: () =>
      "themeOverrides are injected as CSS variables by the React viewer after hydration; the static-publish renderer does not apply them. " +
      "Use set_theme for site-wide tokens, or a scoped `<style>` in ROOT.props.inject.head.",
  },
  {
    id: "container-datasource",
    dropped: i => i.component === "Container" && i.key === "dataSource",
    message: i =>
      `dataSource on a Container does nothing — only the Data component reads it. ` +
      `Convert the node with patch_site_node typePatch: "Data"${i.nodeId ? ` on "${i.nodeId}"` : ""}; ` +
      "same DOM output, same layout and action behaviour, and the binding actually resolves.",
  },
  {
    id: "attrs-event-keys",
    dropped: i =>
      i.key === "attrs" &&
      !!i.value &&
      typeof i.value === "object" &&
      Object.keys(i.value).some(k => /^on[A-Z]/.test(k)),
    message: i => {
      const keys = Object.keys(i.value).filter(k => /^on[A-Z]/.test(k));
      return (
        `attrs cannot carry event handlers (${keys.join(", ")}) — React rejects string event props, so they are dropped silently. ` +
        `Move them to props.handlers, which compiles each value as a real handler and emits a native attribute on static export.`
      );
    },
  },
  {
    id: "ref-google-icon",
    dropped: i =>
      (i.key === "value" || i.key === "icon") &&
      JSON.stringify(i.value ?? "").includes("ref-google:"),
    message: () =>
      "`ref-google:*` is a dead icon format — no resolver handles it, so the icon renders as nothing on every component. " +
      'Use `ref-icon:<set>/<ExportName>` (Tabler `tb/Tb*` for UI icons; `fa`/`fa6`/`bi`/`bs`/`im`/`si`/`lia` for brand logos) or `ref-image:<mediaId>`.',
  },
  {
    id: "button-children",
    dropped: i =>
      i.component === "Button" && (i.key === "nodes" || i.key === "children") && !!i.value,
    message: () =>
      "Button renders only its `text` and optional `icon` prop — child nodes are ignored. " +
      "For a clickable element with arbitrary children, use a Container carrying the same action.",
  },
];

/**
 * Check one written prop against the table.
 *
 * @param {DropCheckInput} input
 * @returns {string[]} warning lines (empty when the write renders)
 */
function checkPropSupport(input) {
  const out = [];
  for (const row of ROWS) {
    let hit = false;
    try {
      hit = row.dropped(input);
    } catch {
      hit = false;
    }
    if (hit) out.push(row.message(input));
  }
  return out;
}

/**
 * Check a whole props object at once.
 *
 * @param {{ component?: string, props: Record<string, any>, staticPublish?: boolean, nodeId?: string }} input
 * @returns {string[]}
 */
function checkPropsSupport({ component, props, staticPublish, nodeId }) {
  if (!props || typeof props !== "object") return [];
  const out = [];
  for (const [key, value] of Object.entries(props)) {
    out.push(...checkPropSupport({ component, key, value, staticPublish, nodeId }));
  }
  return out;
}

/** Render collected warnings as the block appended to a tool response. */
function formatPropSupportReport(warnings) {
  if (!warnings || warnings.length === 0) return "";
  const unique = [...new Set(warnings)];
  return [
    `Written but will not render (${unique.length}):`,
    ...unique.map(w => `  - ${w}`),
  ].join("\n");
}

module.exports = { checkPropSupport, checkPropsSupport, formatPropSupportReport, ROWS };
