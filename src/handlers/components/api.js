const { apiFetch } = require("../../core/api-fetch");
const { compressJsonToBase64Lz, decodeContentOrThrow } = require("../../helpers/index.js");

async function fetchComponents(params) {
  const qs = params.toString();
  return apiFetch(`/api/v1/components${qs ? `?${qs}` : ""}`);
}

async function fetchComponent(slug) {
  return apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
}

function decodeComponentStructure(component) {
  const decoded = decodeContentOrThrow(
    component?.structure,
    `Component "${component?.slug || "unknown"}" structure`
  );
  return { ...component, structure: decoded };
}

function encodeStructurePayload(structure) {
  if (typeof structure === "string" && structure) return structure;
  if (structure && typeof structure === "object") return compressJsonToBase64Lz(structure);
  throw new Error("structure must be an object or lzutf8+base64 compressed JSON string.");
}

module.exports = {
  fetchComponents,
  fetchComponent,
  decodeComponentStructure,
  encodeStructurePayload,
};
