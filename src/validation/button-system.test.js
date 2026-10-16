/**
 * node --test packages/mcp-core/src/validation/button-system.test.js
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateButtonClasses } = require("./button-system");

const fix = className => validateButtonClasses({ className, autoFix: true, allowCustomClasses: true });
const codes = r => r.issues.map(i => i.code);

test("bare-utility button is still promoted to the canonical primary CTA", () => {
  const r = fix("px-8 py-3 rounded font-semibold");
  assert.ok(codes(r).includes("missing-btn"));
  assert.ok(codes(r).includes("no-fill"));
  assert.equal(r.inferredVariant, "primary");
  for (const t of ["btn", "btn-primary", "min-h-12", "rounded-box", "px-space-md", "py-space-xs"]) {
    assert.ok(r.className.split(" ").includes(t), `expected ${t} in "${r.className}"`);
  }
});

test("bordered bare-utility button becomes the outline CTA", () => {
  const r = fix("border px-8 py-3");
  assert.equal(r.inferredVariant, "outline");
  assert.ok(r.className.includes("btn-outline"));
});

for (const className of [
  "btn btn-ghost btn-circle hidden md:inline-flex",
  "btn btn-ghost justify-start w-full",
  "btn btn-link text-base-content",
  "btn btn-square",
  "btn btn-sm",
  "btn btn-xs gap-1",
  "btn btn-secondary",
]) {
  test(`deliberate DaisyUI style is left alone: ${className}`, () => {
    const r = fix(className);
    assert.equal(r.className, className);
    assert.equal(r.inferredVariant, "custom");
    assert.deepEqual(r.appliedFixes, []);
    assert.ok(!codes(r).includes("no-fill"));
  });
}

test("menu-item Button without btn is reported, not rewritten into a CTA", () => {
  const className = "hover:bg-base-200 w-full rounded-none border-0 text-left text-sm";
  const r = fix(className);
  assert.equal(r.className, className);
  assert.deepEqual(r.appliedFixes, []);
  const missing = r.issues.find(i => i.code === "missing-btn");
  assert.equal(missing?.severity, "warn");
  assert.ok(!codes(r).includes("no-fill"));
  assert.ok(r.ok);
});

test("border-0 is not read as outline intent", () => {
  const r = fix("border-0 font-semibold");
  assert.equal(r.inferredVariant, "primary");
  assert.ok(!r.className.includes("btn-outline"));
});

test("a filled vanilla CTA with a hover state still gets btn", () => {
  const r = fix("bg-primary hover:bg-primary/90 text-primary-content rounded-box");
  assert.ok(r.className.split(" ").includes("btn"));
});
