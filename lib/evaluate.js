// The rule that decides who needs a manual reach-out.
//
// This is the whole logic, in one place, so it is never a black box.
// It is applied automatically to every booked lead, the same way for every
// salesperson. Nobody picks names by hand.
//
// A booked lead needs a manual reach-out when our automatic confirmation
// could not reach them by the channels GoHighLevel uses:
//
//   1. No phone number on file      -> the automatic SMS could never be sent.
//   2. The SMS failed to deliver    -> a carrier or country blocked it.
//   3. The confirmation email bounced -> the address is invalid.
//
// If none of those are true, the lead already got their confirmation, so they
// are not on the action list. They still appear in the pipeline view, marked
// as reached, so everyone can see why they were not flagged.

const BOOKED_STAGES = {
  "31264788-1dc2-4f34-abcc-191b0cf0d856": "Intro Call",
  "fbb75036-ca89-43ee-948a-ed9f60d324f8": "Interview Call Booked",
  "ae66e02e-8a8a-446d-a26f-85bce067126c": "Review Call Booked",
};

// Human-readable statement of the rule, shown in the UI.
const RULE = {
  title: "How we decide who to reach",
  intro:
    "This list is built by a fixed rule, applied automatically to every booked lead, the same way for every salesperson. Nobody chooses names by hand.",
  needsReach: [
    "No phone number on file, so the automatic SMS could not be sent.",
    "The SMS failed to deliver, usually a carrier or country block.",
    "The confirmation email bounced, so the address is invalid.",
  ],
  reached:
    "If none of those happened, the lead already received their confirmation, so no manual action is needed. They still show in your pipeline, marked as reached.",
};

function isBooked(stageId) {
  return Object.prototype.hasOwnProperty.call(BOOKED_STAGES, stageId);
}

function stageName(stageId) {
  return BOOKED_STAGES[stageId] || "Other";
}

// Decide the reach-out state for one lead.
// signals: { hasPhone, smsStatus (delivered/failed/undelivered/sent/null), emailBounced }
function evaluate(signals) {
  const { hasPhone, smsStatus, emailBounced } = signals;

  const smsFailed = hasPhone && (smsStatus === "failed" || smsStatus === "undelivered");

  if (!hasPhone) {
    return {
      needsReach: true,
      code: "no_phone",
      reason: "No phone number on file, so the automatic SMS could not be sent.",
      // With no SMS, email is the minimum and LinkedIn is done alongside it.
      channels: emailBounced ? ["linkedin"] : ["email", "linkedin"],
    };
  }
  if (smsFailed) {
    return {
      needsReach: true,
      code: "sms_failed",
      reason: "Phone on file, but the SMS failed to deliver (carrier or country block).",
      channels: emailBounced ? ["linkedin"] : ["email", "linkedin"],
    };
  }
  if (emailBounced) {
    return {
      needsReach: true,
      code: "email_bounced",
      reason: "The confirmation email bounced, so the address is invalid.",
      channels: hasPhone ? ["sms"] : ["linkedin"],
    };
  }
  return {
    needsReach: false,
    code: "reached",
    reason:
      smsStatus === "delivered"
        ? "SMS delivered. No manual action needed."
        : "Confirmation sent, no failures detected. No manual action needed.",
    channels: [],
  };
}

module.exports = { BOOKED_STAGES, RULE, isBooked, stageName, evaluate };
