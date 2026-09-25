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

// Remembers each person's name and CRM user id for a few minutes, so every
// click does not look them up in the CRM again. This is only the name lookup.
// The sign-in itself is checked with Supabase on every single call.
const NAMES = new Map();
const NAMES_MS = 10 * 60 * 1000;

// Returns { id, email, name, ghlUserId } or sends a 401/403 and returns null.
async function requireUser(req, res) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    res.status(401).json({ error: "Please sign in.", auth: true });
    return null;
  }
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
  const known = NAMES.get(email);
  if (known && known.until > Date.now()) {
    name = known.name; ghlUserId = known.ghlUserId;
  } else {
    try {
      const { getUserByEmail } = require("./ghl");
      const g = await getUserByEmail(email);
      if (g) { name = g.name; ghlUserId = g.id; }
    } catch (_) {}
    if (name) NAMES.set(email, { name, ghlUserId, until: Date.now() + NAMES_MS });
  }
  if (!name) {
    const local = email.split("@")[0].replace(/[._-]+/g, " ");
    name = local.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return { id: user.id, email, name, ghlUserId };
}

module.exports = { requireUser, allowedEmail, SUPABASE_URL, SUPABASE_ANON, ALLOWED_DOMAINS };
