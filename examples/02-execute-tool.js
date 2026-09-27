/**
 * Execute a single tool against the live PageHub API.
 *
 * Requires PAGEHUB_API_KEY. Get one at https://pagehub.dev.
 *
 * Run:  PAGEHUB_API_KEY=ph_... node examples/02-execute-tool.js
 */

const { runWithContext, executeTool } = require("@pagehub/mcp-core");

const apiKey = process.env.PAGEHUB_API_KEY;
if (!apiKey) {
  console.error("Set PAGEHUB_API_KEY (get one at https://pagehub.dev).");
  process.exit(1);
}

async function main() {
  // runWithContext seeds AsyncLocalStorage so the handler can read ctx.apiKey
  // without it being threaded through every function call.
  const result = await runWithContext(
    { apiKey, apiBaseUrl: process.env.PAGEHUB_API_BASE_URL || "https://pagehub.dev" },
    () => executeTool("list_sites", {})
  );

  // Every tool returns { content: [{ type: "text", text: "..." }] }.
  console.log(result.content[0].text);
}

main().catch(err => {
  console.error("Tool error:", err.message);
  process.exit(1);
});
