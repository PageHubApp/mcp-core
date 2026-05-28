const { getContext } = require("../../core/context");
const { validateNodes } = require("../../validation/node-validation");
const { validateButtonClasses } = require("../../validation/button-system");

function normalizeButtonValidationMode(value) {
  if (value == null) return "warn";
  if (value === true) return "warn";
  if (value === false) return "off";
  const raw = String(value).trim().toLowerCase();
  if (["off", "warn", "fix", "strict"].includes(raw)) return raw;
  return "warn";
}

function normalizeDesignValidationMode(value) {
  if (value == null) return "warn";
  if (value === true) return "warn";
  if (value === false) return "off";
  const raw = String(value).trim().toLowerCase();
  if (["off", "warn", "strict"].includes(raw)) return raw;
  return "warn";
}

function warningMentionsNode(warning, nodeId) {
  if (!warning || !nodeId) return false;
  return (
    warning.includes(`${nodeId}:`) ||
    warning.includes(` ${nodeId} `) ||
    warning.includes(`"${nodeId}"`)
  );
}

function runDesignValidation(flat, touchedNodeIds, mode) {
  if (mode === "off") return null;
  // In components-fill mode (clone pipeline), auto-fix cheap things like
  // wrapping bare Text in <p> — the model routinely re-emits plain text on
  // patches, and re-warning on that adds noise without fixing the render.
  const ctx = getContext();
  const autoFix = !!(ctx?.fillMode && ctx?.fillProfile === "components");
  const result = validateNodes(flat, { autoFix, warnColors: true });
  const touched = Array.isArray(touchedNodeIds) ? touchedNodeIds : [];
  const touchedWarnings = result.warnings.filter(w =>
    touched.some(id => warningMentionsNode(w, id))
  );
  const touchedColorWarnings = (result.colorWarnings || []).filter(w =>
    touched.some(id => warningMentionsNode(w, id))
  );
  const touchedErrors = result.errors.filter(e => touched.some(id => warningMentionsNode(e, id)));
  if (mode === "strict" && (touchedErrors.length > 0 || touchedColorWarnings.length > 0)) {
    const issues = [...touchedErrors, ...touchedColorWarnings];
    throw new Error(
      `Design token preflight failed for touched nodes.\n- ${issues.join("\n- ")}\n\n` +
        "Use semantic tokens (bg-base-*, text-base-content, border-base-*) instead of hardcoded color classes."
    );
  }
  if (
    touchedWarnings.length === 0 &&
    touchedColorWarnings.length === 0 &&
    touchedErrors.length === 0
  ) {
    return null;
  }
  return {
    mode,
    warnings: touchedWarnings,
    colorWarnings: touchedColorWarnings,
    errors: touchedErrors,
  };
}

function formatDesignValidationReport(rec) {
  if (!rec) return "";
  const colorWarnings = rec.colorWarnings || [];
  const lines = [`Design validation [${rec.mode}]:`];
  if (rec.errors.length > 0) lines.push(`- errors: ${rec.errors.length}`);
  if (rec.warnings.length > 0) lines.push(`- warnings: ${rec.warnings.length}`);
  if (colorWarnings.length > 0) lines.push(`- hardcoded colors: ${colorWarnings.length}`);
  const preview = [...rec.errors, ...rec.warnings, ...colorWarnings].slice(0, 6);
  for (const item of preview) lines.push(`  ${item}`);
  return lines.join("\n");
}

function maybePreflightButton(flat, nodeId, mode) {
  if (mode === "off") return null;
  const node = flat[nodeId];
  if (!node || node.type?.resolvedName !== "Button") return null;

  const props = node.props || {};
  const result = validateButtonClasses({
    className: props.className || "",
    activeModifiers: props?.root?.activeModifiers || [],
    autoFix: mode === "fix",
    allowCustomClasses: true,
  });

  const currentModifiers = Array.isArray(props?.root?.activeModifiers)
    ? props.root.activeModifiers
    : [];
  const modifiersChanged =
    result.activeModifiers.length !== currentModifiers.length ||
    result.activeModifiers.some((m, i) => m !== currentModifiers[i]);
  if (mode === "fix" && (result.className !== (props.className || "") || modifiersChanged)) {
    if (!node.props) node.props = {};
    node.props.className = result.className;
    node.props.root = { ...(node.props.root || {}), activeModifiers: result.activeModifiers };
  }

  if (mode === "strict" && !result.ok) {
    const critical = result.issues.map(i => `${i.code}: ${i.message}`).join("\n- ");
    throw new Error(
      `Button class preflight failed for node "${nodeId}".\n- ${critical}\n\n` +
        'Tip: use buttonValidation: "fix" to auto-correct common button class conflicts.'
    );
  }

  if (result.issues.length === 0 && result.appliedFixes.length === 0) return null;
  return {
    nodeId,
    mode,
    ok: result.ok,
    issues: result.issues,
    appliedFixes: result.appliedFixes,
    className: result.className,
    activeModifiers: result.activeModifiers,
  };
}

function formatButtonPreflightReport(records) {
  if (!records || records.length === 0) return "";
  const lines = ["Button class preflight:"];
  for (const rec of records) {
    const issueSummary = rec.issues.length > 0 ? rec.issues.map(i => i.code).join(", ") : "none";
    const fixSummary = rec.appliedFixes.length > 0 ? rec.appliedFixes.join(" | ") : "none";
    lines.push(`- ${rec.nodeId} [${rec.mode}] issues: ${issueSummary}; fixes: ${fixSummary}`);
  }
  return lines.join("\n");
}

module.exports = {
  normalizeButtonValidationMode,
  normalizeDesignValidationMode,
  runDesignValidation,
  formatDesignValidationReport,
  maybePreflightButton,
  formatButtonPreflightReport,
  warningMentionsNode,
};
