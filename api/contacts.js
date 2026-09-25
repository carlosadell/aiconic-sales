// GET /api/contacts?q=maria      -> { contacts: [...] }  search any CRM contact
// GET /api/contacts?id=CONTACTID -> { contact, thread }  one contact plus the
//                                   recent texts and emails, both directions
// Used by the "Message a contact" tab. The token stays on the server.

const { requireUser } = require("../lib/auth");
const { searchContacts, getContact, getThread, contactSummary, LOCATION_ID } = require("../lib/ghl");
const HUB = "https://app.theiconicceo.com/v2/location";

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
  const q = String((req.query && req.query.q) || "").trim();
  const id = String((req.query && req.query.id) || "").trim();
  try {
    if (id) {
      const c = await getContact(id);
      const contact = contactSummary(c || { id });
      contact.crm = `${HUB}/${LOCATION_ID}/contacts/detail/${id}`;
      let thread = [];
      let threadError = null;
      try { thread = await getThread(id); } catch (e) { threadError = "Could not load the message history."; }
      res.status(200).json({ contact, thread, threadError });
      return;
    }
    if (q.length < 2) {
      res.status(200).json({ contacts: [] });
      return;
    }
    const contacts = await searchContacts(q);
    res.status(200).json({ contacts });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
