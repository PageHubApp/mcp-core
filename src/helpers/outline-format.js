/**
 * The text of `outline_page`: the server's outline tree (`GET /api/v1/sites/:id/outline`) as indented lines, each with
 * the file and lines it is at. Lines in the page's own file read `L12-20`; lines of an expanded partial carry the
 * partial's path (`partials/header.liquid:L1-6`), so every anchor is something `read_site_file` can slice.
 */

/** Most lines one reply shows; a long page is cut here and says so. */
const MAX_LINES = 300;

const range = n => (n.endLine > n.line ? `${n.line}-${n.endLine}` : `${n.line}`);

function describe(n) {
  if (n.kind === "heading") return `${n.tag}${n.label ? ` "${n.label}"` : ""}`;
  if (n.kind === "render") {
    const where = n.missing ? " (no such partial)" : ` → partials/${n.label}.liquid`;
    const comp = n.component ? ` (component, ${n.component.uses} use${n.component.uses === 1 ? "" : "s"} on ${n.component.pages} page${n.component.pages === 1 ? "" : "s"})` : "";
    return `{% ${n.tag} '${n.label}' %}${where}${comp}`;
  }
  if (n.kind === "block") return `{% ${n.label} %}`;
  return `<${n.tag}${n.id ? `#${n.id}` : ""}>${n.label ? ` "${n.label}"` : ""}${n.classes ? ` ${n.classes.split(" ").map(t => (/^\+\d+$/.test(t) ? t : `.${t}`)).join(" ")}` : ""}`;
}

function formatOutline({ page, outline }) {
  const lines = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const at = n.file === outline.path ? `L${range(n)}` : `${n.file}:L${range(n)}`;
      lines.push(`${"  ".repeat(depth)}${at}  ${describe(n)}`);
      walk(n.children || [], depth + 1);
    }
  };
  walk(outline.nodes, 0);
  const shown = lines.slice(0, MAX_LINES);
  const who = page.pageId ? ` — page ${page.pageId}${page.name ? ` "${page.name}"` : ""} at ${page.url}` : "";
  const cut = lines.length > MAX_LINES ? `\n(${lines.length - MAX_LINES} more lines; outline_page with expand: false, or on a partial, is shorter)` : "";
  const trunc = outline.truncated ? "\n(very large page: the outline stops early.)" : "";
  return `# Outline of ${outline.path}${who}, ${outline.lines} lines\nL = line in the page file; an expanded partial's lines carry its path. read_site_file with startLine / endLine reads a span.\n\n${shown.join("\n") || "(no sections, headings or partials found)"}${cut}${trunc}`;
}

module.exports = { formatOutline };
