const lz = require("lzutf8");

function compressJsonToBase64Lz(input) {
  const json = typeof input === "string" ? input : JSON.stringify(input);
  return lz.encodeBase64(lz.compress(json));
}

function decompressBase64LzToString(input) {
  if (typeof input !== "string" || !input) {
    throw new Error("Expected non-empty compressed string");
  }
  return lz.decompress(lz.decodeBase64(input));
}

function decompressBase64LzToJson(input) {
  return JSON.parse(decompressBase64LzToString(input));
}

function tryDecompressBase64LzToJson(input) {
  if (typeof input !== "string" || !input) return null;
  try {
    return decompressBase64LzToJson(input);
  } catch {
    return null;
  }
}

module.exports = {
  compressJsonToBase64Lz,
  decompressBase64LzToString,
  decompressBase64LzToJson,
  tryDecompressBase64LzToJson,
};
