// GET /api/leads
// Reads the live pipeline from GoHighLevel, applies the reach-out rule to every
// booked lead, and returns the result grouped by salesperson. The browser never
// sees the GHL token; it only sees this clean JSON.

const {
  searchOpportunities,
  getUsers,
  getContact,
  getSmsStatus,
  mapLimit,
} = require("../lib/ghl");
const { RULE, isBooked, stageName, evaluate } = require("../lib/evaluate");

module.exports = async (req, res) => {
  if (!process.env.GHL_TOKEN || !process.env.GHL_LOCATION_ID) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN or GHL_LOCATION_ID." });
    return;
  }
  try {
    const [opps, users] = await Promise.all([searchOpportunities(), getUsers()]);

    // Keep only booked / active stages.
    const booked = opps.filter((o) => isBooked(o.pipelineStageId));

    // Optional manual name overrides, in case a GHL user has no readable name.
    // Format: {"userId":"Name", ...}
    let overrides = {};
    try {
      overrides = JSON.parse(process.env.REP_NAMES || "{}");
    } catch (_) {}

    const leads = await mapLimit(booked, 6, async (o) => {
      const rel = (o.relations && o.relations[0]) || {};
      const contactId = o.contactId || rel.recordId;
      const phoneFromOpp = rel.phone || "";

      let hasPhone = Boolean(phoneFromOpp);
      let emailBounced = false;
      let email = rel.email || "";
      let phone = phoneFromOpp;

      // Read the contact for the email deliverability flag and to confirm phone.
      try {
        const c = await getContact(contactId);
        if (c) {
          phone = c.phone || phone;
          email = c.email || email;
          hasPhone = Boolean(phone);
          const em = c.dndSettings && c.dndSettings.Email;
          // A hard bounce flips Email DND to active.
          emailBounced = Boolean(em && em.status === "active");
        }
      } catch (_) {}

      // Only check SMS delivery when there is a number to check.
      let smsStatus = null;
      if (hasPhone) {
        try {
          const s = await getSmsStatus(contactId);
          smsStatus = s.attempted ? s.status : null;
        } catch (_) {}
      }

      const verdict = evaluate({ hasPhone, smsStatus, emailBounced });
      const repId = o.assignedTo || "unassigned";
      const repName = overrides[repId] || users[repId] || "Unassigned";

      return {
        id: o.id,
        contactId,
        name: o.name || rel.fullName || rel.contactName || "Unknown",
        company: rel.companyName || "",
        email,
        phone,
        stage: stageName(o.pipelineStageId),
        repId,
        repName,
        createdAt: o.createdAt,
        smsStatus,
        emailBounced,
        needsReach: verdict.needsReach,
        code: verdict.code,
        reason: verdict.reason,
        channels: verdict.channels,
      };
    });

    // Group by salesperson.
    const byRep = {};
    for (const l of leads) {
      if (!byRep[l.repId]) byRep[l.repId] = { repId: l.repId, repName: l.repName, leads: [] };
      byRep[l.repId].leads.push(l);
    }
    const reps = Object.values(byRep).sort((a, b) => a.repName.localeCompare(b.repName));
    for (const r of reps) {
      r.needsReach = r.leads.filter((l) => l.needsReach).length;
      r.total = r.leads.length;
      // Put the ones needing action first.
      r.leads.sort((a, b) => Number(b.needsReach) - Number(a.needsReach));
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      rule: RULE,
      totalBooked: leads.length,
      totalNeedsReach: leads.filter((l) => l.needsReach).length,
      reps,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
