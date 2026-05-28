/**
 * Shared MCP core constants — well-known node IDs that the runtime treats
 * as structural / protected. Centralized so handlers don't sprinkle magic
 * strings.
 */

const ROOT_NODE_ID = "ROOT";
const HOME_PAGE_ID = "page_home";
const PROTECTED_NODE_IDS = [ROOT_NODE_ID, HOME_PAGE_ID];

module.exports = { ROOT_NODE_ID, HOME_PAGE_ID, PROTECTED_NODE_IDS };
