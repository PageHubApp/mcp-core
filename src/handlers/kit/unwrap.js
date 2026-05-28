const { twMerge } = require("tailwind-merge");

/**
 * Skeleton sections are already empty section containers. Block library roots are often
 * another `type: "section"` wrapper — unwrap so we don't nest two section shells.
 */
function unwrapBlockStructure(structure) {
  if (!structure || typeof structure !== "object") return structure;
  if (structure.type === "Container" && structure.props?.type === "section") {
    const p = structure.props || {};
    const shellClass = twMerge(
      "flex flex-col w-full",
      typeof p.className === "string" ? p.className : ""
    );
    return {
      type: "Container",
      props: {
        canDelete: true,
        canEditName: true,
        root: { ...(p.root || {}) },
        className: shellClass,
        ...(p.custom ? { custom: p.custom } : {}),
        // Block roots often carry connector bindings + DOM hook attrs; do not drop on unwrap.
        ...(p.dataSource ? { dataSource: p.dataSource } : {}),
        ...(p.attrs ? { attrs: p.attrs } : {}),
      },
      children: structure.children || [],
    };
  }
  return structure;
}

module.exports = { unwrapBlockStructure };
