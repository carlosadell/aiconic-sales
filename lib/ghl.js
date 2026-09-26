// GoHighLevel API client.
// Reads live data for the reach-out list. All calls use the v2 API with a
// Private Integration token held on the server (never sent to the browser).

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";
// The calendar free-slots and create-appointment endpoints require this
// version instead. Every other call in this file keeps using VERSION.
const CALENDAR_VERSION = "2021-04-15";

const TOKEN = process.env.GHL_TOKEN;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
// Free Trial Funnels pipeline by default. Override with an env var if it changes.
const PIPELINE_ID = process.env.GHL_PIPELINE_ID || "5BuQSSclHrkgv7OW99od";
// Interview and Review calendars for the "Book next call" panel on the lead
// card. Calendar IDs are not secrets, so they are hardcoded here the same way
// PIPELINE_ID is above. Both confirmed against real booked appointments in GHL.
const INTERVIEW_CALENDAR_ID = process.env.GHL_INTERVIEW_CALENDAR_ID || "oyKtsCQY2OlFKGS6z0YD";
const REVIEW_CALENDAR_ID = process.env.GHL_REVIEW_CALENDAR_ID || "EkNg9CbinOGLYq4LDtfP";

function headers(version) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Version: version || VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

// The calendar ID for a call type, or null if that call type is unknown or
// its calendar is not configured. Never exposes the calendar ID's raw source
// (env var vs. hardcoded default) — callers only see the resolved ID.
function calendarIdFor(callType) {
  if (callType === "interview") return INTERVIEW_CALENDAR_ID || null;
  if (callType === "review") return REVIEW_CALENDAR_ID || null;
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Fetch with retry. GoHighLevel rate limits bursts (429) and can return the odd
// 5xx or drop a connection. When that happens we wait and try again a few times,
// honoring Retry-After when GHL sends it. Only a real client error (a 4xx that is
// not 429) throws right away. This is what stops a rate-limited call from being
// read as "this lead has no messages".
async function ghlFetch(path, opts = {}, tries = 4, version) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, { ...opts, headers: headers(version) });
    } catch (e) {
      // Network drop or timeout, retry.
      lastErr = e;
      await sleep(350 * (attempt + 1));
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 450 * (attempt + 1);
      lastErr = new Error(`GHL ${res.status} on ${path}`);
      await sleep(wait);
      continue;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`GHL ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  throw lastErr || new Error(`GHL failed on ${path} after ${tries} tries`);
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

// The live pipeline definition from the CRM: the stages in order, with their
// ids, names and colors. Read live so the app always matches whatever stages
// exist in GoHighLevel right now, even after they are renamed or reordered.
// Returns [] on failure so the caller can fall back to the hard-coded list.
async function getPipeline() {
  try {
    const params = new URLSearchParams({ locationId: LOCATION_ID });
    const data = await ghlFetch(`/opportunities/pipelines?${params.toString()}`);
    const pipelines = data?.pipelines || data?.data?.pipelines || [];
    const p = pipelines.find((x) => x.id === PIPELINE_ID) || null;
    if (!p) return [];
    return (p.stages || [])
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((s) => ({ id: s.id, name: s.name, position: s.position, color: s.color || "" }));
  } catch (e) {
    return [];
  }
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

// Find a GHL user by email, so the toolkit knows the signed-in person's name
// and GHL user id. Returns { id, name } or null.
async function getUserByEmail(email) {
  const params = new URLSearchParams({ locationId: LOCATION_ID });
  const data = await ghlFetch(`/users/?${params.toString()}`);
  const users = data?.users || data?.data || [];
  const want = String(email || "").toLowerCase();
  const u = users.find((x) => String(x.email || "").toLowerCase() === want);
  if (!u) return null;
  return { id: u.id, name: u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email };
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

// Add a tag to a contact. This is how the sales toolkit moves a lead: the tag
// triggers the matching workflow in the CRM, which sets the stage and starts the
// right sequence. Reps never move stages by hand, so the wrong sequence cannot
// fire from a slip.
async function addTag(contactId, tag) {
  const data = await ghlFetch(`/contacts/${contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags: [String(tag)] }),
  });
  return data;
}


