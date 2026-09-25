// Sign-in check for every API call. The browser signs in with Supabase and
// sends its access token. Here we ask Supabase who that token belongs to, and
// only let Aiconic emails through. The URL and anon key are public by design.

const SUPABASE_URL = "https://unbednxvxdwozjtqzwgq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuYmVkbnh2eGR3b3pqdHF6d2dxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyOTg0NzEsImV4cCI6MjEwNTg3NDQ3MX0.OmYSRyx7-2qtwaw4zxygyQDTLZ5DpX1DZbuLrk15wP8";
const ALLOWED_DOMAINS = ["aiconichub.com", "aiconichub.ai"];

function allowedEmail(email) {
  const domain = String(email || "").trim().toLowerCase().split("@")[1] || "";
  return ALLOWED_DOMAINS.includes(domain);
}

// Remembers a checked sign-in for a few minutes, so every click does not wait
// on Supabase and the CRM again. Only kept while this server copy is warm.
const CACHE = new Map();
const CACHE_MS = 5 * 60 * 1000;

// Returns { id, email, name, ghlUserId } or sends a 401/403 and returns null.
async function requireUser(req, res) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    res.status(401).json({ error: "Please sign in.", auth: true });
    return null;
  }
  const hit = CACHE.get(token);
  if (hit && hit.until > Date.now()) return hit.who;
  let user = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    if (r.ok) user = await r.json();
  } catch (_) {}
  if (!user || !user.email) {
    res.status(401).json({ error: "Your session expired. Please sign in again.", auth: true });
    return null;
  }
  if (!allowedEmail(user.email)) {
    res.status(403).json({ error: "Use your Aiconic email to sign in.", auth: true });
    return null;
  }
  if (!user.email_confirmed_at && !user.confirmed_at) {
    res.status(403).json({ error: "Confirm your email first, then sign in.", auth: true });
    return null;
  }
  const email = String(user.email).toLowerCase();
  let name = "", ghlUserId = "";
  try {
    const { getUserByEmail } = require("./ghl");
    const g = await getUserByEmail(email);
    if (g) { name = g.name; ghlUserId = g.id; }
  } catch (_) {}
  if (!name) {
    const local = email.split("@")[0].replace(/[._-]+/g, " ");
    name = local.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const who = { id: user.id, email, name, ghlUserId };
  if (CACHE.size > 200) CACHE.clear();
  CACHE.set(token, { who, until: Date.now() + CACHE_MS });
  return who;
}

module.exports = { requireUser, allowedEmail, SUPABASE_URL, SUPABASE_ANON, ALLOWED_DOMAINS };
