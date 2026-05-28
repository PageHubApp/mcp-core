const { withPendingMapLock } = require("../core/context");
const { applyKitBlockBody } = require("./kit/apply-body");

module.exports = {
  /**
   * Apply a published library block (by slug) into an existing section container.
   * Prefer this in fill mode over hand-built graphs: search_blocks → apply_kit_block.
   *
   * Wrapped in `withPendingMapLock` because AI SDK runs the model's tool calls
   * in parallel: without serialization, parallel apply_kit_block calls each
   * snapshot the same empty pending map, fetch components for ~200-3400ms,
   * then last-write-wins their snapshots back — earlier kits vanish.
   */
  async apply_kit_block(args) {
    return withPendingMapLock(() => applyKitBlockBody(args));
  },
};
