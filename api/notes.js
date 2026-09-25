// GET  /api/notes?contactId=xxx           -> { notes: [{ id, body, at }] }
// POST /api/notes { contactId, body, userId } -> { ok, note }
// Read and write GoHighLevel contact notes, so a rep can see the call history
// and log a new note without opening the CRM. The token stays on the server.

const { requireUser } = require("../lib/auth");
const { getNotes, addNote } = require("../lib/ghl");

module.exports = async (req, res) => {
  const who = await requireUser(req, res);
  if (!who) return;
  if (!process.env.GHL_TOKEN || !process.env.GHL_LOCATION_ID) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN or GHL_LOCATION_ID." });
    return;
  }

  try {
    if (req.method === "GET") {
      const contactId = (req.query && req.query.contactId) || "";
      if (!contactId) {
        res.status(400).json({ error: "contactId is required." });
        return;
      }
      const notes = await getNotes(contactId);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ notes });
      return;
    }

    if (req.method === "POST") {
      let body = req.body;
      if (!body || typeof body === "string") {
        try {
          body = JSON.parse(body || "{}");
        } catch (_) {
          body = {};
        }
      }
      const { contactId } = body;
      const text = body.body;
      if (!contactId || !text || !String(text).trim()) {
        res.status(400).json({ error: "contactId and a note body are required." });
        return;
      }
      const note = await addNote(contactId, text, who.ghlUserId);
      res.status(200).json({ ok: true, note });
      return;
    }

    res.status(405).json({ error: "Use GET or POST." });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
