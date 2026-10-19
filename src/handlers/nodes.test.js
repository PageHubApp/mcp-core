/**
 * node --test packages/mcp-core/src/handlers/nodes.test.js
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runWithContext } = require("../core/context");
const nodes = require("./nodes");
const { applyNodePatches } = require("../helpers/node-patch");

const CSS = "body{color:red}".repeat(400); // 6,000 chars
const node = (resolvedName, parent, kids = [], props = {}, displayName) => ({
  type: { resolvedName },
  parent,
  nodes: kids,
  props,
  custom: displayName ? { displayName } : {},
});
const flat = () => ({
  ROOT: node("Container", null, ["hdr_root", "page_home", "page_about", "ftr_root"], {
    inject: { head: CSS, footer: "<!-- tag -->" },
    company: { name: "Acme" },
  }),
  hdr_root: node("Header", "ROOT", ["nav"], { type: "header" }),
  nav: node("Container", "hdr_root", ["nav_link"]),
  nav_link: node("Link", "nav", [], { text: "Home" }),
  page_home: node("Container", "ROOT", ["sec_hero"], { type: "page" }, "Home"),
  sec_hero: node("Container", "page_home", ["hero_h1"], {}, "Hero"),
  hero_h1: node("Text", "sec_hero", [], { text: "x".repeat(3000) }),
  page_about: node("Container", "ROOT", ["sec_team"], { type: "page" }, "About"),
  sec_team: node("Container", "page_about", ["team_h2"], {}, "Team"),
  team_h2: node("Text", "sec_team", [], { text: "Our team" }),
  ftr_root: node("Footer", "ROOT", ["ftr_inner"], { type: "footer" }),
  ftr_inner: node("Container", "ftr_root", ["ftr_copy"]),
  ftr_copy: node("Text", "ftr_inner", [], { text: "© Acme" }),
});

const run = (fn, map = flat()) =>
  runWithContext({ apiKey: "k", activeSite: { id: "s1" }, _pendingFlatMap: map }, fn);
const textOf = r => r.content[0].text;

test("get_site_node shortens long string props and lists them", async () => {
  const out = JSON.parse(textOf(await run(() => nodes.get_site_node({ nodeId: "ROOT" }))));
  assert.ok(out.props.inject.head.length < 400);
  assert.match(out.props.inject.head, /prop: "inject\.head"/);
  assert.equal(out.props.inject.footer, "<!-- tag -->");
  assert.deepEqual(out.truncatedProps, [`inject.head (${CSS.length} chars)`]);
});

test("get_site_node never shortens a node's text", async () => {
  const out = JSON.parse(textOf(await run(() => nodes.get_site_node({ nodeId: "hero_h1" }))));
  assert.equal(out.props.text.length, 3000);
  assert.equal(out.truncatedProps, undefined);
});

test("get_site_node prop and full return whole values", async () => {
  const one = JSON.parse(
    textOf(await run(() => nodes.get_site_node({ nodeId: "ROOT", prop: "inject.head" })))
  );
  assert.equal(one.value, CSS);
  const all = JSON.parse(textOf(await run(() => nodes.get_site_node({ nodeId: "ROOT", full: true }))));
  assert.equal(all.props.inject.head, CSS);
  await assert.rejects(
    run(() => nodes.get_site_node({ nodeId: "ROOT", prop: "inject.nope" })),
    /no prop "inject\.nope"/
  );
});

test("a patch carrying a shortened value is refused", async () => {
  const read = JSON.parse(textOf(await run(() => nodes.get_site_node({ nodeId: "ROOT" }))));
  const map = flat();
  assert.throws(
    () =>
      run(() =>
        applyNodePatches(map, "ROOT", { propsPatch: { inject: { head: read.props.inject.head + "a{}" } } })
      ),
    /shortened get_site_node value/
  );
  assert.equal(map.ROOT.props.inject.head, CSS);
});

test("list_site_nodes default lists every page", async () => {
  const t = textOf(await run(() => nodes.list_site_nodes({})));
  for (const id of ["nav_link", "hero_h1", "team_h2", "ftr_copy"]) assert.match(t, new RegExp(id));
});

test("list_site_nodes pageId lists one page, header/footer top level, others folded", async () => {
  const t = textOf(await run(() => nodes.list_site_nodes({ pageId: "page_home" })));
  assert.match(t, /hero_h1/);
  assert.match(t, /page_about \| Container "About" \(1 children, folded\)/);
  assert.doesNotMatch(t, /sec_team|team_h2/);
  assert.match(t, /\n {4}nav \| Container \(1 children, folded\)/);
  assert.doesNotMatch(t, /nav_link|ftr_copy/);
  assert.match(t, /ftr_inner/);
});

test("list_site_nodes pageId deeper than a page keeps the ancestor path", async () => {
  const t = textOf(await run(() => nodes.list_site_nodes({ pageId: "sec_team" })));
  assert.match(t, /page_about[^\n]*\n {4}sec_team[^\n]*\n {6}team_h2/);
  assert.match(t, /page_home \| Container "Home" \(1 children, folded\)/);
});

test("list_site_nodes depth folds deep levels; unknown pageId errors", async () => {
  const t = textOf(await run(() => nodes.list_site_nodes({ depth: 1 })));
  assert.doesNotMatch(t, /sec_hero/);
  assert.match(t, /page_home \| Container "Home" \(1 children, folded\)/);
  await assert.rejects(run(() => nodes.list_site_nodes({ pageId: "page_x" })), /not found/);
});
