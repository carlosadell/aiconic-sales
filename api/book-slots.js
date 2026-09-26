// GET /api/book-slots?callType=interview|review&date=YYYY-MM-DD&tz=America/New_York
// -> { slots: [ "2026-10-01T09:00:00-04:00", ... ] }
// Open slots for one calendar, one day, in the given time zone. This is the
// only place that calls GHL for this feature; the token never reaches the browser.

const { requireUser } = require("../lib/auth");
const { calendarIdFor, getFreeSlots } = require("../lib/ghl");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async (req, res) => {
  const who = await requireUser(req, res);
  if (!who) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  if (!process.env.GHL_TOKEN || !process.env.GHL_LOCATION_ID) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN or GHL_LOCATION_ID." });
    return;
  }

  const callType = (req.query && req.query.callType) || "";
  const date = (req.query && req.query.date) || "";
  const tz = (req.query && req.query.tz) || "";
  const calendarId = calendarIdFor(callType);

  if (!calendarId) {
    res.status(400).json({ error: "callType must be interview or review, and that calendar must be configured." });
    return;
  }
  if (!DATE_RE.test(date)) {
    res.status(400).json({ error: "date must be in YYYY-MM-DD form." });
    return;
  }
  if (!tz) {
    res.status(400).json({ error: "tz is required." });
    return;
  }

  try {
    const slots = await getFreeSlots(calendarId, date, tz);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ slots });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
