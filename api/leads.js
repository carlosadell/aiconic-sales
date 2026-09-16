// GET /api/leads
// Reads the live pipeline from GoHighLevel. Returns every booked lead and every
// no-show, grouped by salesperson, each with what we already sent, the call-prep
// links, and any flags. The browser never sees the GHL token.

const {
  searchOpportunities,
  getUsers,
  getContact,
  getComms,
  mapLimit,
  LOCATION_ID,
} = require("../lib/ghl");
const { RULE, ALL_STAGES, stageStatus, stageName, callType, evaluate } = require("../lib/evaluate");

// Fixed links, same as the GoHighLevel call-prep email. Change here if they move.
const LINKS = {
  hubBase: "https://app.theiconicceo.com/v2/location",
  conversify: "https://conversifi.io/dashboard",
  script: "https://docs.google.com/document/d/1CXYZJrlmfJxLXVL10Lg04sGHbqfFgve2FKqv0MyeWW8/edit",
  interviewQuestions: "https://docs.google.com/document/d/1obuxJO9o69lKt3i52-iLLtScCgm1vzL9rdluUESggfY/edit",
  // Interview calendars by rep. John's leads book on John's calendar, everyone
  // else books on the Carlos calendar (the original link).
  interviewCarlos: "https://app.aiconichub.ai/leads-engine-interview",
  interviewJohn: "https://app.aiconichub.ai/leads-engine-interview-john",
  // Fallback rebooking links by source, used when a lead has no personal reschedule link.
  bookLkdn: "https://app.aiconichub.ai/leads-engine-lkdn",
  bookDefault: "https://app.aiconichub.ai/leads-engine",
};

// Work out where the lead really came from, from the opportunity's own
// attribution (the pages and referrers GoHighLevel recorded), not a guess.
// Web pages and channel signals are read separately so an "email=" query
// parameter in a booking URL is never mistaken for an email-campaign lead.
function sourceOf(attributions, contact, tags) {
  const attrs = attributions || [];
  const web = attrs.map((a) => (a.pageUrl || "") + " " + (a.url || "") + " " + (a.referrer || "")).join(" ").toLowerCase();
  const channel = (attrs.map((a) => (a.utmSessionSource || "") + " " + (a.medium || "")).join(" ") + " " + ((contact && contact.source) || "") + " " + (tags || []).join(" ")).toLowerCase();
  const social = attrs.some((a) => String(a.utmSessionSource || "").toLowerCase() === "social media");

  if (web.includes("linkedin") || web.includes("lkdn") || channel.includes("linkedin") || channel.includes("lkdn") || social) {
    return { label: "LinkedIn", check: "They came in from LinkedIn. Check their profile and the Conversify conversations." };
  }
  if (channel.includes("email") || channel.includes("cold") || channel.includes("stamina")) {
    return { label: "Email campaign", check: "From our email campaigns. Try to find them on LinkedIn first." };
  }
  if (/https?:\/\//.test(web) || web.includes("apply") || web.includes("survey") || web.includes("schedule") || web.includes("leads-engine") || web.includes("iconicbusinesshub") || web.includes("aiconichub") || web.includes("discovery") || web.includes("connect")) {
    return { label: "Website", check: "They came through our website funnel. Read their survey answers before you dial." };
  }
  return { label: "Source unknown", check: "No clear source on file, so open the contact card to check where they came from." };
}

