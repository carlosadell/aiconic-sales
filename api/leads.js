// GET /api/leads
// Reads the live pipeline from GoHighLevel. Returns the live stage list (in the
// exact order they are in the CRM) and every open lead, each tagged with the
// stage it is in, what we already sent, the call-prep links, and any flags.
// The browser never sees the GHL token.
//
// The heavy per-lead reads (contact + conversation history) only run for the
// stages a rep actually works from a card: the booked calls and the follow-up
// lanes. Reference stages (Survey, Client Won, Baking, Not Qualified, Never
// Rescheduled) are built lightweight from the opportunity itself, so the page
// stays fast even as those stages fill up.

const { requireUser } = require("../lib/auth");
const {
  searchOpportunities,
  getPipeline,
  getUsers,
  getContact,
  getComms,
  mapLimit,
  LOCATION_ID,
} = require("../lib/ghl");
const { RULE, ALL_STAGES, statusFromStageName, callType, autoFromStageName, evaluate } = require("../lib/evaluate");

// Fixed links, same as the GoHighLevel call-prep email. Change here if they move.
const LINKS = {
  hubBase: "https://app.theiconicceo.com/v2/location",
  conversify: "https://conversifi.io/dashboard",
  script: "https://docs.google.com/document/d/1CXYZJrlmfJxLXVL10Lg04sGHbqfFgve2FKqv0MyeWW8/edit",
  interviewQuestions: "https://docs.google.com/document/d/1obuxJO9o69lKt3i52-iLLtScCgm1vzL9rdluUESggfY/edit",
  interviewCarlos: "https://app.aiconichub.ai/leads-engine-interview",
  bookLkdn: "https://app.aiconichub.ai/leads-engine-lkdn",
  bookDefault: "https://app.aiconichub.ai/leads-engine",
};

// The stages a rep works from a card, so only these get the heavy CRM reads.
const NEEDS_PREP = new Set(["booked", "noshow", "rescheduling", "bookinginterview", "bookingreview", "cancelled"]);

// Work out where the lead really came from, from the opportunity's own
// attribution (the pages and referrers GoHighLevel recorded), not a guess.
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
  const who = await requireUser(req, res);
  if (!who) return;
  if (!process.env.GHL_TOKEN || !process.env.GHL_LOCATION_ID) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN or GHL_LOCATION_ID." });
    return;
  }
  try {
    const [opps, users, livePipeline] = await Promise.all([searchOpportunities(), getUsers(), getPipeline()]);

    // The stage list, live from the CRM (with a fallback if the read failed).
    const pipeline = (livePipeline && livePipeline.length ? livePipeline : ALL_STAGES);
    const stageById = {};
    pipeline.forEach((s) => { stageById[s.id] = s; });
    const stages = pipeline.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      color: s.color || "",
      auto: autoFromStageName(s.name),
      status: statusFromStageName(s.name),
    }));

    let overrides = {};
    try { overrides = JSON.parse(process.env.REP_NAMES || "{}"); } catch (_) {}

    // Tag every open opportunity with its stage and status.
    const tagged = opps.map((o) => {
      const stageId = o.pipelineStageId;
      const stageName = (stageById[stageId] && stageById[stageId].name) || "Other";
      return { o, stageId, stageName, status: statusFromStageName(stageName) };
    });

    // Build a full lead object. `enrich` carries the contact + comms when we
    // fetched them; when null, the lead is built lightweight from the opp alone.
    function buildLead({ o, stageId, stageName, status }, enrich) {
      const rel = (o.relations && o.relations[0]) || {};
      const contactId = o.contactId || rel.recordId;
      const contact = enrich ? enrich.contact : null;
      const comms = (enrich && enrich.comms) || { lastEmail: null, lastSms: null, appointment: null, rescheduleLink: null };
      const commsOk = enrich ? enrich.commsOk : true;

      let phone = rel.phone || "";
      let email = rel.email || "";
      let tags = rel.tags || [];
      let emailBounced = false;
      let timezone = "";
      if (contact) {
        phone = contact.phone || phone;
        email = contact.email || email;
        tags = contact.tags || tags;
        timezone = contact.timezone || "";
        const em = contact.dndSettings && contact.dndSettings.Email;
        emailBounced = Boolean(em && em.status === "active");
      }

      const cal = (o.calenders && o.calenders[0]) || null;
      const apptAt = (cal && cal.startTime) || (comms.appointment && comms.appointment.at) || null;
      const apptTz = (cal && cal.selectedTimezone) || timezone || "";
      const appointment = apptAt
        ? { at: apptAt, title: (comms.appointment && comms.appointment.title) || "" }
        : comms.appointment;

      const src = sourceOf(o.attributions, contact, tags);
      const smsStatus = comms.lastSms ? comms.lastSms.status : null;
      const hasPhone = Boolean(phone);
      // Flags only matter on the stages a rep reaches out from. Reference stages
      // are not flagged, so the board stays quiet.
      const v = enrich ? evaluate({ hasPhone, smsStatus, emailBounced }) : { flagged: false, flags: [], primaryFlag: null, channels: hasPhone ? ["sms", "linkedin", "email"] : ["linkedin", "email"] };

      const repId = o.assignedTo || "unassigned";
      const repName = overrides[repId] || users[repId] || "Unassigned";
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
        stage: stageName,
        stageId,
        callType: callType(stageName),
        repId,
        repName,
        source: src.label,
        sourceCheck: src.check,
        appointment,
        lastEmail: comms.lastEmail,
        lastSms: comms.lastSms,
        commsOk,
        rebookLink: rebook,
        rebookIsPersonal: Boolean(comms.rescheduleLink),
        bookingLink: generalBooking,
        links: {
          contact: `${LINKS.hubBase}/${LOCATION_ID}/contacts/detail/${contactId}`,
          pipeline: `${LINKS.hubBase}/${LOCATION_ID}/opportunities`,
          conversify: LINKS.conversify,
          script: LINKS.script,
          interviewQuestions: LINKS.interviewQuestions,
          interviewBooking: LINKS.interviewCarlos,
          interviewCarlos: LINKS.interviewCarlos,
        },
        flagged: v.flagged,
        flags: v.flags,
        primaryFlag: v.primaryFlag,
        channels: v.channels,
      };
    }

    // Heavy reads only for the stages a rep works from a card.
    const prep = tagged.filter((t) => NEEDS_PREP.has(t.status));
    const light = tagged.filter((t) => !NEEDS_PREP.has(t.status));

    const prepLeads = await mapLimit(prep, 4, async (t) => {
      const contactId = t.o.contactId || (t.o.relations && t.o.relations[0] && t.o.relations[0].recordId);
      let contact = null;
      try { contact = await getContact(contactId); } catch (_) {}
      let comms = { lastEmail: null, lastSms: null, appointment: null, rescheduleLink: null };
      let commsOk = true;
      try { comms = await getComms(contactId); } catch (_) { commsOk = false; }
      return buildLead(t, { contact, comms, commsOk });
    });

    const lightLeads = light.map((t) => buildLead(t, null));
    const leads = prepLeads.concat(lightLeads);

    // Counts per status, for anyone who wants a quick total.
    const totals = {};
    leads.forEach((l) => { totals[l.status] = (totals[l.status] || 0) + 1; });
    totals.flagged = leads.filter((l) => l.flagged).length;

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      rule: RULE,
      stages,
      totals,
      leads,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};

// Give Vercel room to read the pipeline plus the per-lead history under load.
module.exports.config = { maxDuration: 60 };
