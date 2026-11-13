const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ALL_STAGES, statusFromStageName, callType, autoFromStageName } = require("../lib/evaluate");
const { DATED_AFTER_CALL } = require("../api/leads");

test("Abandoned is an end state, distinct from Lost and Not Qualified", () => {
  assert.equal(statusFromStageName("🥱 Abandoned"), "abandoned");
  assert.equal(statusFromStageName("Abandoned"), "abandoned");
  assert.equal(callType("🥱 Abandoned"), "Abandoned");
  assert.equal(autoFromStageName("🥱 Abandoned"), false);
  assert.equal(statusFromStageName("😞 Lost"), "lost");
  assert.equal(statusFromStageName("⛔️ Not Qualified"), "notqualified");
  assert.equal(statusFromStageName("✅ Intro Booked"), "booked");
});

test("the stale fallback list includes the live Abandoned stage", () => {
  const stage = ALL_STAGES.find((s) => s.name.includes("Abandoned"));
  assert.ok(stage);
  assert.equal(stage.id, "033fc8d1-19c5-4f20-9976-8f14292a996b");
});

test("a lead moved to Abandoned still gets a call date for the past list", () => {
  assert.equal(DATED_AFTER_CALL.has("abandoned"), true);
  assert.equal(DATED_AFTER_CALL.has("lost"), true);
  assert.equal(DATED_AFTER_CALL.has("notqualified"), true);
});
