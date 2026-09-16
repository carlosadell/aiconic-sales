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
  interviewBooking: "https://links.aiconichub.ai/widget/bookings/theiconicceocalendar/connect5c4w5xkqhn9olqneshszeydmmzdylhlvn4ar",
  // Fallback rebooking links by source, used when a lead has no personal reschedule link.
  bookLkdn: "https://app.aiconichub.ai/leads-engine-lkdn",
  bookDefault: "https://app.aiconichub.ai/leads-engine",
};

// Work out where the lead came from, for the call-prep note and the rebook link.
function sourceOf(contact, tags) {
  const hay = ((contact && contact.source) || "" + " " + (tags || []).join(" ")).toLowerCase();
  const all = (hay + " " + (tags || []).join(" ")).toLowerCase();
  if (all.includes("lkdn") || all.includes("linkedin")) return { label: "LinkedIn", check: "Check their profile and the Conversify conversations." };
  if (all.includes("apply") || all.includes("survey") || all.includes("website")) return { label: "Website", check: "They pre-qualified. Read their survey answers before you dial." };
  return { label: "Email campaign", check: "From our email campaigns. Try to find them on LinkedIn first." };
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
      const src = sourceOf(contact, tags);
      const rebook = comms.rescheduleLink || (src.label === "LinkedIn" ? LINKS.bookLkdn : LINKS.bookDefault);

      return {
        id: o.id,
        contactId,
        status,
        name: o.name || rel.fullName || rel.contactName || "Unknown",
        company: rel.companyName || "",
        email,
        phone,
        timezone,
        stage: stageName(o.pipelineStageId),
        stageId: o.pipelineStageId,
        callType: callType(stageName(o.pipelineStageId)),
        repId,
        repName,
        source: src.label,
        sourceCheck: src.check,
        appointment: comms.appointment,
        lastEmail: comms.lastEmail,
        lastSms: comms.lastSms,
        rebookLink: rebook,
        rebookIsPersonal: Boolean(comms.rescheduleLink),
        links: {
          contact: `${LINKS.hubBase}/${LOCATION_ID}/contacts/detail/${contactId}`,
          pipeline: `${LINKS.hubBase}/${LOCATION_ID}/opportunities`,
          conversify: LINKS.conversify,
          script: LINKS.script,
          interviewBooking: LINKS.interviewBooking,
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
      for (const r of reps) {
        r.total = r.leads.length;
        r.flagged = r.leads.filter((l) => l.flagged).length;
        r.leads.sort((a, b) => {
          if (a.flagged !== b.flagged) return Number(b.flagged) - Number(a.flagged);
          return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
        });
      }
      return reps;
    }

    const booked = leads.filter((l) => l.status === "booked");
    const noshow = leads.filter((l) => l.status === "noshow");

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      rule: RULE,
      stages: ALL_STAGES,
      totals: { booked: booked.length, noshow: noshow.length, flagged: leads.filter((l) => l.flagged).length },
      booked: group(booked),
      noshow: group(noshow),
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
