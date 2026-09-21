// How the list works.
//
// Every person who books a call gets a personal message from their
// salesperson, and every person who does not show up gets a personal message
// too, so they can rebook. That is what lifts the show-up rate.
//
// We reach out everywhere we can: a personal SMS through GoHighLevel when we
// have a number, a note on LinkedIn, and an email. Not one or the other. The
// automatic message from the CRM still goes out; this is the human touch on top.
//
// We also flag anything the rep should know before reaching out: no phone, a
// failed SMS, or a bounced email.

// Upcoming booked calls.
const BOOKED_STAGES = {
  "31264788-1dc2-4f34-abcc-191b0cf0d856": "Intro Call",
  "fbb75036-ca89-43ee-948a-ed9f60d324f8": "Interview Call Booked",
  "ae66e02e-8a8a-446d-a26f-85bce067126c": "Review Call Booked",
};

// People who booked but did not show. They need a rebook nudge.
const NOSHOW_STAGES = {
  "ba034c58-d6e0-451e-bb39-7b146322a062": "No Show",
};

// People who cancelled their call. They stay in the system and get their own
// view so a rep can reach out and get them to rebook.
const CANCELLED_STAGES = {
  "957c27c1-4988-43a1-af17-042157fef72e": "Cancelled",
};

// People we are actively trying to reschedule. A lead only lands here because
// someone moved it here by hand. This is the one part of the process we do
// manually, so this stage is where those people wait for a new booking.
const RESCHEDULING_STAGES = {
  "69fd1adb-995d-49cd-90fd-0d2ddac2de2e": "Rescheduling",
};

// People who qualified on the intro call but have not booked their interview
// yet. A lead only lands here by hand, and we follow up until they book.
const BOOKING_INTERVIEW_STAGES = {
  "52d0b1ab-88b1-452b-8966-88e269e9ec75": "Booking Interview",
};

// People who had their interview but have not booked their review call yet. A
// lead only lands here by hand. No automation runs on this stage, so a rep
// follows up manually to get the review booked within the week.
const BOOKING_REVIEW_STAGES = {
  "948a6e28-7669-402e-b632-d84b452ebac0": "Booking Review",
};

// People who became clients. Shown so a rep can look back at the account and
// its previous calls and notes. No outreach runs from here.
const CLIENTWON_STAGES = {
  "e234a6dd-9f75-4bdc-80d5-c622514b39d8": "Client Won",
};

// People taken out of the process because they were not a fit. Kept visible so a
// rep can review who was dropped and why, and reach back if something changed.
const NOTQUALIFIED_STAGES = {
  "318f54f7-a286-4bd1-94af-404d9765d826": "Not Qualified",
};

const RULE = {
  title: "How this list works",
  intro:
    "Everyone who books a call gets a personal message, and everyone who does not show up gets one too, so they can rebook. Reach them everywhere you can: a personal SMS, a LinkedIn note, and an email. The automatic message from the CRM still goes out; this is the human touch on top.",
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
// Exact same order as the Free Trial Funnels pipeline in GoHighLevel.
// auto:true means the CRM moves a lead into this stage on its own, so a rep
// must not pick it in the Move stage dropdown (it is shown but disabled).
const ALL_STAGES = [
  { id: "31264788-1dc2-4f34-abcc-191b0cf0d856", name: "Intro Call", auto: true },
  { id: "ba034c58-d6e0-451e-bb39-7b146322a062", name: "No Show (triggers FUP)", auto: false },
  { id: "52d0b1ab-88b1-452b-8966-88e269e9ec75", name: "Booking Interview (triggers FUP)", auto: false },
  { id: "fbb75036-ca89-43ee-948a-ed9f60d324f8", name: "Interview Call Booked", auto: true },
  { id: "948a6e28-7669-402e-b632-d84b452ebac0", name: "Booking Review", auto: false },
  { id: "ae66e02e-8a8a-446d-a26f-85bce067126c", name: "Review Call Booked", auto: true },
  { id: "69fd1adb-995d-49cd-90fd-0d2ddac2de2e", name: "🚨 Reschedule (triggers FUP)", auto: false },
  { id: "957c27c1-4988-43a1-af17-042157fef72e", name: "Cancelled", auto: true },
  { id: "e234a6dd-9f75-4bdc-80d5-c622514b39d8", name: "🔥 Client Won", auto: true },
  { id: "318f54f7-a286-4bd1-94af-404d9765d826", name: "⛔️ Not Qualified", auto: false },
];

function stageStatus(stageId) {
  if (Object.prototype.hasOwnProperty.call(BOOKED_STAGES, stageId)) return "booked";
  if (Object.prototype.hasOwnProperty.call(NOSHOW_STAGES, stageId)) return "noshow";
  if (Object.prototype.hasOwnProperty.call(RESCHEDULING_STAGES, stageId)) return "rescheduling";
  if (Object.prototype.hasOwnProperty.call(BOOKING_INTERVIEW_STAGES, stageId)) return "bookinginterview";
  if (Object.prototype.hasOwnProperty.call(BOOKING_REVIEW_STAGES, stageId)) return "bookingreview";
  if (Object.prototype.hasOwnProperty.call(CANCELLED_STAGES, stageId)) return "cancelled";
  if (Object.prototype.hasOwnProperty.call(CLIENTWON_STAGES, stageId)) return "clientwon";
  if (Object.prototype.hasOwnProperty.call(NOTQUALIFIED_STAGES, stageId)) return "notqualified";
  return null;
}
function stageName(stageId) {
  return BOOKED_STAGES[stageId] || NOSHOW_STAGES[stageId] || RESCHEDULING_STAGES[stageId] || BOOKING_INTERVIEW_STAGES[stageId] || BOOKING_REVIEW_STAGES[stageId] || CANCELLED_STAGES[stageId] || CLIENTWON_STAGES[stageId] || NOTQUALIFIED_STAGES[stageId] || "Other";
}
// Short, plain call type for the main list.
function callType(name) {
  if (/booking interview/i.test(name)) return "Booking interview";
  if (/booking review/i.test(name)) return "Booking review";
  if (/interview/i.test(name)) return "Interview";
  if (/review/i.test(name)) return "Review";
  if (/intro/i.test(name)) return "Intro";
  if (/no show/i.test(name)) return "No show";
  if (/reschedul/i.test(name)) return "Rescheduling";
  if (/cancel/i.test(name)) return "Cancelled";
  if (/client won/i.test(name)) return "Client won";
  if (/not qualified/i.test(name)) return "Not qualified";
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

module.exports = { BOOKED_STAGES, NOSHOW_STAGES, CANCELLED_STAGES, RESCHEDULING_STAGES, BOOKING_INTERVIEW_STAGES, BOOKING_REVIEW_STAGES, CLIENTWON_STAGES, NOTQUALIFIED_STAGES, ALL_STAGES, RULE, stageStatus, stageName, callType, evaluate };
