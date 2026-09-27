/**
 * List every tool the package exposes, grouped by namespace.
 * No API key needed.
 *
 * Run:  node examples/01-list-tools.js
 */

const { getAllTools, getAgentTools } = require("@pagehub/mcp-core");

const all = getAllTools();
const agent = getAgentTools();

console.log(`Total tools: ${all.length}`);
console.log(`Agent-safe tools: ${agent.length}`);
console.log();

// Group by leading word in the tool name (list_sites → "list", add_page → "add").
const groups = new Map();
for (const t of all) {
  const verb = t.name.split("_")[0];
  if (!groups.has(verb)) groups.set(verb, []);
  groups.get(verb).push(t.name);
}

for (const [verb, names] of [...groups.entries()].sort()) {
  console.log(`${verb} (${names.length})`);
  for (const n of names.sort()) console.log(`  ${n}`);
}
