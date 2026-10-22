/**
 * The block library and reusable-component tools, aware of the site's format (app repo:
 * docs/features/html-first-templates-blocks-components.md). On an HTML-first site a block is Liquid and a component
 * is a partial; any other target takes the node-tree handler unchanged. Registered after the modules it wraps.
 */
const kitHandlers = require("./kit");
const componentHandlers = require("./components");
const discoveryHandlers = require("./discovery");
const html = require("../helpers/html-library");

module.exports = {
  search_blocks: html.wrapForSiteFormat(componentHandlers.search_blocks, html.searchBlocksHtml),
  get_block: html.wrapForSiteFormat(componentHandlers.get_block, html.getBlockHtml),
  list_blocks: html.wrapForSiteFormat(discoveryHandlers.list_blocks, html.listBlocksHtml),
  apply_kit_block: html.wrapForSiteFormat(kitHandlers.apply_kit_block, html.applyBlockHtml),

  list_components: html.listComponentsHtml,
  rename_component: html.renameComponentHtml,
  delete_component: html.deleteComponentHtml,
};
