/**
 * The block library and reusable-component tools (app repo: docs/features/html-first-templates-blocks-components.md).
 * A block is a Liquid snippet and a component is a partial.
 */
const html = require("../helpers/html-library");

module.exports = {
  search_blocks: html.searchBlocksHtml,
  get_block: html.getBlockHtml,
  list_blocks: html.listBlocksHtml,
  apply_kit_block: html.applyBlockHtml,
  save_block: html.saveBlock,
  update_block: html.updateBlock,
  patch_block: html.patchBlock,
  delete_block: html.deleteBlock,

  list_components: html.listComponentsHtml,
  rename_component: html.renameComponentHtml,
  delete_component: html.deleteComponentHtml,
};
