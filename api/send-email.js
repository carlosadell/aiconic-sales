// POST /api/send-email   body: { contactId, subject, body, repName }
// Sends an email to the lead through GoHighLevel, from the rep's own name on
// our GHL sending domain (for example "Maria Cruz <maria@DOMAIN>"). The email
// and any reply land in the contact's conversation in the CRM. The token stays
// on the server.

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";
// The sending domain is read live from the GHL custom value "Sending Domain
// Only", so changing it in GHL changes it here. If that read fails, this is
// the fallback.
const FALLBACK_DOMAIN = "contact.aiconichub.com";
async function sendingDomain(headers) {
  try {
    const loc = process.env.GHL_LOCATION_ID;
    if (!loc) return FALLBACK_DOMAIN;
    const r = await fetch(`${BASE}/locations/${loc}/customValues`, { headers });
    if (!r.ok) return FALLBACK_DOMAIN;
    const d = await r.json();
    const cv = (d.customValues || []).find((c) => /sending_domain_only/.test(c.fieldKey || "") || /^sending domain only$/i.test(c.name || ""));
    const v = cv && String(cv.value || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return v || FALLBACK_DOMAIN;
  } catch (_) {
    return FALLBACK_DOMAIN;
  }
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Plain text from the card to simple HTML: paragraphs kept, links clickable.
function toHtml(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => "<p>" + esc(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>") + "</p>")
    .join("");
}
// "Maria Cruz" -> "maria". Falls back to "team" when there is no rep.
function localPart(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  const clean = first.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean || "team";
}

module.exports = async (req, res) => {
  if (!process.env.GHL_TOKEN) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN." });
    return;
  }
  const headers = {
    Authorization: `Bearer ${process.env.GHL_TOKEN}`,
    Version: VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  // GET returns the sending domain, so the lead card can show the real From address.
  if (req.method === "GET") {
    res.status(200).json({ domain: await sendingDomain(headers) });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  let body = req.body;
  if (!body || typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch (_) { body = {}; }
  }
  const { contactId, subject, repName } = body;
  const text = body.body;
  if (!contactId || !subject || !text) {
    res.status(400).json({ error: "contactId, subject and body are required." });
    return;
  }
  const rep = repName && !/unassigned/i.test(repName) ? String(repName).trim() : "Aiconic";
  const domain = await sendingDomain(headers);
  const emailFrom = `${rep} <${localPart(rep === "Aiconic" ? "" : rep)}@${domain}>`;

  try {
    const r = await fetch(`${BASE}/conversations/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "Email", contactId, subject, html: toHtml(text), emailFrom }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(502).json({ error: data.message || `GHL ${r.status}` });
      return;
    }
    res.status(200).json({ ok: true, from: emailFrom, messageId: data.messageId || data.id || null });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
