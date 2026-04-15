const { apiFetch } = require("../api-fetch");
const { postAgentSse } = require("../agent-sse-fetch");
const { getContext } = require("../context");
const {
  getActiveTarget,
  getEditorUrl,
  applyNodePatches,
  fetchTarget,
  saveTarget,
  decodeContentOrThrow,
} = require("../helpers");
const { mergeDesignIntentFromChain } = require("../design-intent-merge.js");

module.exports = {
  async generate_image(args) {
    const { prompt, model, size: orientation, nodeId } = args;
    const target = getActiveTarget(args);
    if (target.type === "template") {
      throw new Error(
        'generate_image is not supported for templates (no CDN upload). Use hardcoded image URLs (type: "url") instead.'
      );
    }
    const siteId = target.id;
    if (!prompt?.trim()) throw new Error("prompt is required.");

    const sizeMap = {
      landscape: { width: 1536, height: 1024 },
      portrait: { width: 1024, height: 1536 },
      square: { width: 1024, height: 1024 },
    };
    const { width, height } = sizeMap[orientation] || sizeMap.square;

    const genResult = await apiFetch("/api/v1/ai/image/generate", {
      method: "POST",
      body: { prompt, model: model || "gpt-image-1", width, height, optimizePrompt: true },
    });
    if (!genResult.success) throw new Error(genResult.error || "Image generation failed.");

    const uploadResult = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/media`, {
      method: "POST",
      body: {
        dataBase64: genResult.base64,
        mimeType: genResult.mimeType || "image/png",
        filename: "ai-generated.png",
      },
    });

    if (nodeId) {
      const siteData = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);
      if (siteData.content?.[nodeId]) {
        applyNodePatches(siteData.content, nodeId, {
          propsPatch: JSON.stringify({ type: "cdn", src: uploadResult.mediaId }),
        });
        await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, {
          method: "PUT",
          body: { content: siteData.content },
        });
      }
    }

    const lines = [`Image generated and uploaded to CDN.`];
    lines.push(`  mediaId: ${uploadResult.mediaId}`);
    lines.push(`  url: ${uploadResult.url}`);
    lines.push(`  prompt used: ${genResult.optimizedPrompt}`);
    if (nodeId) {
      lines.push(`  Node ${nodeId} updated.`);
      lines.push(`  Editor: ${getEditorUrl(siteId)}`);
    } else {
      lines.push(
        `\nApply with: update_node(nodeId: "<IMAGE_NODE_ID>", propsPatch: { type: "cdn", src: "${uploadResult.mediaId}" })`
      );
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },

  async generate_copy(args) {
    const { nodeId, intent, styleTags, text: textOverride } = args;
    const target = getActiveTarget(args);
    const ctx = getContext();

    if (!nodeId && !intent && !textOverride) {
      throw new Error("Provide at least one of: nodeId, intent, or text.");
    }

    let data;
    if (target.type === "template") {
      data = await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`);
    } else {
      data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`);
    }

    const pending =
      ctx._pendingFlatMap && typeof ctx._pendingFlatMap === "object" ? ctx._pendingFlatMap : null;
    const nodes =
      pending ||
      (target.type === "template"
        ? decodeContentOrThrow(data.content, `Template "${target.id}" content`)
        : data.content);
    if (!nodes || typeof nodes !== "object") {
      throw new Error(`${target.type === "template" ? "Template" : "Site"} has no content.`);
    }

    let currentText = textOverride || "";
    let nodeLabel = "";
    if (nodeId) {
      const node = nodes[nodeId];
      if (!node) throw new Error(`Node "${nodeId}" not found.`);
      const resolvedName = node.type?.resolvedName;
      if (resolvedName !== "Text" && resolvedName !== "Button") {
        throw new Error(`Node "${nodeId}" is a ${resolvedName}, not a Text or Button.`);
      }
      currentText = currentText || node.props?.text || "";
      nodeLabel = node.custom?.displayName || resolvedName;
    }

    const mergedIntent = mergeDesignIntentFromChain(nodes, nodeId || null);
    const designNotesMerged = mergedIntent.designNotes.trim() || undefined;
    const mergedDesignTags = mergedIntent.designTags.length ? mergedIntent.designTags : undefined;
    const company = nodes.ROOT?.props?.company || {};
    const parts = [];
    if (data.title || data.description) {
      parts.push(
        `Site context: "${data.title || data.name}"${data.description ? ` — ${data.description}` : ""}`
      );
    }
    // Inject business info so copy matches the site's identity
    const companyParts = [];
    if (company.name) companyParts.push(`name: ${company.name}`);
    if (company.tagline) companyParts.push(`tagline: ${company.tagline}`);
    if (company.type) companyParts.push(`type: ${company.type}`);
    if (companyParts.length > 0) {
      parts.push(`Business info: ${companyParts.join(", ")}`);
    }
    // Gather existing site copy for tone/domain context (limit to ~500 chars)
    const siteTextSnippets = [];
    for (const [id, n] of Object.entries(nodes)) {
      if (id === "ROOT" || id === nodeId) continue;
      const rn = n?.type?.resolvedName;
      if ((rn === "Text" || rn === "Button") && n?.props?.text) {
        const raw = String(n.props.text)
          .replace(/<[^>]*>/g, "")
          .trim();
        if (raw && raw.length > 5 && !raw.startsWith("{{")) siteTextSnippets.push(raw);
      }
      if (siteTextSnippets.join(" ").length > 500) break;
    }
    if (siteTextSnippets.length > 0) {
      parts.push(
        `Existing site copy (match this tone/domain): ${siteTextSnippets.slice(0, 8).join(" | ")}`
      );
    }
    if (designNotesMerged) {
      parts.push(`Design intent (page + ancestors): ${designNotesMerged}`);
    }
    if (nodeLabel) parts.push(`This text is the "${nodeLabel}" element.`);
    if (intent) parts.push(intent);

    const customPrompt = parts.length > 0 ? parts.join("\n") : undefined;
    const finalStyleTags =
      styleTags ||
      (Array.isArray(mergedDesignTags) && mergedDesignTags.length ? mergedDesignTags : undefined);

    if (!currentText.trim() && !customPrompt) {
      throw new Error("Nothing to generate. Provide intent, text, or a nodeId with existing text.");
    }

    const messageBlocks = [];
    if (customPrompt) messageBlocks.push(customPrompt);
    if (finalStyleTags?.length) {
      messageBlocks.push(`Style tags (tone/visual hints): ${finalStyleTags.join(", ")}`);
    }
    if (currentText.trim()) {
      messageBlocks.push(`Current HTML/text:\n${currentText}`);
    }
    const message = messageBlocks.join("\n\n").trim();
    if (!message) {
      throw new Error("Nothing to send to the assistant.");
    }

    const body = {
      message,
      assistantScope: "text",
      ...(target.type === "template" ? { templateSlug: target.id } : { siteId: target.id }),
      ...(nodeId ? { contextNodes: [{ id: nodeId, displayName: nodeLabel || "Text" }] } : {}),
    };

    const agentText = await postAgentSse(body);

    const lines = [`**Assistant (copy mode):**\n\n${agentText}`];
    if (currentText.trim()) lines.push(`\n\n**Original:**\n\n${currentText}`);
    if (nodeId) {
      lines.push(
        `\n\nIf the draft was not applied automatically, use patch_site_node(nodeId: "${nodeId}", propsPatch: { text: "<escaped result>" }) with the generated HTML.`
      );
    }
    return { content: [{ type: "text", text: lines.join("") }] };
  },
};
