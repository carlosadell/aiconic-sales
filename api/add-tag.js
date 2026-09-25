// POST /api/add-tag  { contactId, tag }
// Adds one tag to a contact in GoHighLevel. The tag is what moves a lead: the
// matching workflow in the CRM picks it up, sets the stage, and starts the right
// sequence. This is the only way the sales toolkit moves a lead, so a slip cannot
// fire the wrong sequence. The browser never sees the GHL token.

const { requireUser } = require("../lib/auth");
const { addTag, addNote } = require("../lib/ghl");

module.exports = async (req, res) => {
  const who = await requireUser(req, res);
  if (!who) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  if (!process.env.GHL_TOKEN) {
    res.status(500).json({ ok: false, error: "Server is missing GHL_TOKEN." });
    return;
  }
  try {
    let body = req.body;
    if (!body || typeof body === "string") {
      try { body = JSON.parse(body || "{}"); } catch (_) { body = {}; }
    }
    const contactId = body && body.contactId;
    const tag = body && body.tag;
    if (!contactId || !tag) {
      res.status(400).json({ ok: false, error: "contactId and tag are required." });
      return;
    }
    await addTag(contactId, tag);
    try { await addNote(contactId, `Tagged "${tag}" from the sales toolkit by ${who.name} (${who.email}).`, who.ghlUserId); } catch (_) {}
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
};
