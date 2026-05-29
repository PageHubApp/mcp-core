/**
 * Full Claude Agent SDK integration — Claude calls PageHub tools in a loop
 * until the task is done.
 *
 * Install deps:  npm install ai
 * Run:  PAGEHUB_API_KEY=ph_... ANTHROPIC_API_KEY=sk-ant-... \
 *         node examples/03-claude-agent.js "list my sites"
 *
 * (Uses Vercel AI SDK with Anthropic provider. Swap in OpenAI / gateway() as needed.)
 */

const { generateText, tool, stepCountIs } = require("ai");
const { anthropic } = require("@ai-sdk/anthropic");
const { runWithContext, executeAgentTool, getAgentTools } = require("@pagehub/mcp-core");

const prompt = process.argv.slice(2).join(" ") || "List my PageHub sites.";

if (!process.env.PAGEHUB_API_KEY) {
  console.error("Set PAGEHUB_API_KEY.");
  process.exit(1);
}

async function main() {
  // Convert MCP schemas → AI SDK tool definitions.
  // getAgentTools() returns the 67 tools safe for public agents
  // (excludes auth-sensitive operations like `register`, `delete_site`, etc.)
  const schemas = getAgentTools();
  const tools = Object.fromEntries(
    schemas.map(s => [
      s.name,
      tool({
        description: s.description,
        parameters: s.input_schema,
        execute: args => executeAgentTool(s.name, args),
      }),
    ])
  );

  // Run the agent loop inside the auth context.
  // The model picks tools, executeAgentTool reads ctx.apiKey via AsyncLocalStorage.
  const { text } = await runWithContext(
    { apiKey: process.env.PAGEHUB_API_KEY, apiBaseUrl: "https://pagehub.dev" },
    () =>
      generateText({
        model: anthropic("claude-sonnet-4-5"),
        tools,
        prompt,
        stopWhen: stepCountIs(10),
      })
  );

  console.log("\n=== Agent reply ===\n");
  console.log(text);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
