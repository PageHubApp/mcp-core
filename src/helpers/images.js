function extractImageUrls(props, resolvedName) {
  const urls = [];
  if (!props) return urls;
  const imgSrc = resolvedName === "Image" ? (props.src ?? props.content) : null;
  if (imgSrc && typeof imgSrc === "string") {
    if (props.type === "url" || (!props.type && imgSrc.startsWith("http"))) {
      urls.push(imgSrc);
    }
  }
  if (
    props.backgroundImage &&
    typeof props.backgroundImage === "string" &&
    props.backgroundImage.startsWith("http")
  ) {
    urls.push(props.backgroundImage);
  }
  return urls;
}

async function validateImageUrls(urls) {
  const failures = [];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      if (!resp.ok) failures.push({ url, status: resp.status });
    } catch (e) {
      failures.push({ url, status: `error: ${e.message}` });
    }
  }
  return failures;
}

function collectAllImageUrls(nodes) {
  const urls = [];
  for (const [id, node] of Object.entries(nodes)) {
    const found = extractImageUrls(node.props, node.type?.resolvedName);
    for (const url of found) urls.push({ nodeId: id, url });
  }
  return urls;
}

module.exports = {
  extractImageUrls,
  validateImageUrls,
  collectAllImageUrls,
};
