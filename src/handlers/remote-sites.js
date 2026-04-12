const { apiFetch, normalizeBaseUrl } = require("../api-fetch");
const { getContext } = require("../context");
const { parseMaybeJson, getActiveTarget, fetchTarget, saveTarget } = require("../helpers");
const { quickA11yAudit } = require("../a11y-check");
const { validateNodes, formatValidationReport } = require("../node-validation");

module.exports = {
  async list_sites() {
    const data = await apiFetch("/api/v1/sites");
    const lines = (data.sites || []).map(
      s =>
        `• ${s._id} — ${s.name || "(unnamed)"}${s.domain ? ` [${s.domain}]` : ""} (updated ${s.updatedAt})`
    );
    return {
      content: [{ type: "text", text: lines.length ? lines.join("\n") : "No sites found." }],
    };
  },

  async select_site(args) {
    const { id } = args;
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(id)}`);
    const ctx = getContext();
    ctx.activeSite = { id: data.id, name: data.name, draftId: data.draftId };
    // Clear activeTemplate so site takes priority
    ctx.activeTemplate = null;
    return {
      content: [
        { type: "text", text: `Active site set to ${data.id} (${data.name || "unnamed"})` },
      ],
    };
  },

  async pull_site(args) {
    const target = getActiveTarget(args);
    const ctx = getContext();
    let content;
    if (ctx._pendingFlatMap) {
      content = ctx._pendingFlatMap;
    } else if (target.type === "template") {
      content = (await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`)).content;
    } else {
      content = (await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`)).content;
    }
    if (!content)
      throw new Error(`${target.type === "template" ? "Template" : "Site"} has no content.`);
    const nodeCount = Object.keys(content).length;
    const label = target.type === "template" ? `Template "${target.id}"` : `Site ${target.id}`;
    return {
      content: [
        {
          type: "text",
          text: `${label} fetched (${nodeCount} nodes).\n\n\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``,
        },
      ],
    };
  },

  async save_site(args) {
    const ctx = getContext();
    const content = parseMaybeJson(args.content) || ctx._pendingFlatMap;
    if (!content) {
      throw new Error(
        "Provide content (inline JSON), or call patch_site_node/patch_site_bulk first."
      );
    }

    // ── Node validation & auto-fix pass ──
    const validation = validateNodes(content, { autoFix: true, warnColors: true });
    const validationReport = formatValidationReport(validation);
    // Block on structural errors (broken parent/child refs)
    if (validation.errors.length > 0) {
      throw new Error(
        `Cannot save — ${validation.errors.length} structural error(s) found:\n${validation.errors.join("\n")}\n\nFix these before saving.`
      );
    }

    const target = (() => {
      try {
        return getActiveTarget(args);
      } catch {
        return null;
      }
    })();
    const targetId = args.createNew ? null : target?.id;
    const targetType = target?.type || "site";

    // Dry run: return proposed content without saving
    if (ctx.draftMode) {
      ctx._pendingFlatMap = content;
      let changed = content;
      if (targetId) {
        try {
          const fetchUrl =
            targetType === "template"
              ? `/api/v1/templates/${encodeURIComponent(targetId)}`
              : `/api/v1/sites/${encodeURIComponent(targetId)}`;
          const original = (await apiFetch(fetchUrl)).content;
          if (original) {
            const diff = {};
            for (const [id, node] of Object.entries(content)) {
              if (!original[id] || JSON.stringify(original[id]) !== JSON.stringify(node)) {
                diff[id] = node;
              }
            }
            for (const [id, node] of Object.entries(diff)) {
              const parentId = node?.parent;
              if (parentId && content[parentId] && !diff[parentId]) {
                diff[parentId] = content[parentId];
              }
            }
            if (Object.keys(diff).length > 0) changed = diff;
          }
        } catch {}
      }
      const label =
        targetType === "template" ? `Template "${targetId || "new"}"` : `Site ${targetId || "new"}`;
      const audit = quickA11yAudit(content);
      const auditText = audit ? `\n\n---\n${audit.summary}` : "";
      return {
        content: [
          {
            type: "text",
            text: `${label} saved successfully (${Object.keys(content).length} nodes).${auditText}`,
          },
        ],
        pendingContent: content,
        changedNodes: changed,
      };
    }

    const audit = quickA11yAudit(content);
    const auditText = audit ? `\n\n---\n${audit.summary}` : "";
    const validationText = validationReport ? `\n\n---\n${validationReport}` : "";

    if (targetId) {
      const result = await saveTarget(targetId, targetType, content, {
        name: args.name,
        title: args.title,
        description: args.description,
      });
      if (targetType === "template") {
        return {
          content: [{ type: "text", text: `Template "${result.id}" updated.${auditText}` }],
        };
      }
      const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
      return {
        content: [
          {
            type: "text",
            text: `Site ${result.id} updated. View: ${base}/build/${result.id}${auditText}${validationText}`,
          },
        ],
      };
    }
    // Create new — sites only (templates use save_template for creation)
    const data = await apiFetch("/api/v1/sites", {
      method: "POST",
      body: { content, name: args.name, title: args.title, description: args.description },
    });
    ctx.activeSite = { id: data.id, name: data.name, draftId: data.draftId };
    return {
      content: [
        {
          type: "text",
          text: `New site created: ${data.id}\nEditor: ${data.url}\nPreview: ${data.staticUrl}${auditText}${validationText}`,
        },
      ],
    };
  },

  async delete_site(args) {
    const { id } = args;
    await apiFetch(`/api/v1/sites/${encodeURIComponent(id)}`, { method: "DELETE" });
    const ctx = getContext();
    if (ctx.activeSite?.id === id) ctx.activeSite = null;
    return { content: [{ type: "text", text: `Site ${id} deleted.` }] };
  },
};
