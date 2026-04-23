const { apiFetch } = require("../api-fetch");
const { VIDEO_PROVIDER_NAMES } = require("../../../../utils/stockProviders/types");

module.exports = {
  /**
   * Search stock videos from Pexels.
   */
  async find_video(args) {
    const {
      q,
      orientation,
      minDuration,
      maxDuration,
      provider: rawProvider,
      count: rawCount,
    } = args || {};
    const provider = String(rawProvider || "pexels").toLowerCase();
    const count = Math.min(6, Math.max(1, Number(rawCount) || 3));

    if (!q || typeof q !== "string") {
      throw new Error("Provide q (search keywords) for video search.");
    }

    if (!VIDEO_PROVIDER_NAMES.includes(provider)) {
      throw new Error(`provider must be one of: ${VIDEO_PROVIDER_NAMES.join(", ")}`);
    }

    try {
      const response = await apiFetch("/api/v1/stock-videos/search-external", {
        method: "POST",
        body: { q, count, orientation, minDuration, maxDuration, provider },
      });
      const videos = Array.isArray(response.videos) ? response.videos : [];
      if (videos.length === 0) {
        const note = response.note ? ` (${response.note})` : "";
        return {
          content: [
            {
              type: "text",
              text: `No videos found for "${q}"${note}.`,
            },
          ],
        };
      }
      return { content: [{ type: "text", text: formatResults(videos.slice(0, count)) }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Video search error: ${err.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

function formatResults(videos) {
  const lines = videos.map(video => {
    const dims = video.width && video.height ? ` ${video.width}x${video.height}` : "";
    const duration = video.duration ? `${video.duration}s` : "unknown duration";
    const orientation = video.orientation || "landscape";
    return `• \`${video.videoId}\` — ${duration}, ${orientation}${dims}\n  URL: ${video.url}${
      video.previewImage ? `\n  Preview: ${video.previewImage}` : ""
    }`;
  });

  return `Found ${videos.length} video${videos.length === 1 ? "" : "s"}:\n${lines.join(
    "\n\n"
  )}\n\nUse in Video nodes: set provider to "url" and set videoId to the URL above.`;
}
