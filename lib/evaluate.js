// How the list works.
//
// Every person who books a call gets a personal message from their
// salesperson, and every person who does not show up gets a personal message
// too, so they can rebook. That is what lifts the show-up rate.
//
// We reach out everywhere we can: a personal SMS through GoHighLevel when we
// have a number, a note on LinkedIn, and an email. Not one or the other. The
// automatic GoHighLevel message still goes out; this is the human touch on top.
//
// We also flag anything the rep should know before reaching out: no phone, a
// failed SMS, or a bounced email.

// Upcoming booked calls.
const BOOKED_STAGES = {
  "31264788-1dc2-4f34-abcc-191b0cf0d856": "Intro Call",
  "fbb75036-ca89-43ee-948a-ed9f60d324f8": "Interview Call Booked",
  "ae66e02e-8a8a-446d-a26f-85bce067126c": "Review Call Booked",
};

// People who booked but did not show, or cancelled. They need a rebook nudge.
const NOSHOW_STAGES = {
  "ba034c58-d6e0-451e-bb39-7b146322a062": "No Show",
  "957c27c1-4988-43a1-af17-042157fef72e": "Cancelled",
};

// People we are actively trying to reschedule. A lead only lands here because
// someone moved it here by hand. This is the one part of the process we do
// manually, so this stage is where those people wait for a new booking.
const RESCHEDULING_STAGES = {
  "69fd1adb-995d-49cd-90fd-0d2ddac2de2e": "Rescheduling",
};

const RULE = {
  title: "How this list works",
  intro:
    "Everyone who books a call gets a personal message, and everyone who does not show up gets one too, so they can rebook. Reach them everywhere you can: a personal SMS, a LinkedIn note, and an email. The automatic GoHighLevel message still goes out; this is the human touch on top.",
  flagsTitle: "We also flag anything important",
  flags: [
    "No phone on file, so the automatic SMS could not be sent.",
    "The SMS failed to deliver, usually a carrier or country block.",
    "The confirmation email bounced, so the address is invalid.",
  ],
  note:
    "A flag never means skip someone. We reach out to everyone. It just tells you what is going on and which channel will land.",
};

// Every stage in the Free Trial Funnels pipeline, in order, so a rep can move a
// deal from inside the app instead of opening GoHighLevel.
const ALL_STAGES = [
  { id: "31264788-1dc2-4f34-abcc-191b0cf0d856", name: "Intro Call" },
  { id: "fbb75036-ca89-43ee-948a-ed9f60d324f8", name: "Interview Call Booked" },
  { id: "ae66e02e-8a8a-446d-a26f-85bce067126c", name: "Review Call Booked" },
  { id: "ba034c58-d6e0-451e-bb39-7b146322a062", name: "No Show" },
  { id: "69fd1adb-995d-49cd-90fd-0d2ddac2de2e", name: "Rescheduling" },
  { id: "957c27c1-4988-43a1-af17-042157fef72e", name: "Cancelled" },
  { id: "318f54f7-a286-4bd1-94af-404d9765d826", name: "Not Qualified" },
  { id: "e234a6dd-9f75-4bdc-80d5-c622514b39d8", name: "Client/Won" },
];

function stageStatus(stageId) {
  if (Object.prototype.hasOwnProperty.call(BOOKED_STAGES, stageId)) return "booked";
  if (Object.prototype.hasOwnProperty.call(NOSHOW_STAGES, stageId)) return "noshow";
  if (Object.prototype.hasOwnProperty.call(RESCHEDULING_STAGES, stageId)) return "rescheduling";
  return null;
}
function stageName(stageId) {
  return BOOKED_STAGES[stageId] || NOSHOW_STAGES[stageId] || RESCHEDULING_STAGES[stageId] || "Other";
}
// Short, plain call type for the main list.
function callType(name) {
  if (/interview/i.test(name)) return "Interview";
  if (/review/i.test(name)) return "Review";
  if (/intro/i.test(name)) return "Intro";
  if (/no show/i.test(name)) return "No show";
  if (/reschedul/i.test(name)) return "Rescheduling";
  if (/cancel/i.test(name)) return "Cancelled";
  return name;
}

// Flags plus the channels to use. We list every channel available so the rep
// can reach the person in more than one place.
// signals: { hasPhone, smsStatus, emailBounced }
function evaluate(signals) {
  const { hasPhone, smsStatus, emailBounced } = signals;
  const smsFailed = hasPhone && (smsStatus === "failed" || smsStatus === "undelivered");

  const flags = [];
  if (!hasPhone) flags.push({ code: "no_phone", label: "No phone", text: "No phone number on file, so the automatic SMS could not be sent." });
  if (smsFailed) flags.push({ code: "sms_failed", label: "SMS failed", text: "Phone on file, but the SMS failed to deliver (carrier or country block)." });
  if (emailBounced) flags.push({ code: "email_bounced", label: "Email invalid", text: "The confirmation email bounced, so the address is invalid." });

  // Every channel we can use, so nobody is reached in only one place.
  const channels = [];
  if (hasPhone) channels.push("sms");
  channels.push("linkedin");
  if (!emailBounced) channels.push("email");

  return {
    flagged: flags.length > 0,
    flags,
    primaryFlag: flags[0] || null,
    channels,
  };
}

module.exports = { BOOKED_STAGES, NOSHOW_STAGES, RESCHEDULING_STAGES, ALL_STAGES, RULE, stageStatus, stageName, callType, evaluate };
