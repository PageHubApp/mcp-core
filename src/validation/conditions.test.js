/**
 * node --test packages/mcp-core/src/validation/conditions.test.js
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkNodeConditions } = require("./conditions");

const group = (...conditions) => [{ logic: "all", conditions }];

test("accepts the shapes the editor and library blocks write", () => {
  assert.equal(
    checkNodeConditions(
      {
        conditionGroups: group({ type: "auth", key: "status", operator: "equals", value: "logged-in" }),
        stateModifiers: [{ conditions: group({ type: "state", key: "cart:checkout-status", operator: "equals", value: "cancel" }), modifiers: ["shown"] }],
        action: [{ type: "link", href: "/", conditions: group({ type: "item", key: "images.1", operator: "exists" }) }],
      },
      "n"
    ),
    null
  );
  assert.equal(checkNodeConditions({ conditionGroups: group({ type: "device", operator: "equals", value: "mobile" }) }, "n"), null);
  assert.equal(checkNodeConditions({ conditionGroups: group({ type: "item", key: "inventory", operator: "less-than", value: 5 }) }, "n"), null);
  // Form nodes carry their submission URL in `action`.
  assert.equal(checkNodeConditions({ action: "/api/customer/magic-link" }, "n"), null);
});

test("rejects an auth condition with no key (it white-screens the React viewer)", () => {
  const err = checkNodeConditions({ conditionGroups: group({ type: "auth", operator: "equals", value: "logged-in" }) }, "ac_in");
  assert.match(err, /ac_in.*needs a string `key`/);
  assert.match(err, /key: "status"/);
});

test("rejects the old documented shapes", () => {
  assert.match(checkNodeConditions({ conditionGroups: [{ conditions: [{ type: "auth", state: "logged_in" }] }] }, "n"), /unsupported field\(s\) "state"/);
  assert.match(
    checkNodeConditions({ conditionGroups: group({ type: "auth", key: "status", operator: "equals", value: "authenticated" }) }, "n"),
    /"logged-in" or "logged-out"/
  );
});

test("rejects unknown types, operators, logic and missing values", () => {
  assert.match(checkNodeConditions({ conditionGroups: group({ type: "cookie", key: "x", operator: "equals", value: "1" }) }, "n"), /type must be one of/);
  assert.match(checkNodeConditions({ conditionGroups: group({ type: "state", key: "x", operator: "is", value: "1" }) }, "n"), /operator must be one of/);
  assert.match(checkNodeConditions({ conditionGroups: [{ logic: "and", conditions: [] }] }, "n"), /logic must be "all" or "any"/);
  assert.match(checkNodeConditions({ conditionGroups: group({ type: "state", key: "x", operator: "equals" }) }, "n"), /value is required/);
  assert.match(checkNodeConditions({ conditionGroups: { conditions: [] } }, "n"), /must be an array of condition groups/);
});

test("checks stateModifiers and action conditions too", () => {
  assert.match(
    checkNodeConditions({ stateModifiers: [{ conditions: group({ type: "state", operator: "equals", value: "x" }), modifiers: ["a"] }] }, "n"),
    /stateModifiers\[0\]\.conditions\[0\]\.conditions\[0\].*needs a string `key`/
  );
  assert.match(
    checkNodeConditions({ action: [{ type: "link", href: "/", conditions: group({ type: "auth", operator: "equals", value: "logged-in" }) }] }, "n"),
    /action\[0\]\.conditions/
  );
});