// Search any contact in the CRM by name, email or phone, for the
// "Message a contact" tab. Returns up to 20 matches.
async function searchContacts(q) {
  const params = new URLSearchParams({ locationId: LOCATION_ID, query: String(q || ""), limit: "20" });
  const data = await ghlFetch(`/contacts/?${params.toString()}`);
  const list = data?.contacts || data?.data?.contacts || [];
  return list.map(contactSummary);
}

function contactSummary(c) {
  const first = c.firstNameRaw || c.firstName || "";
  const last = c.lastNameRaw || c.lastName || "";
  const name = [first, last].filter(Boolean).join(" ").trim() || c.contactName || c.email || c.phone || "No name";
  return {
    id: c.id,
    name,
    firstName: first,
    email: c.email || "",
    phone: c.phone || "",
    company: c.companyName || "",
  };
}

// Email text for the thread: tags out, quoted older replies cut, kept short.
function emailText(html, max = 1200) {
  if (!html) return "";
  let t = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<blockquote[\s\S]*$/i, " ")
    .replace(/<div class="gmail_quote[\s\S]*$/i, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
  // Cut the quoted history that email clients add under a reply.
  t = t.split(/\n\s*On [^\n]{5,200}wrote:\s*\n?|\n\s*-{2,}\s*Original Message|\n\s*From: [^\n]+\n\s*Sent: /i)[0];
  t = t.split("\n").map((x) => x.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? t.slice(0, max).trim() + "..." : t;
}

// The recent texts and emails with one contact, both directions, oldest first.
// Email bodies are fetched one by one, so only the most recent emails get
// their full text.
async function getThread(contactId, max = 30) {
  const params = new URLSearchParams({ locationId: LOCATION_ID, contactId });
  const conv = await ghlFetch(`/conversations/search?${params.toString()}`);
  const convs = (conv?.conversations || conv?.data?.conversations || []).slice(0, 3);
  let msgs = [];
  for (const c of convs) {
    const d = await ghlFetch(`/conversations/${c.id}/messages?limit=60`);
    msgs.push(...(d?.messages?.messages || d?.messages || []));
  }
  const isEmail = (m) => m.messageType === "TYPE_EMAIL" || m.type === 3;
  const isSms = (m) => m.messageType === "TYPE_SMS" || m.type === 2;
  msgs = msgs
    .filter((m) => isEmail(m) || isSms(m))
    .sort((a, b) => String(a.dateAdded || "").localeCompare(String(b.dateAdded || "")))
    .slice(-max);

  const emails = msgs.filter(isEmail).slice(-12);
  const details = {};
  await mapLimit(emails, 4, async (m) => {
    const ids = (m.meta && m.meta.email && m.meta.email.messageIds) || [];
    const eid = ids[ids.length - 1] || m.id;
    try {
      const d = await ghlFetch(`/conversations/messages/email/${eid}`);
      details[m.id] = d?.emailMessage || d?.data || d;
    } catch (_) {}
  });

  return msgs.map((m) => {
    if (isSms(m)) {
      return {
        id: m.id,
        channel: "sms",
        direction: m.direction || "outbound",
        at: m.dateAdded || null,
        body: String(m.body || "").trim(),
        status: String(m.status || "").toLowerCase(),
      };
    }
    const e = details[m.id] || {};
    const meta = (m.meta && m.meta.email) || {};
    return {
      id: m.id,
      channel: "email",
      direction: e.direction || meta.direction || m.direction || "outbound",
      at: m.dateAdded || e.dateAdded || null,
      subject: e.subject || meta.subject || "(no subject)",
      from: e.from || "",
      body: emailText(e.body || m.body || ""),
      status: String(e.status || m.status || "").toLowerCase(),
    };
  });
}

module.exports = {
  searchContacts,
  getThread,
  contactSummary,
  PIPELINE_ID,
  LOCATION_ID,
  searchOpportunities,
  getPipeline,
  getUsers,
  getContact,
  getComms,
  getNotes,
  addNote,
  addTag,
  calendarIdFor,
  getUserByEmail,
  mapLimit,
};
