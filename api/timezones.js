// GET /api/timezones?ids=ID1,ID2,...  -> { timezones: { ID1: "America/New_York", ... } }
// The time zone saved on each contact in the CRM. The pipeline asks for these
// after it loads, for the leads whose time zone did not come with the pipeline
// read, so every lead row can show the lead's time zone. Up to 20 ids per call.

const { requireUser } = require("../lib/auth");
const { getContact, mapLimit } = require("../lib/ghl");

module.exports = async (req, res) => {
  const who = await requireUser(req, res);
  if (!who) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  if (!process.env.GHL_TOKEN) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN." });
    return;
  }
  const ids = String((req.query && req.query.ids) || "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const timezones = {};
  await mapLimit(ids, 5, async (id) => {
    try {
      const c = await getContact(id);
      timezones[id] = (c && c.timezone) || "";
    } catch (_) {
      timezones[id] = "";
    }
  });
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ timezones });
};
