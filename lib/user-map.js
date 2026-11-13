// Toolkit sign-in email -> GoHighLevel user id.
//
// The note on a contact is linked by user id, not by name. Exact-email lookup
// in GHL remains the fallback for anyone not listed here. An entry in the
// GHL_USER_MAP env var overrides the same email in the list below, so a wrong
// id can be corrected without a code change:
//
//   GHL_USER_MAP=rj@aiconichub.ai:USERID,sheine@aiconichub.ai:OTHERID
//
// or a JSON object {"email":"userId"}.
//
// Ids below were read from the GHL users API on 13 Nov 2026 for the
// AIconic Business App sub-account. Do not replace them with a display name.

const SHARED_LOGIN = "contact@aiconichub.ai";

const DEFAULT_GHL_USERS = {
  // Josiah Six. GHL email is already josiah@aiconichub.ai, so email lookup
  // would also find him. The id is what the note is linked to.
  "josiah@aiconichub.ai": "SLnpGBz1NsZ239besXTI",
  // John Bryan. GHL email is john@iconicbusinesshub.com.
  "john@aiconichub.ai": "MUNKZmhGJSUuuvPln2EW",
  // Carlos Adell. GHL email is carlos@carlosadellonline.com.
  "carlos@aiconichub.com": "AOUCbDCIibDz2Xu7d1lE",
  // RJ Cabana. GHL email is rj@iconicbusinesshub.com. The toolkit address is
  // the Aiconic login he should create. If his real mailbox is different,
  // change this key (or set GHL_USER_MAP) before he signs up.
  "rj@aiconichub.ai": "sAkgrb2SCIg8AVNeLN29",
  // Sheine, the GHL user whose email is sheine@aiconichub.ai
  // ("Sheine Aiconic Team"). A second user, "Sheine Llanes BH"
  // (tm8L5XFeRy7rsYkFlq8A, sheine@iconicbusinesshub.com), also exists.
  // Set GHL_USER_MAP if notes should be linked to that older user instead.
  "sheine@aiconichub.ai": "4oMmmWRbGW6sTdLLS5IC",
};

function parseUserMap(raw) {
  const out = {};
  const text = String(raw || "").trim();
  if (!text) return out;
  let entries = [];
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        entries = Object.entries(obj);
      }
    } catch (_) {
      return out;
    }
  } else {
    entries = text.split(/[\n,]+/).map((part) => {
      const line = part.trim();
      if (!line || line.startsWith("#")) return null;
      const i = line.indexOf(":");
      if (i < 1) return null;
      return [line.slice(0, i), line.slice(i + 1)];
    }).filter(Boolean);
  }
  for (const [email, id] of entries) {
    const key = String(email || "").trim().toLowerCase();
    const userId = String(id || "").trim();
    if (!key || !userId || key.indexOf("@") < 1) continue;
    out[key] = userId;
  }
  return out;
}

// Env wins per email. The shared login is never mapped, so a note written
// while it is still allowed cannot be pinned to one person by accident.
function ghlUserMap() {
  return Object.assign({}, DEFAULT_GHL_USERS, parseUserMap(process.env.GHL_USER_MAP));
}

function ghlUserIdFor(email) {
  const key = String(email || "").trim().toLowerCase();
  if (!key || key === SHARED_LOGIN) return "";
  return ghlUserMap()[key] || "";
}

function isSharedLogin(email) {
  return String(email || "").trim().toLowerCase() === SHARED_LOGIN;
}

// Off until rollout is finished. Set BLOCK_SHARED_LOGIN=1 in production only
// after every person has signed in with their own email at least once.
function blockSharedLoginEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.BLOCK_SHARED_LOGIN || "").trim());
}

module.exports = {
  SHARED_LOGIN,
  DEFAULT_GHL_USERS,
  parseUserMap,
  ghlUserMap,
  ghlUserIdFor,
  isSharedLogin,
  blockSharedLoginEnabled,
};