module.exports = async (req, res) => {
  if (!process.env.GHL_TOKEN || !process.env.GHL_LOCATION_ID) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN or GHL_LOCATION_ID." });
    return;
  }
  try {
    const [opps, users] = await Promise.all([searchOpportunities(), getUsers()]);
    const active = opps.map((o) => ({ o, status: stageStatus(o.pipelineStageId) })).filter((x) => x.status);

    let overrides = {};
    try {
      overrides = JSON.parse(process.env.REP_NAMES || "{}");
    } catch (_) {}

    const leads = await mapLimit(active, 6, async ({ o, status }) => {
      const rel = (o.relations && o.relations[0]) || {};
      const contactId = o.contactId || rel.recordId;
      let phone = rel.phone || "";
      let email = rel.email || "";
      let tags = rel.tags || [];
      let contact = null;
      let emailBounced = false;
      let timezone = "";

      try {
        contact = await getContact(contactId);
        if (contact) {
          phone = contact.phone || phone;
          email = contact.email || email;
          tags = contact.tags || tags;
          timezone = contact.timezone || "";
          const em = contact.dndSettings && contact.dndSettings.Email;
          emailBounced = Boolean(em && em.status === "active");
        }
      } catch (_) {}

      let comms = { lastEmail: null, lastSms: null, appointment: null, rescheduleLink: null };
      try {
        comms = await getComms(contactId);
      } catch (_) {}

      const smsStatus = comms.lastSms ? comms.lastSms.status : null;
      const hasPhone = Boolean(phone);
      const v = evaluate({ hasPhone, smsStatus, emailBounced });

      const repId = o.assignedTo || "unassigned";
      const repName = overrides[repId] || users[repId] || "Unassigned";
      const src = sourceOf(o.attributions, contact, tags);

      // The booked call date comes from the opportunity's own calendar record,
      // which is reliable, not from scraping the conversation for an activity.
      const cal = (o.calenders && o.calenders[0]) || null;
      const apptAt = (cal && cal.startTime) || (comms.appointment && comms.appointment.at) || null;
      const apptTz = (cal && cal.selectedTimezone) || timezone || "";
      const appointment = apptAt
        ? { at: apptAt, title: (comms.appointment && comms.appointment.title) || "" }
        : comms.appointment;

      const generalBooking = src.label === "LinkedIn" ? LINKS.bookLkdn : LINKS.bookDefault;
      const rebook = comms.rescheduleLink || generalBooking;

      return {
        id: o.id,
        contactId,
        status,
        name: o.name || rel.fullName || rel.contactName || "Unknown",
        company: rel.companyName || "",
        email,
        phone,
        timezone: apptTz,
        stage: stageName(o.pipelineStageId),
        stageId: o.pipelineStageId,
        callType: callType(stageName(o.pipelineStageId)),
        repId,
        repName,
        source: src.label,
        sourceCheck: src.check,
        appointment,
        lastEmail: comms.lastEmail,
        lastSms: comms.lastSms,
        rebookLink: rebook,
        rebookIsPersonal: Boolean(comms.rescheduleLink),
        bookingLink: generalBooking,
        links: {
          contact: `${LINKS.hubBase}/${LOCATION_ID}/contacts/detail/${contactId}`,
          pipeline: `${LINKS.hubBase}/${LOCATION_ID}/opportunities`,
          conversify: LINKS.conversify,
          script: LINKS.script,
          interviewQuestions: LINKS.interviewQuestions,
          interviewBooking: /john/i.test(repName) ? LINKS.interviewJohn : LINKS.interviewCarlos,
        },
        flagged: v.flagged,
        flags: v.flags,
        primaryFlag: v.primaryFlag,
        channels: v.channels,
      };
    });

    // Group by status, then by rep.
    function group(items) {
      const byRep = {};
      for (const l of items) {
        if (!byRep[l.repId]) byRep[l.repId] = { repId: l.repId, repName: l.repName, leads: [] };
        byRep[l.repId].leads.push(l);
      }
      const reps = Object.values(byRep).sort((a, b) => a.repName.localeCompare(b.repName));
      // Chronological by call date, soonest first, so a rep can prepare in order.
      // Leads with no appointment date on file sort to the bottom.
      const apptTime = (l) => {
        const at = l.appointment && l.appointment.at;
        const t = at ? new Date(at).getTime() : NaN;
        return Number.isFinite(t) ? t : Infinity;
      };
      for (const r of reps) {
        r.total = r.leads.length;
        r.flagged = r.leads.filter((l) => l.flagged).length;
        r.leads.sort((a, b) => {
          const ta = apptTime(a), tb = apptTime(b);
          if (ta !== tb) return ta - tb;
          return String(a.name || "").localeCompare(String(b.name || ""));
        });
      }
      return reps;
    }

    const booked = leads.filter((l) => l.status === "booked");
    const noshow = leads.filter((l) => l.status === "noshow");
    const rescheduling = leads.filter((l) => l.status === "rescheduling");

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      rule: RULE,
      stages: ALL_STAGES,
      totals: {
        booked: booked.length,
        noshow: noshow.length,
        rescheduling: rescheduling.length,
        flagged: leads.filter((l) => l.flagged).length,
      },
      booked: group(booked),
      noshow: group(noshow),
      rescheduling: group(rescheduling),
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
