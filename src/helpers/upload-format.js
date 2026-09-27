/**
 * One renderer for every media-upload tool result, so the local stdio
 * server's `filePath` path reports uploads identically to the hosted
 * URL / base64 path — including the "use the mediaId, not the url" rule that
 * keeps images on the responsive srcset instead of a baked full-size link.
 */

/**
 * @param {{mediaId:string, type:string, url:string, contentType?:string}} data
 * @param {{label?: string}} [opts] - `label` heads the block, for bulk output.
 * @returns {string}
 */
function formatUploadResult(data, opts = {}) {
  const head = opts.label ? `${opts.label}\n` : "";
  const usage =
    data.type === "r2"
      ? `Stored on R2 (${data.contentType || "file"}).\n  • Video node: provider "r2", videoId "${data.mediaId}"\n  • Link / collection url field: use the url above\n  • Delete later with the editor Media Manager`
      : `Use in an Image node: { "type": "cdn", "src": "${data.mediaId}" } — the mediaId (NOT the url) so the viewer serves a responsive srcset + format=auto. Do NOT bake the full-size url as type:"url".`;
  return `${head}Uploaded.\n  mediaId: ${data.mediaId}\n  type: ${data.type}${
    data.contentType ? `\n  contentType: ${data.contentType}` : ""
  }\n  url: ${data.url}\n\n${usage}`;
}

module.exports = { formatUploadResult };
