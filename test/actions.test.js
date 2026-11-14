const { test } = require("node:test");
const assert = require("node:assert/strict");
const { actionPlan, ABANDONED_TAG, nextCallType, onDailyOutreach } = require("../public/actions");

function tags(plan) {
  return plan.after.map((a) => a.tag);
}

function labels(plan) {
  return plan.after.map((a) => a.label);
}

test("the Abandoned tag is the single word abandoned", () => {
  assert.equal(ABANDONED_TAG, "abandoned");
});

test("Abandoned sits with Not Qualified and Lost on every card that offers them", () => {
  const cards = [
    [{ status: "booked", stage: "✅ Intro Booked" }, "calls"],
    [{ status: "booked", stage: "✅ Interview Booked" }, "calls"],
    [{ status: "booked", stage: "✅ Review Booked" }, "calls"],
    [{ status: "lost", stage: "😞 Lost" }, "pipeline"],
    [{ status: "noshow", stage: "⏳ Sending Intro Reminders" }, "calls"],
    [{ status: "abandoned", stage: "🥱 Abandoned" }, "pipeline"],
  ];
  for (const [lead, ctx] of cards) {
    const plan = actionPlan(lead, ctx);
    const got = labels(plan);
    assert.ok(got.includes("Not Qualified"), ctx + " " + lead.stage);
    assert.ok(got.includes("Lost"), ctx + " " + lead.stage);
    assert.ok(got.includes("Abandoned"), ctx + " " + lead.stage);
    const abandoned = plan.after.find((a) => a.label === "Abandoned");
    assert.equal(abandoned.tag, "abandoned");
  }
});

const CLOSED = ["Baking/Nurturing", "Lost", "Not Qualified", "Abandoned", "Client Won"];
const INTRO_TAGS = ["noshow-intro", "booklater-intro", "pending-interview"];

test("a diagnostic card offers only the closing options, never the intro tags", () => {
  const lead = {
    status: "booked",
    stage: "🩺 Diagnostic Call",
    appointment: { title: "Business Diagnostic Call" },
  };
  for (const ctx of ["calls", "pipeline"]) {
    const plan = actionPlan(lead, ctx);
    assert.equal(plan.title, "After the diagnostic call");
    assert.deepEqual(labels(plan), CLOSED);
    for (const tag of INTRO_TAGS) {
      assert.equal(tags(plan).includes(tag), false, ctx + " emitted " + tag);
    }
    assert.equal(plan.after.some((a) => a.needKind), false);
  }
});

test("a diagnostic call title is not filed as an intro by the generic picker", () => {
  const plan = actionPlan({
    status: "survey",
    stage: "Other",
    appointment: { title: "Business Diagnostic Call" },
  }, "pipeline");
  assert.deepEqual(labels(plan), CLOSED);
  for (const tag of INTRO_TAGS) assert.equal(tags(plan).includes(tag), false);
});

test("the next call after a diagnostic is the interview", () => {
  assert.equal(nextCallType({ status: "booked", stage: "🩺 Diagnostic Call" }), "interview");
  assert.equal(nextCallType({ status: "booked", stage: "✅ Intro Booked" }), "interview");
  assert.equal(nextCallType({ status: "booked", stage: "✅ Interview Booked" }), "review");
  assert.equal(nextCallType({ status: "booked", stage: "✅ Review Booked" }), "");
});

test("Daily Outreach includes a diagnostic call in upcoming and in the past 14 days", () => {
  const now = Date.parse("2026-11-14T15:00:00Z");
  const upcoming = {
    status: "booked",
    stage: "🩺 Diagnostic Call",
    name: "Maya Chen",
    appointment: { at: "2026-11-16T17:00:00Z", title: "Business Diagnostic Call" },
  };
  const past = {
    status: "booked",
    stage: "🩺 Diagnostic Call",
    name: "Maya Chen",
    appointment: { at: "2026-11-10T17:00:00Z", title: "Business Diagnostic Call" },
  };
  const tooOld = {
    status: "booked",
    name: "Maya Chen",
    appointment: { at: "2026-10-01T17:00:00Z", title: "Business Diagnostic Call" },
  };
  const other = {
    status: "booked",
    name: "Maya Chen",
    appointment: { at: "2026-11-10T17:00:00Z", title: "Coffee chat" },
  };
  assert.equal(onDailyOutreach(upcoming, "upcoming", now), true);
  assert.equal(onDailyOutreach(past, "upcoming", now), false);
  assert.equal(onDailyOutreach(past, "past", now), true);
  assert.equal(onDailyOutreach({ ...past, callTitle: "Business Diagnostic Call", appointment: null, callAt: past.appointment.at }, "past", now), true);
  assert.equal(onDailyOutreach(tooOld, "past", now), false);
  assert.equal(onDailyOutreach(other, "past", now), false);
  assert.equal(onDailyOutreach({ status: "other", name: "Maya Chen", appointment: upcoming.appointment }, "upcoming", now), false);
});

test("a booked intro still tags the intro-specific outcomes", () => {
  const plan = actionPlan({ status: "booked", stage: "✅ Intro Booked" }, "calls");
  assert.deepEqual(tags(plan).slice(0, 3), ["noshow-intro", "booklater-intro", "pending-interview"]);
  assert.ok(tags(plan).includes("abandoned"));
  assert.ok(tags(plan).includes("not-qualified"));
  assert.ok(tags(plan).includes("lost"));
});
