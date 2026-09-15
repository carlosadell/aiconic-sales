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
  // GHL caps at 100 per page. Loop until a short page comes back.
  while (true) {
    const params = new URLSearchParams({
      location_id: LOCATION_ID,
      pipeline_id: PIPELINE_ID,
      status: "open",
      limit: "100",
      page: String(page),
    });
    const data = await ghlFetch(`/opportunities/search?${params.toString()}`);
    const batch = data?.opportunities || data?.data?.opportunities || [];
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
    if (page > 20) break; // hard stop, safety
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
    // If the token has no users scope we still work, just with ids.
    return {};
  }
}

// A single contact, used to read the email deliverability flag (a hard bounce
// flips dndSettings.Email to active) and confirm the phone number.
async function getContact(contactId) {
  const data = await ghlFetch(`/contacts/${contactId}`);
  return data?.contact || data;
}

// The most recent SMS in a contact's conversation, with its delivery status.
// Returns { attempted, status } where status is delivered / failed / undelivered / sent.
async function getSmsStatus(contactId) {
  const params = new URLSearchParams({ locationId: LOCATION_ID, contactId });
  const conv = await ghlFetch(`/conversations/search?${params.toString()}`);
  const list = conv?.conversations || conv?.data?.conversations || [];
  if (!list.length) return { attempted: false, status: null };
  const convId = list[0].id;
  const msgData = await ghlFetch(`/conversations/${convId}/messages?type=TYPE_SMS&limit=20`);
  const msgs = msgData?.messages?.messages || msgData?.messages || [];
  const sms = msgs.filter((m) => m.messageType === "TYPE_SMS" || m.type === 2);
  if (!sms.length) return { attempted: false, status: null };
  // messages come newest first
  const latest = sms[0];
  return { attempted: true, status: (latest.status || "").toLowerCase() || "unknown" };
}

module.exports = {
  PIPELINE_ID,
  LOCATION_ID,
  searchOpportunities,
  getUsers,
  getContact,
  getSmsStatus,
  mapLimit,
};
