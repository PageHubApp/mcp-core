const { apiFetch } = require('../api-fetch');
const { getActiveTarget, getEditorUrl, applyNodePatches, fetchTarget, saveTarget } = require('../helpers');

module.exports = {
  async generate_image(args) {
    const { prompt, model, size: orientation, nodeId } = args;
    const target = getActiveTarget(args);
    if (target.type === 'template') {
      throw new Error('generate_image is not supported for templates (no CDN upload). Use hardcoded image URLs (type: "url") instead.');
    }
    const siteId = target.id;
    if (!prompt?.trim()) throw new Error('prompt is required.');

    const sizeMap = { landscape: { width: 1536, height: 1024 }, portrait: { width: 1024, height: 1536 }, square: { width: 1024, height: 1024 } };
    const { width, height } = sizeMap[orientation] || sizeMap.square;

    const genResult = await apiFetch('/api/v1/ai/image/generate', {
      method: 'POST',
      body: { prompt, model: model || 'gpt-image-1', width, height, optimizePrompt: true },
    });
    if (!genResult.success) throw new Error(genResult.error || 'Image generation failed.');

    const uploadResult = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/media`, {
      method: 'POST',
      body: { dataBase64: genResult.base64, mimeType: genResult.mimeType || 'image/png', filename: 'ai-generated.png' },
    });

    if (nodeId) {
      const siteData = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);
      if (siteData.content?.[nodeId]) {
        applyNodePatches(siteData.content, nodeId, {
          propsPatch: JSON.stringify({ type: 'cdn', content: uploadResult.mediaId }),
        });
        await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, {
          method: 'PUT',
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
      lines.push(`\nApply with: update_node(nodeId: "<IMAGE_NODE_ID>", propsPatch: { type: "cdn", content: "${uploadResult.mediaId}" })`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },

  async generate_copy(args) {
    const { nodeId, intent, styleTags, text: textOverride } = args;
    const target = getActiveTarget(args);

    if (!nodeId && !intent && !textOverride) {
      throw new Error('Provide at least one of: nodeId, intent, or text.');
    }

    let data;
    if (target.type === 'template') {
      data = await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`);
    } else {
      data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`);
    }
    if (!data.content) throw new Error(`${target.type === 'template' ? 'Template' : 'Site'} has no content.`);
    const nodes = data.content;

    let currentText = textOverride || '';
    let nodeLabel = '';
    if (nodeId) {
      const node = nodes[nodeId];
      if (!node) throw new Error(`Node "${nodeId}" not found.`);
      const resolvedName = node.type?.resolvedName;
      if (resolvedName !== 'Text' && resolvedName !== 'Button') {
        throw new Error(`Node "${nodeId}" is a ${resolvedName}, not a Text or Button.`);
      }
      currentText = currentText || node.props?.text || '';
      nodeLabel = node.custom?.displayName || resolvedName;
    }

    const aiSettings = nodes.ROOT?.props?.ai || {};
    const parts = [];
    if (data.title || data.description) {
      parts.push(`Site context: "${data.title || data.name}"${data.description ? ` — ${data.description}` : ''}`);
    }
    if (aiSettings.prompt) parts.push(`Site tone guidelines: ${aiSettings.prompt}`);
    if (nodeLabel) parts.push(`This text is the "${nodeLabel}" element.`);
    if (intent) parts.push(intent);

    const customPrompt = parts.length > 0 ? parts.join('\n') : undefined;
    const finalStyleTags = styleTags || aiSettings.styleTags || undefined;

    if (!currentText.trim() && !customPrompt) {
      throw new Error('Nothing to generate. Provide intent, text, or a nodeId with existing text.');
    }

    const result = await apiFetch('/api/v1/ai/text/improve', {
      method: 'POST',
      body: { text: currentText, customPrompt, styleTags: finalStyleTags },
    });
    if (!result.success) throw new Error(result.error || 'Copy generation failed.');

    const lines = [`**Generated copy:**\n\n${result.result}`];
    if (currentText.trim()) lines.push(`\n\n**Original:**\n\n${currentText}`);
    if (nodeId) lines.push(`\n\nApply with: update_node(nodeId: "${nodeId}", propsPatch: { text: "..." })`);
    return { content: [{ type: 'text', text: lines.join('') }] };
  },
};
