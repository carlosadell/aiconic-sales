const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ALL_STAGES, statusFromStageName, callType, autoFromStageName } = require("../lib/evaluate");
const { DATED_AFTER_CALL, NEEDS_PREP } = require("../api/leads");

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

test("Diagnostic Call is a booked, automation-owned call with its own label", () => {
  assert.equal(statusFromStageName("🩺 Diagnostic Call"), "booked");
  assert.equal(statusFromStageName("Diagnostic Call"), "booked");
  assert.equal(callType("🩺 Diagnostic Call"), "Diagnostic");
  assert.equal(autoFromStageName("🩺 Diagnostic Call"), true);
  assert.equal(NEEDS_PREP.has(statusFromStageName("🩺 Diagnostic Call")), true);
  assert.notEqual(statusFromStageName("🩺 Diagnostic Call"), statusFromStageName("😞 Lost"));
});

test("the fallback list follows the live pipeline order, including Diagnostic Call and Lost", () => {
  const names = ALL_STAGES.map((s) => s.name);
  const at = (re) => names.findIndex((n) => re.test(n));
  const diagnostic = ALL_STAGES.find((s) => s.name.includes("Diagnostic"));
  const lost = ALL_STAGES.find((s) => /\bLost\b/.test(s.name));
  assert.ok(diagnostic);
  assert.equal(diagnostic.id, "fe7607be-16b4-466d-9a19-b387a96a3ea1");
  assert.equal(lost.id, "ea5d1f80-4066-4a41-8c2c-e3bd78c768a6");
  assert.ok(at(/Intro Booked/) < at(/Diagnostic/));
  assert.ok(at(/Diagnostic/) < at(/Interview Booked/));
  assert.equal(at(/\bLost\b/) + 1, at(/Abandoned/));
  assert.deepEqual(
    names,
    [
      "📑 Survey Qualified",
      "⏳ Sending Intro Reminders",
      "✅ Intro Booked",
      "🩺 Diagnostic Call",
      "🚨 Sending Emergency Intro Reminders",
      "⏳ Sending Interview Reminders",
      "✅ Interview Booked",
      "⏳ Sending Review Reminders",
      "✅ Review Booked",
      "⛔️ Not Qualified",
      "🍿 Baking/Nurturing",
      "🔥 Client Won",
      "❌ Never Rescheduled",
      "😞 Lost",
      "🥱 Abandoned",
    ],
  );
});

test("a lead moved to Abandoned still gets a call date for the past list", () => {
  assert.equal(DATED_AFTER_CALL.has("abandoned"), true);
  assert.equal(DATED_AFTER_CALL.has("lost"), true);
  assert.equal(DATED_AFTER_CALL.has("notqualified"), true);
});
