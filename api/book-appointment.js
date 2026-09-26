// POST /api/book-appointment {contactId, callType, startTime, timezone}
// -> { ok: true, appointment }
// Books the slot on the resolved calendar, confirms it immediately, and logs
// a note on the contact so the CRM shows who booked it and when.

const { requireUser } = require("../lib/auth");
const { calendarIdFor, createAppointment, addNote } = require("../lib/ghl");

const LABEL = { interview: "Interview", review: "Review" };

module.exports = async (req, res) => {
  const who = await requireUser(req, res);
  if (!who) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!process.env.GHL_TOKEN || !process.env.GHL_LOCATION_ID) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN or GHL_LOCATION_ID." });
    return;
  }

  let body = req.body;
  if (!body || typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch (_) {
      body = {};
    }
  }
  const { contactId, callType, startTime, timezone } = body;
  const calendarId = calendarIdFor(callType);

  if (!contactId) {
    res.status(400).json({ error: "contactId is required." });
    return;
  }
  if (!calendarId) {
    res.status(400).json({ error: "callType must be interview or review, and that calendar must be configured." });
    return;
  }
  if (!startTime) {
    res.status(400).json({ error: "startTime is required." });
    return;
  }
  if (!timezone) {
    res.status(400).json({ error: "timezone is required." });
    return;
  }

  try {
    const appointment = await createAppointment({ calendarId, contactId, startTime, timezone });
    try {
      const when = new Date(startTime).toLocaleString("en-US", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "short",
      });
      const label = LABEL[callType] || "Call";
      await addNote(
        contactId,
        `${label} booked from the sales toolkit by ${who.name} (${who.email}) for ${when} (${timezone}).`,
        who.ghlUserId
      );
    } catch (_) {
      // The booking already succeeded; a note failure must not undo it.
    }
    res.status(200).json({ ok: true, appointment });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
