/**
 * Signed direct upload to a site's media library.
 *
 * The single-shot `POST /api/v1/sites/:id/media` with `dataBase64` runs the
 * bytes through a Vercel serverless function, which caps request bodies at
 * 4.5 MB — and base64 inflates by a third on top of that. Anything bigger than
 * a thumbnail has to go around the function: ask the API to sign an upload,
 * PUT/POST the bytes straight to Cloudflare Images or R2, then tell the API it
 * landed so storage accounting ticks and the file appears in the site's media
 * library. Same three-step shape the browser editor uses.
 */

const { apiFetch } = require("./api-fetch");

/**
 * @param {object} opts
 * @param {string} opts.siteId
 * @param {Buffer|Uint8Array} opts.bytes - The exact bytes to store.
 * @param {string} opts.contentType
 * @param {string} [opts.filename] - Library display name.
 * @param {number} [opts.width] - Pixel dimensions, when already known.
 * @param {number} [opts.height]
 * @returns {Promise<{mediaId:string, type:string, url:string, contentType:string, registered:boolean}>}
 */
async function uploadBytesToSite({ siteId, bytes, contentType, filename, width, height }) {
  const size = bytes.byteLength ?? bytes.length;
  if (!size) throw new Error("Refusing to upload an empty file.");

  const path = `/api/v1/sites/${encodeURIComponent(siteId)}/media`;
  const signed = await apiFetch(path, {
    method: "POST",
    body: { step: "sign", size, contentType, filename },
  });

  // Cloudflare Images takes a multipart POST with a `file` part; R2 takes a raw
  // PUT whose Content-Type must match the one baked into the SigV4 signature,
  // or it answers 403. The sign response says which.
  let transfer;
  if (signed.method === "PUT") {
    transfer = await fetch(signed.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": signed.contentType || contentType },
      body: bytes,
    });
  } else {
    const form = new FormData();
    form.set(
      signed.formField || "file",
      new Blob([bytes], { type: contentType }),
      filename || "upload"
    );
    transfer = await fetch(signed.uploadURL, { method: "POST", body: form });
  }

  if (!transfer.ok) {
    const detail = await transfer.text().catch(() => "");
    throw new Error(
      `Upload to ${signed.destination} failed (${transfer.status}): ${detail.slice(0, 400)}`
    );
  }

  // Confirm is what charges storage and registers the library entry. If it
  // fails the bytes are already at the CDN but uncounted and invisible in the
  // Media Manager, so surface it rather than reporting success.
  return apiFetch(path, {
    method: "POST",
    body: {
      step: "confirm",
      mediaId: signed.mediaId,
      size,
      contentType,
      destination: signed.destination,
      filename,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    },
  });
}

module.exports = { uploadBytesToSite };
