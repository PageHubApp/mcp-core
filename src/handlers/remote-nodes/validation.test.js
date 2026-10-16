/**
 * node --test packages/mcp-core/src/handlers/remote-nodes/validation.test.js
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { maybePreflightButton, patchTouchesClassName, formatButtonPreflightReport } = require("./validation");

const button = className => ({
  btn: { type: { resolvedName: "Button" }, props: { className, text: "Go" } },
});

test("patchTouchesClassName: only class-writing patches count", () => {
  assert.equal(patchTouchesClassName({ propsPatch: { action: [{ type: "link", href: "/" }] } }), false);
  assert.equal(patchTouchesClassName({ propsPatch: { text: "Hi" }, classNamePatch: "" }), false);
  assert.equal(patchTouchesClassName({ classNamePatch: "btn-primary" }), true);
  assert.equal(patchTouchesClassName({ unsetClasses: ["px-4"] }), true);
  assert.equal(patchTouchesClassName({ propsPatch: { className: "btn" } }), true);
  assert.equal(patchTouchesClassName({ unsetProps: ["className"] }), true);
  assert.equal(patchTouchesClassName({ typePatch: "Button" }), true);
  assert.equal(patchTouchesClassName({ typePatch: "Text" }), false);
});

test("fix mode leaves classes alone when the patch did not touch className", () => {
  const className = "hover:bg-base-200 w-full rounded-none border-0 px-4 py-2 text-left text-sm";
  const flat = button(className);
  const rec = maybePreflightButton(flat, "btn", "fix", { classNameTouched: false });
  assert.equal(flat.btn.props.className, className);
  assert.equal(rec.mode, "warn");
  assert.deepEqual(rec.appliedFixes, []);
  assert.match(formatButtonPreflightReport([rec]), /className not in this patch/);
});

test("fix mode does not rewrite a bare-utility button on an action-only patch", () => {
  const flat = button("px-8 py-3 rounded");
  const rec = maybePreflightButton(flat, "btn", "fix", { classNameTouched: false });
  assert.equal(flat.btn.props.className, "px-8 py-3 rounded");
  assert.ok(rec.issues.some(i => i.code === "no-fill"));
});

test("strict mode does not throw on a patch that left className alone", () => {
  const flat = button("px-8 py-3");
  assert.doesNotThrow(() => maybePreflightButton(flat, "btn", "strict", { classNameTouched: false }));
});

test("fix mode still corrects a new node / class-writing patch", () => {
  const flat = button("px-8 py-3 rounded");
  const rec = maybePreflightButton(flat, "btn", "fix");
  assert.equal(rec.mode, "fix");
  assert.ok(flat.btn.props.className.split(" ").includes("btn-primary"));
});

test("ghost icon button on an action-only patch produces no report", () => {
  const className = "btn btn-ghost btn-circle hidden md:inline-flex";
  const flat = button(className);
  assert.equal(maybePreflightButton(flat, "btn", "fix", { classNameTouched: false }), null);
  assert.equal(maybePreflightButton(flat, "btn", "fix"), null);
  assert.equal(flat.btn.props.className, className);
});
