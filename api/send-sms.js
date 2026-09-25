// POST /api/send-sms   body: { contactId, message }
// Sends an SMS to the lead through GoHighLevel. The token stays on the server.

const { requireUser } = require("../lib/auth");
const { addNote } = require("../lib/ghl");
const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

module.exports = async (req, res) => {
  const who = await requireUser(req, res);
  if (!who) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!process.env.GHL_TOKEN) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN." });
    return;
  }

  // Body may arrive parsed or as a raw string depending on runtime.
  let body = req.body;
  if (!body || typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch (_) {
      body = {};
    }
  }
  const { contactId, message } = body;
  if (!contactId || !message) {
    res.status(400).json({ error: "contactId and message are required." });
    return;
  }

  try {
    const r = await fetch(`${BASE}/conversations/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GHL_TOKEN}`,
        Version: VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "SMS", contactId, message }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(502).json({ error: data.message || `GHL ${r.status}` });
      return;
    }
    try { await addNote(contactId, `Text sent from the sales toolkit by ${who.name} (${who.email}):\n\n${message}`, who.ghlUserId); } catch (_) {}
    res.status(200).json({ ok: true, messageId: data.messageId || data.id || null });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
