// GoHighLevel API client.
// Reads live data for the reach-out list. All calls use the v2 API with a
// Private Integration token held on the server (never sent to the browser).

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

const TOKEN = process.env.GHL_TOKEN;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
// Free Trial Funnels pipeline by default. Override with an env var if it changes.
const PIPELINE_ID = process.env.GHL_PIPELINE_ID || "5BuQSSclHrkgv7OW99od";

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Version: VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function ghlFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GHL ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Small concurrency limiter so we do not fire 100 requests at once and hit rate limits.
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

// All open opportunities in the pipeline. Handles paging.
async function searchOpportunities() {
  const all = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({
      location_id: LOCATION_ID,
      pipeline_id: PIPELINE_ID,
      status: "open",
      getCalendarEvents: "true",
      limit: "100",
      page: String(page),
    });
    const data = await ghlFetch(`/opportunities/search?${params.toString()}`);
    const batch = data?.opportunities || data?.data?.opportunities || [];
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
    if (page > 20) break;
  }
  return all;
}

// Users on the location, so we can turn an assigned-user id into a real name.
async function getUsers() {
  try {
    const params = new URLSearchParams({ locationId: LOCATION_ID });
    const data = await ghlFetch(`/users/?${params.toString()}`);
    const users = data?.users || data?.data || [];
    const map = {};
    for (const u of users) {
      map[u.id] = u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id;
    }
    return map;
  } catch (e) {
    return {};
  }
}

// A single contact, for the email deliverability flag and to confirm the phone.
async function getContact(contactId) {
  const data = await ghlFetch(`/contacts/${contactId}`);
  return data?.contact || data;
}

// Turn an HTML-ish email body into a short plain snippet.
function snippet(body, max = 240) {
  if (!body) return "";
  let t = String(body)
    .replace(/\[[^\]]*\]/g, " ")      // drop [links]
    .replace(/<[^>]*>/g, " ")         // drop any tags
    .replace(/https?:\/\/\S+/g, " ")  // drop bare urls
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max).trim() + "..." : t;
}

// Pull the lead's own reschedule link out of a booking email body, if present.
function findRescheduleLink(body) {
  if (!body) return null;
  const m = String(body).match(/https:\/\/links\.aiconichub\.ai\/widget\/booking\/[A-Za-z0-9]+(?:\?event_id=[A-Za-z0-9]+)?/);
  return m ? m[0] : null;
}

// What GoHighLevel already sent this contact plus the booked appointment and
// the lead's reschedule link, so a rep has everything before reaching out.
// Returns { lastEmail, lastSms, appointment, rescheduleLink }.
async function getComms(contactId) {
  const params = new URLSearchParams({ locationId: LOCATION_ID, contactId });
  const conv = await ghlFetch(`/conversations/search?${params.toString()}`);
  const list = conv?.conversations || conv?.data?.conversations || [];
  if (!list.length) return { lastEmail: null, lastSms: null, appointment: null, rescheduleLink: null };
  const convId = list[0].id;
  const msgData = await ghlFetch(`/conversations/${convId}/messages?limit=40`);
  const msgs = msgData?.messages?.messages || msgData?.messages || [];

  const isEmail = (m) => m.messageType === "TYPE_EMAIL" || m.type === 3;
  const isSms = (m) => m.messageType === "TYPE_SMS" || m.type === 2;
  const isAppt = (m) => m.messageType === "TYPE_ACTIVITY_APPOINTMENT" || m.type === 31;

  const email = msgs.find((m) => isEmail(m) && m.direction === "outbound");
  const sms = msgs.find((m) => isSms(m) && m.direction === "outbound");
  const appt = msgs.find((m) => isAppt(m) && m.activity && m.activity.data);

  return {
    lastEmail: email
      ? {
          subject: (email.meta && email.meta.email && email.meta.email.subject) || "(no subject)",
          snippet: snippet(email.body),
          at: email.dateAdded || null,
        }
      : null,
    lastSms: sms
      ? {
          body: snippet(sms.body, 300),
          status: (sms.status || "").toLowerCase() || "sent",
          at: sms.dateAdded || null,
        }
      : null,
    appointment: appt
      ? {
          title: appt.activity.data.appointmentTitle || appt.body || "",
          at: appt.activity.data.timestamp || null,
        }
      : null,
    rescheduleLink: email ? findRescheduleLink(email.body) : null,
  };
}

// All notes on a contact, newest first, so a rep sees the call history.
async function getNotes(contactId) {
  const data = await ghlFetch(`/contacts/${contactId}/notes`);
  const notes = data?.notes || data?.data || [];
  return notes
    .map((n) => ({
      id: n.id,
      body: n.body || "",
      at: n.dateAdded || n.createdAt || null,
    }))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

// Add a note to a contact, so a rep can log a call without opening the CRM.
// userId attributes the note to the salesperson when we have a real id.
async function addNote(contactId, body, userId) {
  const payload = { body: String(body || "") };
  if (userId && userId !== "unassigned") payload.userId = userId;
  const data = await ghlFetch(`/contacts/${contactId}/notes`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const n = data?.note || data;
  return { id: n && n.id, body: (n && n.body) || payload.body, at: (n && (n.dateAdded || n.createdAt)) || null };
}

module.exports = {
  PIPELINE_ID,
  LOCATION_ID,
  searchOpportunities,
  getUsers,
  getContact,
  getComms,
  getNotes,
  addNote,
  mapLimit,
};
