const { test } = require("node:test");
const assert = require("node:assert/strict");
const { actionPlan, ABANDONED_TAG } = require("../public/actions");

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

test("a booked intro still tags the intro-specific outcomes", () => {
  const plan = actionPlan({ status: "booked", stage: "✅ Intro Booked" }, "calls");
  assert.deepEqual(tags(plan).slice(0, 3), ["noshow-intro", "booklater-intro", "pending-interview"]);
  assert.ok(tags(plan).includes("abandoned"));
  assert.ok(tags(plan).includes("not-qualified"));
  assert.ok(tags(plan).includes("lost"));
});
