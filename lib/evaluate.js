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
//
// IMPORTANT: stage names are read live from the CRM pipeline, so this file no
// longer hard-codes stage ids. Everything is decided from the stage NAME, which
// means renaming or reordering a stage in GoHighLevel keeps working as long as
// the name still says what the stage is (intro, interview, review, reminders,
// booked, and so on). ALL_STAGES below is only a fallback used if the live
// pipeline read ever fails.

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

// Fallback stage list, current as of Sep 2026, used only if the live pipeline
// read fails. The app normally reads the live pipeline from the CRM instead.
const ALL_STAGES = [
  { id: "a556bbbe-5d00-490d-8dd6-1e05277e1964", name: "Survey Qualified" },
  { id: "31264788-1dc2-4f34-abcc-191b0cf0d856", name: "Intro Booked" },
  { id: "ba034c58-d6e0-451e-bb39-7b146322a062", name: "⏳ Book Intro Reminders (FUP)" },
  { id: "69fd1adb-995d-49cd-90fd-0d2ddac2de2e", name: "🚨 Sorry Emergency Intro Reminders (FUP)" },
  { id: "52d0b1ab-88b1-452b-8966-88e269e9ec75", name: "⏳ Book Interview Reminders (FUP)" },
  { id: "fbb75036-ca89-43ee-948a-ed9f60d324f8", name: "✅ Interview Booked" },
  { id: "948a6e28-7669-402e-b632-d84b452ebac0", name: "⏳ Book Review Reminders (FUP)" },
  { id: "ae66e02e-8a8a-446d-a26f-85bce067126c", name: "✅ Review Booked" },
  { id: "e234a6dd-9f75-4bdc-80d5-c622514b39d8", name: "🔥 Client Won (Manual)" },
  { id: "f683403c-0853-443b-a632-6f5186b218b6", name: "🍿 Baking (Manual)" },
  { id: "318f54f7-a286-4bd1-94af-404d9765d826", name: "⛔️ Not Qualified" },
  { id: "957c27c1-4988-43a1-af17-042157fef72e", name: "❌ Never Rescheduled" },
].map((s, i) => ({ ...s, position: i, color: "" }));

// The single source of truth for what a stage IS, from its name. The order of
// the checks matters: the more specific words are tested first.
function statusFromStageName(name) {
  const n = String(name || "").toLowerCase();
  if (/never\s*reschedul/.test(n)) return "neverrescheduled";
  if (/not\s*qualified/.test(n)) return "notqualified";
  if (/client\s*won/.test(n)) return "clientwon";
  if (/bak(ing|ed)/.test(n)) return "baking";
  if (/survey/.test(n)) return "survey";
  if (/sorry|emergency|reschedul/.test(n)) return "rescheduling";
  if (/reminder/.test(n)) {
    if (/interview/.test(n)) return "bookinginterview";
    if (/review/.test(n)) return "bookingreview";
    return "noshow"; // book intro reminders, no-show / cancel rebook lane
  }
  if (/booked|booking/.test(n) && !/reminder/.test(n)) return "booked";
  if (/cancel/.test(n)) return "cancelled"; // legacy, if a Cancelled stage exists
  if (/intro/.test(n)) return "booked";
  return "other";
}

// Short, plain call type for the card pill, also from the name.
function callType(name) {
  const n = String(name || "").toLowerCase();
  if (/never\s*reschedul/.test(n)) return "Never rescheduled";
  if (/not\s*qualified/.test(n)) return "Not qualified";
  if (/client\s*won/.test(n)) return "Client won";
  if (/bak(ing|ed)/.test(n)) return "Baking";
  if (/survey/.test(n)) return "Survey qualified";
  if (/sorry|emergency|reschedul/.test(n)) return "Reschedule";
  if (/reminder/.test(n)) {
    if (/interview/.test(n)) return "Book interview";
    if (/review/.test(n)) return "Book review";
    return "Rebook intro";
  }
  if (/interview/.test(n)) return "Interview";
  if (/review/.test(n)) return "Review";
  if (/intro/.test(n)) return "Intro";
  if (/cancel/.test(n)) return "Cancelled";
  return String(name || "").replace(/[^\x20-\x7E]/g, "").trim() || "Call";
}

// auto:true means the CRM moves a lead into this stage on its own, so a rep must
// not pick it in the Move stage dropdown (shown but disabled). The three booked
// milestones and Never Rescheduled are set by automation.
function autoFromStageName(name) {
  const n = String(name || "").toLowerCase();
  if (/reminder/.test(n)) return false;
  return /booked|never\s*reschedul|cancel/.test(n);
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

module.exports = {
  RULE,
  ALL_STAGES,
  statusFromStageName,
  callType,
  autoFromStageName,
  evaluate,
};
