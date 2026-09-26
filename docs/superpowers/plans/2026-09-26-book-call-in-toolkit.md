# Book next call in the toolkit lead card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a sales rep book a lead's next call (Interview or Review) straight from the toolkit lead card, using the contact ID the card already has, with no form re-entry.

**Architecture:** Two new pure functions in `lib/ghl.js` (`getFreeSlots`, `createAppointment`) plus a small `calendarIdFor` lookup, three new one-action Vercel functions in `api/` that mirror the existing `requireUser` + GHL-call + JSON-error convention, and one new vanilla-JS panel in `public/app.js` wired into the existing `openSheet()` render and the existing delegated `click`/`change` event listeners on `#sheet`.

**Tech Stack:** Plain Node.js CommonJS (Vercel serverless functions), vanilla browser JS/CSS. No new npm dependency. No test framework exists in this repo (`package.json` has none) — verification steps use `node --check` for syntax and small `node` scripts with a stubbed `global.fetch` / stubbed `require.cache` entry for `../lib/auth`, matching the level of rigor already in this codebase (zero automated tests anywhere else either).

## Global Constraints

- No new npm dependency, no framework. Match the existing zero-dependency, vanilla JS/CSS, CommonJS style exactly.
- No Vercel environment variable is added, removed, read, or otherwise touched for this feature.
- Calendar IDs are hardcoded in `lib/ghl.js` (not secrets), the same override pattern as `PIPELINE_ID`: `process.env.GHL_INTERVIEW_CALENDAR_ID || "oyKtsCQY2OlFKGS6z0YD"` and `process.env.GHL_REVIEW_CALENDAR_ID || "EkNg9CbinOGLYq4LDtfP"`.
- GHL calendar endpoints (`free-slots`, `calendars/events/appointments`) require `Version: 2021-04-15`. Every other existing GHL call keeps `Version: 2021-07-28` unchanged.
- `POST /calendars/events/appointments` must send `appointmentStatus: "confirmed"` explicitly, so the Leads Engine Funnel workflow's "Appointment confirmed" trigger fires and moves the lead's stage automatically.
- No `assignedUserId` is sent when creating the appointment — the calendar owns the assignment.
- After a successful booking, add a GHL contact note: `"{Interview|Review} booked from the sales toolkit by {name} ({email}) for {date and time in the booked time zone}."` — same mechanism as `addNote` used by tags/sends today. A note failure must never undo a successful booking.
- No change to `api/leads.js`, the lead object shape, or any other lead-card panel.
- Before merging, a real booking must be tested on the Vercel preview deploy against a test contact, confirming: (1) the appointment shows in the GHL calendar, (2) GHL's own confirmation goes out, (3) the Leads Engine Funnel workflow moves the lead to Interview/Review Booked automatically. If the stage does not move, stop and report before merging.

---

## File Structure

- **Modify `lib/ghl.js`** — add `CALENDAR_VERSION`, the two hardcoded calendar ID constants, an optional `version` parameter threaded through `headers()`/`ghlFetch()`, and three new functions: `calendarIdFor(callType)`, `getFreeSlots(calendarId, dateStr, timezone)`, `createAppointment({calendarId, contactId, startTime, timezone})`.
- **Create `api/book-config.js`** — `GET` → `{ interview, review }` booleans, so the panel knows which call types to offer.
- **Create `api/book-slots.js`** — `GET ?callType=&date=&tz=` → `{ slots: [...] }`.
- **Create `api/book-appointment.js`** — `POST {contactId, callType, startTime, timezone}` → `{ ok: true, appointment }`, plus the confirmation note.
- **Modify `public/styles.css`** — new classes for the panel: toggle buttons, the time-zone combobox, the date input, the slot grid, and the success card.
- **Modify `public/app.js`** — new `bookCallBlock`/`bookPanelHtml`/`initBookPanel`/`refreshSlots`/`renderTzList`/`renderBooked` functions, wired into `openSheet()`, plus five new `data-act` branches in the existing delegated `click` listener, one new branch in the existing delegated `change` listener, one new delegated `input` listener, one new capture-phase `focus` listener, and one new `document` `click` listener to close the time-zone dropdown.

---

### Task 1: `lib/ghl.js` — calendar version plumbing and calendar ID constants

**Files:**
- Modify: `lib/ghl.js:1-20` (the top of the file, through the `headers()` function) and `lib/ghl.js:31-36` (the `ghlFetch` signature and its one `fetch(...)` call)

**Interfaces:**
- Produces: `CALENDAR_VERSION` (string constant, not exported — internal use only), `calendarIdFor(callType)` → returns the calendar ID string for `"interview"` or `"review"`, or `null` for anything else or an unconfigured calendar. Exported from `lib/ghl.js`.
- Produces: `ghlFetch(path, opts, tries, version)` — existing function, now accepts an optional 4th `version` argument. All existing call sites (which pass 0–3 args) are unaffected.

- [ ] **Step 1: Edit the top of `lib/ghl.js`**

Replace:

```js
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
```

with:

```js
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
```

- [ ] **Step 2: Thread the optional `version` through `ghlFetch`**

Find:

```js
async function ghlFetch(path, opts = {}, tries = 4) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, { ...opts, headers: headers() });
```

Replace with:

```js
async function ghlFetch(path, opts = {}, tries = 4, version) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, { ...opts, headers: headers(version) });
```

- [ ] **Step 3: Export `calendarIdFor`**

Find the `module.exports` block at the bottom of the file and add `calendarIdFor,` to it (any position in the list is fine, e.g. right after `addTag,`).

- [ ] **Step 4: Syntax check**

Run: `node --check lib/ghl.js`
Expected: no output (exit code 0).

- [ ] **Step 5: Behavior check**

Run from the repo root:

```bash
node <<'NODE'
const assert = require("assert");
const g = require("./lib/ghl");
assert.strictEqual(g.calendarIdFor("interview"), "oyKtsCQY2OlFKGS6z0YD");
assert.strictEqual(g.calendarIdFor("review"), "EkNg9CbinOGLYq4LDtfP");
assert.strictEqual(g.calendarIdFor("nope"), null);
assert.strictEqual(g.calendarIdFor(""), null);
console.log("Task 1 OK");
NODE
```

Expected: prints `Task 1 OK` with no assertion errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ghl.js
git commit -m "Add calendar IDs and a per-call GHL API version override"
```

---

### Task 2: `lib/ghl.js` — `getFreeSlots` and `createAppointment`

**Files:**
- Modify: `lib/ghl.js` (add two new functions near `getContact`/`addNote`, and export both)

**Interfaces:**
- Consumes: `ghlFetch(path, opts, tries, version)` and `CALENDAR_VERSION` from Task 1; `LOCATION_ID` (already defined in this file).
- Produces: `getFreeSlots(calendarId, dateStr, timezone)` → `Promise<string[]>` (an array of tz-aware ISO start times for that one calendar-local day; `[]` if none). `createAppointment({ calendarId, contactId, startTime, timezone })` → `Promise<object>` (the raw GHL response). Both exported from `lib/ghl.js`, used by `api/book-slots.js` and `api/book-appointment.js` in later tasks.

- [ ] **Step 1: Add the two functions**

Add this block after the `addTag` function (right before the `// Search any contact...` comment) in `lib/ghl.js`:

```js
// Open slots for one calendar, on one calendar-local day, in the given time
// zone. GHL's response is keyed by date in the requested timezone, so instead
// of computing a day's UTC start/end boundaries for an arbitrary IANA zone by
// hand, we ask for a generously padded range and just read the one date key
// we actually wanted.
async function getFreeSlots(calendarId, dateStr, timezone) {
  const base = Date.parse(`${dateStr}T00:00:00Z`);
  const pad = 2 * 24 * 3600 * 1000;
  const params = new URLSearchParams({
    startDate: String(base - pad),
    endDate: String(base + pad),
  });
  if (timezone) params.set("timezone", timezone);
  const data = await ghlFetch(`/calendars/${calendarId}/free-slots?${params.toString()}`, {}, 4, CALENDAR_VERSION);
  const day = data && data[dateStr];
  return (day && day.slots) || [];
}

// Books the slot and confirms it immediately (appointmentStatus: "confirmed"),
// so the Leads Engine Funnel workflow's "Appointment confirmed" trigger fires
// and moves the lead's stage on its own, exactly as when a lead books
// themselves. No assignedUserId: the calendar decides who it is assigned to.
async function createAppointment({ calendarId, contactId, startTime, timezone }) {
  const payload = {
    calendarId,
    locationId: LOCATION_ID,
    contactId,
    startTime,
    timezone,
    appointmentStatus: "confirmed",
  };
  const data = await ghlFetch(`/calendars/events/appointments`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, 4, CALENDAR_VERSION);
  return data;
}
```

- [ ] **Step 2: Export both**

Add `getFreeSlots,` and `createAppointment,` to the `module.exports` block.

- [ ] **Step 3: Syntax check**

Run: `node --check lib/ghl.js`
Expected: no output.

- [ ] **Step 4: Behavior check — `getFreeSlots`**

Run from the repo root:

```bash
node <<'NODE'
const assert = require("assert");
global.fetch = async (url, opts) => {
  assert.ok(String(url).includes("/calendars/cal123/free-slots"), "hits the right calendar");
  assert.strictEqual(opts.headers.Version, "2021-04-15", "uses the calendar version");
  assert.ok(String(url).includes("timezone=America%2FNew_York"), "passes the timezone");
  return {
    ok: true,
    json: async () => ({
      "2026-09-29": { slots: ["2026-09-29T09:00:00-04:00"] },
      "2026-10-01": { slots: ["2026-10-01T09:00:00-04:00", "2026-10-01T11:00:00-04:00"] },
    }),
  };
};
const g = require("./lib/ghl");
g.getFreeSlots("cal123", "2026-10-01", "America/New_York").then((slots) => {
  assert.deepStrictEqual(slots, ["2026-10-01T09:00:00-04:00", "2026-10-01T11:00:00-04:00"]);
  console.log("getFreeSlots OK");
});
NODE
```

Expected: prints `getFreeSlots OK`.

- [ ] **Step 5: Behavior check — `createAppointment`**

Run from the repo root:

```bash
node <<'NODE'
const assert = require("assert");
global.fetch = async (url, opts) => {
  assert.ok(String(url).endsWith("/calendars/events/appointments"));
  assert.strictEqual(opts.headers.Version, "2021-04-15");
  const body = JSON.parse(opts.body);
  assert.strictEqual(body.calendarId, "cal123");
  assert.strictEqual(body.contactId, "contact1");
  assert.strictEqual(body.startTime, "2026-10-01T09:00:00-04:00");
  assert.strictEqual(body.timezone, "America/New_York");
  assert.strictEqual(body.appointmentStatus, "confirmed");
  assert.strictEqual(body.assignedUserId, undefined, "never sends assignedUserId");
  return { ok: true, json: async () => ({ id: "appt1", calendarId: "cal123" }) };
};
const g = require("./lib/ghl");
g.createAppointment({ calendarId: "cal123", contactId: "contact1", startTime: "2026-10-01T09:00:00-04:00", timezone: "America/New_York" }).then((r) => {
  assert.strictEqual(r.id, "appt1");
  console.log("createAppointment OK");
});
NODE
```

Expected: prints `createAppointment OK`.

- [ ] **Step 6: Commit**

```bash
git add lib/ghl.js
git commit -m "Add getFreeSlots and createAppointment to the GHL client"
```

---

### Task 3: `api/book-config.js`

**Files:**
- Create: `api/book-config.js`

**Interfaces:**
- Consumes: `requireUser` from `../lib/auth` (existing, unchanged), `calendarIdFor` from `../lib/ghl` (Task 1).
- Produces: an HTTP handler `module.exports = async (req, res) => {...}` returning `{ interview: boolean, review: boolean }` on `GET`.

- [ ] **Step 1: Write the file**

```js
// GET /api/book-config -> { interview: bool, review: bool }
// Tells the "Book next call" panel which calendars are configured, so it can
// hide an option instead of failing when one is missing.

const { requireUser } = require("../lib/auth");
const { calendarIdFor } = require("../lib/ghl");

module.exports = async (req, res) => {
  const who = await requireUser(req, res);
  if (!who) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    interview: Boolean(calendarIdFor("interview")),
    review: Boolean(calendarIdFor("review")),
  });
};
```

- [ ] **Step 2: Syntax check**

Run: `node --check api/book-config.js`
Expected: no output.

- [ ] **Step 3: Behavior check**

Run from the repo root:

```bash
node <<'NODE'
const assert = require("assert");
const path = require("path");
require.cache[path.resolve("lib/auth.js")] = {
  exports: { requireUser: async () => ({ id: "u1", email: "a@aiconichub.com", name: "A", ghlUserId: "" }) },
};
const handler = require("./api/book-config");
const req = { method: "GET" };
let statusCode, body;
const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { body = b; } };
handler(req, res).then(() => {
  assert.strictEqual(statusCode, 200);
  assert.deepStrictEqual(body, { interview: true, review: true });
  console.log("book-config OK");
});
NODE
```

Expected: prints `book-config OK`.

- [ ] **Step 4: Commit**

```bash
git add api/book-config.js
git commit -m "Add GET /api/book-config"
```

---

### Task 4: `api/book-slots.js`

**Files:**
- Create: `api/book-slots.js`

**Interfaces:**
- Consumes: `requireUser` from `../lib/auth`; `calendarIdFor`, `getFreeSlots` from `../lib/ghl` (Tasks 1–2).
- Produces: an HTTP handler returning `{ slots: string[] }` on `GET ?callType=&date=&tz=`, or `{ error }` with 400/405/500/502.

- [ ] **Step 1: Write the file**

```js
// GET /api/book-slots?callType=interview|review&date=YYYY-MM-DD&tz=America/New_York
// -> { slots: [ "2026-10-01T09:00:00-04:00", ... ] }
// Open slots for one calendar, one day, in the given time zone. This is the
// only place that calls GHL for this feature; the token never reaches the browser.

const { requireUser } = require("../lib/auth");
const { calendarIdFor, getFreeSlots } = require("../lib/ghl");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async (req, res) => {
  const who = await requireUser(req, res);
  if (!who) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  if (!process.env.GHL_TOKEN || !process.env.GHL_LOCATION_ID) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN or GHL_LOCATION_ID." });
    return;
  }

  const callType = (req.query && req.query.callType) || "";
  const date = (req.query && req.query.date) || "";
  const tz = (req.query && req.query.tz) || "";
  const calendarId = calendarIdFor(callType);

  if (!calendarId) {
    res.status(400).json({ error: "callType must be interview or review, and that calendar must be configured." });
    return;
  }
  if (!DATE_RE.test(date)) {
    res.status(400).json({ error: "date must be in YYYY-MM-DD form." });
    return;
  }
  if (!tz) {
    res.status(400).json({ error: "tz is required." });
    return;
  }

  try {
    const slots = await getFreeSlots(calendarId, date, tz);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ slots });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
```

- [ ] **Step 2: Syntax check**

Run: `node --check api/book-slots.js`
Expected: no output.

- [ ] **Step 3: Behavior check — happy path**

Run from the repo root:

```bash
node <<'NODE'
const assert = require("assert");
const path = require("path");
process.env.GHL_TOKEN = "t";
process.env.GHL_LOCATION_ID = "l";
require.cache[path.resolve("lib/auth.js")] = {
  exports: { requireUser: async () => ({ id: "u1", email: "a@aiconichub.com", name: "A", ghlUserId: "" }) },
};
global.fetch = async () => ({
  ok: true,
  json: async () => ({ "2026-10-01": { slots: ["2026-10-01T09:00:00-04:00"] } }),
});
const handler = require("./api/book-slots");
const req = { method: "GET", query: { callType: "interview", date: "2026-10-01", tz: "America/New_York" } };
let statusCode, body;
const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { body = b; } };
handler(req, res).then(() => {
  assert.strictEqual(statusCode, 200);
  assert.deepStrictEqual(body, { slots: ["2026-10-01T09:00:00-04:00"] });
  console.log("book-slots happy path OK");
});
NODE
```

Expected: prints `book-slots happy path OK`.

- [ ] **Step 4: Behavior check — bad callType returns 400**

Run from the repo root:

```bash
node <<'NODE'
const assert = require("assert");
const path = require("path");
process.env.GHL_TOKEN = "t";
process.env.GHL_LOCATION_ID = "l";
require.cache[path.resolve("lib/auth.js")] = {
  exports: { requireUser: async () => ({ id: "u1", email: "a@aiconichub.com", name: "A", ghlUserId: "" }) },
};
const handler = require("./api/book-slots");
const req = { method: "GET", query: { callType: "nonsense", date: "2026-10-01", tz: "America/New_York" } };
let statusCode, body;
const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { body = b; } };
handler(req, res).then(() => {
  assert.strictEqual(statusCode, 400);
  assert.ok(body.error);
  console.log("book-slots bad callType OK");
});
NODE
```

Expected: prints `book-slots bad callType OK`.

- [ ] **Step 5: Commit**

```bash
git add api/book-slots.js
git commit -m "Add GET /api/book-slots"
```

---

### Task 5: `api/book-appointment.js`

**Files:**
- Create: `api/book-appointment.js`

**Interfaces:**
- Consumes: `requireUser` from `../lib/auth`; `calendarIdFor`, `createAppointment`, `addNote` from `../lib/ghl`.
- Produces: an HTTP handler returning `{ ok: true, appointment }` on `POST {contactId, callType, startTime, timezone}`, or `{ error }` with 400/405/500/502.

- [ ] **Step 1: Write the file**

```js
// POST /api/book-appointment {contactId, callType, startTime, timezone}
// -> { ok: true, appointment }
// Books the slot on the resolved calendar, confirms it immediately, and logs
// a note on the contact so the CRM shows who booked it and when.

const { requireUser } = require("../lib/auth");
const { calendarIdFor, createAppointment, addNote } = require("../lib/ghl");

const LABEL = { interview: "Interview", review: "Review" };

module.exports = async (req, res) => {
  const who = await requireUser(req, res);
  if (!who) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!process.env.GHL_TOKEN || !process.env.GHL_LOCATION_ID) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN or GHL_LOCATION_ID." });
    return;
  }

  let body = req.body;
  if (!body || typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch (_) {
      body = {};
    }
  }
  const { contactId, callType, startTime, timezone } = body;
  const calendarId = calendarIdFor(callType);

  if (!contactId) {
    res.status(400).json({ error: "contactId is required." });
    return;
  }
  if (!calendarId) {
    res.status(400).json({ error: "callType must be interview or review, and that calendar must be configured." });
    return;
  }
  if (!startTime) {
    res.status(400).json({ error: "startTime is required." });
    return;
  }
  if (!timezone) {
    res.status(400).json({ error: "timezone is required." });
    return;
  }

  try {
    const appointment = await createAppointment({ calendarId, contactId, startTime, timezone });
    try {
      const when = new Date(startTime).toLocaleString("en-US", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "short",
      });
      const label = LABEL[callType] || "Call";
      await addNote(
        contactId,
        `${label} booked from the sales toolkit by ${who.name} (${who.email}) for ${when} (${timezone}).`,
        who.ghlUserId
      );
    } catch (_) {
      // The booking already succeeded; a note failure must not undo it.
    }
    res.status(200).json({ ok: true, appointment });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
```

- [ ] **Step 2: Syntax check**

Run: `node --check api/book-appointment.js`
Expected: no output.

- [ ] **Step 3: Behavior check — happy path, including the exact note text**

Run from the repo root:

```bash
node <<'NODE'
const assert = require("assert");
const path = require("path");
process.env.GHL_TOKEN = "t";
process.env.GHL_LOCATION_ID = "l";
require.cache[path.resolve("lib/auth.js")] = {
  exports: {
    requireUser: async () => ({ id: "u1", email: "carlos@theiconicceo.com", name: "Carlos Adell", ghlUserId: "ghlu1" }),
  },
};
let notedContactId, notedBody, notedUserId;
require.cache[path.resolve("lib/ghl.js")] = {
  exports: {
    calendarIdFor: (t) => (t === "interview" ? "cal123" : t === "review" ? "cal456" : null),
    createAppointment: async (args) => {
      assert.strictEqual(args.calendarId, "cal123");
      assert.strictEqual(args.contactId, "contact1");
      return { id: "appt1" };
    },
    addNote: async (contactId, body, userId) => {
      notedContactId = contactId; notedBody = body; notedUserId = userId;
      return { id: "note1" };
    },
  },
};
const handler = require("./api/book-appointment");
const req = {
  method: "POST",
  body: { contactId: "contact1", callType: "interview", startTime: "2026-10-01T09:00:00-04:00", timezone: "America/New_York" },
};
let statusCode, resBody;
const res = { status(c) { statusCode = c; return this; }, json(b) { resBody = b; } };
handler(req, res).then(() => {
  assert.strictEqual(statusCode, 200);
  assert.deepStrictEqual(resBody, { ok: true, appointment: { id: "appt1" } });
  assert.strictEqual(notedContactId, "contact1");
  assert.strictEqual(notedUserId, "ghlu1");
  const expectedWhen = new Date("2026-10-01T09:00:00-04:00").toLocaleString("en-US", {
    timeZone: "America/New_York", dateStyle: "full", timeStyle: "short",
  });
  const expected = `Interview booked from the sales toolkit by Carlos Adell (carlos@theiconicceo.com) for ${expectedWhen} (America/New_York).`;
  assert.strictEqual(notedBody, expected);
  console.log("book-appointment OK:", notedBody);
});
NODE
```

Expected: prints `book-appointment OK:` followed by the note text.

- [ ] **Step 4: Behavior check — a note failure does not fail the booking**

Run from the repo root:

```bash
node <<'NODE'
const assert = require("assert");
const path = require("path");
process.env.GHL_TOKEN = "t";
process.env.GHL_LOCATION_ID = "l";
require.cache[path.resolve("lib/auth.js")] = {
  exports: { requireUser: async () => ({ id: "u1", email: "a@aiconichub.com", name: "A", ghlUserId: "" }) },
};
require.cache[path.resolve("lib/ghl.js")] = {
  exports: {
    calendarIdFor: (t) => (t === "review" ? "cal456" : null),
    createAppointment: async () => ({ id: "appt2" }),
    addNote: async () => { throw new Error("note API down"); },
  },
};
const handler = require("./api/book-appointment");
const req = {
  method: "POST",
  body: { contactId: "contact2", callType: "review", startTime: "2026-10-02T10:00:00-04:00", timezone: "America/New_York" },
};
let statusCode, resBody;
const res = { status(c) { statusCode = c; return this; }, json(b) { resBody = b; } };
handler(req, res).then(() => {
  assert.strictEqual(statusCode, 200);
  assert.deepStrictEqual(resBody, { ok: true, appointment: { id: "appt2" } });
  console.log("book-appointment note-failure OK");
});
NODE
```

Expected: prints `book-appointment note-failure OK`.

- [ ] **Step 5: Commit**

```bash
git add api/book-appointment.js
git commit -m "Add POST /api/book-appointment"
```

---

### Task 6: `public/styles.css` — panel styles

**Files:**
- Modify: `public/styles.css` (append a new section)

**Interfaces:**
- Produces: CSS classes consumed by Task 7's HTML: `.bookbox`, `.booktoggle`, `.booktype` (+ `.on`, `:disabled`), `.bookrow`, `.bookrow .lbl`, `.tzbox`, `.tzinput`, `.tzlist` (+ `[hidden]`), `.tzopt` (+ `:hover`/`.hi`), `.dateinput`, `.slotgrid`, `.slotbtn` (+ `.on`), `.slotempty`, `.bookgo`, `.bookmsg` (+ `.bad`), `.bookdone`.

- [ ] **Step 1: Confirm none of these class names already exist**

Run: `grep -nE "\.(bookbox|booktoggle|booktype|bookrow|tzbox|tzinput|tzlist|tzopt|dateinput|slotgrid|slotbtn|slotempty|bookgo|bookmsg|bookdone)\b" public/styles.css`
Expected: no output (none exist yet).

- [ ] **Step 2: Append the new section**

Add this to the end of `public/styles.css`:

```css

/* ---- Book next call panel (Sep 2026) ---- */
.bookbox{background:#f7f9fc;border:1px solid var(--border);border-radius:16px;padding:18px 20px 20px;margin:4px 0 18px}
.booktoggle{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
.booktype{border:1px solid var(--border);background:#fff;color:var(--ink-2);font-family:inherit;font-weight:700;font-size:13.5px;padding:9px 16px;border-radius:10px;cursor:pointer}
.booktype:hover{border-color:#c8d5ec}
.booktype.on{background:var(--blue);border-color:var(--blue);color:#fff}
.booktype:disabled{cursor:default;opacity:.55}
.booktype:disabled:hover{border-color:var(--border)}
.bookrow{margin-bottom:14px}
.bookrow .lbl{display:block;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.tzbox{position:relative}
.tzinput{width:100%;font-family:inherit;font-size:14px;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 13px}
.tzinput:focus{outline:none;border-color:var(--blue)}
.tzlist{position:absolute;left:0;right:0;top:calc(100% + 4px);max-height:220px;overflow-y:auto;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 24px -10px rgba(16,24,40,.3);z-index:5}
.tzlist[hidden]{display:none}
.tzopt{display:block;width:100%;text-align:left;border:none;background:none;font-family:inherit;font-size:13.5px;color:var(--ink);padding:9px 13px;cursor:pointer}
.tzopt:hover,.tzopt.hi{background:var(--blue-soft)}
.dateinput{font-family:inherit;font-size:14px;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 13px}
.slotgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin-top:4px}
.slotbtn{border:1px solid var(--line);background:#fff;color:var(--ink);font-family:inherit;font-weight:700;font-size:13px;padding:9px 8px;border-radius:9px;cursor:pointer}
.slotbtn:hover{border-color:var(--blue)}
.slotbtn.on{background:var(--blue);border-color:var(--blue);color:#fff}
.slotempty{font-size:13px;color:var(--muted);padding:6px 2px}
.bookgo{margin-top:14px}
.bookmsg{font-size:13px;margin-top:10px}
.bookmsg.bad{color:var(--red-ink)}
.bookdone{background:var(--green-soft);border:1px solid #bfe6c9;color:var(--green-ink);border-radius:14px;padding:16px 18px;font-size:14px;line-height:1.6}
.bookdone b{color:var(--green-ink)}
@media (max-width:720px){.slotgrid{grid-template-columns:repeat(auto-fill,minmax(84px,1fr))}}
```

- [ ] **Step 3: Sanity-check brace balance**

Run: `node -e "const s=require('fs').readFileSync('public/styles.css','utf8'); const o=(s.match(/\{/g)||[]).length, c=(s.match(/\}/g)||[]).length; console.log(o,c); if(o!==c) process.exit(1)"`
Expected: prints two equal numbers and exits 0.

- [ ] **Step 4: Commit**

```bash
git add public/styles.css
git commit -m "Add styles for the book-next-call panel"
```

---

### Task 7: `public/app.js` — the "Book next call" panel

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `/api/book-config`, `/api/book-slots`, `/api/book-appointment` (Tasks 3–5); the existing `el()`, `esc()` helpers; the lead object's `l.contactId` and `l.timezone`.
- Produces: `bookCallBlock(l)` (used inside `openSheet`'s HTML string, same as `prepBlock(l)`), `initBookPanel(l)` (called after the sheet is inserted, same timing as `loadNotes`).

- [ ] **Step 1: Add the module-level state and helper functions**

Add this block right before the `function prepBlock(l){` line in `public/app.js`:

```js
// ---- Book next call ----
let CURRENT_LEAD = null;
let BOOK_CONFIG_PROMISE = null;
function loadBookConfig(){
  if(!BOOK_CONFIG_PROMISE){
    BOOK_CONFIG_PROMISE = fetch("/api/book-config",{cache:"no-store"})
      .then(r=>r.json())
      .catch(()=>({interview:false, review:false}));
  }
  return BOOK_CONFIG_PROMISE;
}
let TZ_NAMES = null;
function tzNames(){
  if(!TZ_NAMES){
    try{ TZ_NAMES = Intl.supportedValuesOf("timeZone"); }
    catch(_){ TZ_NAMES = ["UTC"]; }
  }
  return TZ_NAMES;
}
function defaultTz(l){
  if(l.timezone) return l.timezone;
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(_){ return "UTC"; }
}
function todayStr(){
  return new Date().toLocaleDateString("en-CA", {year:"numeric",month:"2-digit",day:"2-digit"});
}
function slotLabel(iso, tz){
  try{ return new Date(iso).toLocaleTimeString([], { hour:"numeric", minute:"2-digit", timeZone: tz }); }
  catch(_){ return new Date(iso).toLocaleTimeString(); }
}
function bookPanelHtml(l){
  return '<div class="bookbox" id="bookbox" data-contact="'+esc(l.contactId)+'" data-calltype="" data-tz="'+esc(defaultTz(l))+'" data-date="" data-slot="">'+
    '<div class="booktoggle" id="booktoggle"><span class="hint">Loading call types...</span></div>'+
    '<div class="bookrow"><span class="lbl">Customer time zone</span>'+
      '<div class="tzbox"><input type="text" class="tzinput" id="tzinput" value="'+esc(defaultTz(l))+'" autocomplete="off" placeholder="Search time zones...">'+
      '<div class="tzlist" id="tzlist" hidden></div></div></div>'+
    '<div class="bookrow"><span class="lbl">Day</span><input type="date" class="dateinput" id="bookdate" min="'+todayStr()+'"></div>'+
    '<div class="bookrow" id="bookslots"><span class="lbl">Open slots</span><div class="slotempty">Pick a call type and a day to see open slots.</div></div>'+
    '<div class="btnrow"><button type="button" class="btn solid bookgo" data-act="book" data-label="Book" disabled>Book</button></div>'+
    '<div class="bookmsg" id="bookmsg"></div>'+
  '</div>';
}
function bookCallBlock(l){
  return '<div class="dohead">Book next call</div>'+bookPanelHtml(l);
}
function renderTzList(query){
  const list = el("tzlist"); if(!list) return;
  const q = String(query||"").trim().toLowerCase();
  const names = tzNames().filter(n=>!q || n.toLowerCase().includes(q)).slice(0,60);
  if(!names.length){ list.innerHTML='<div class="slotempty">No match</div>'; list.hidden=false; return; }
  list.innerHTML = names.map(n=>'<button type="button" class="tzopt" data-act="tzpick" data-tz="'+esc(n)+'">'+esc(n.replace(/_/g," "))+'</button>').join("");
  list.hidden = false;
}
function refreshSlots(){
  const box = el("bookbox"); if(!box) return;
  const callType = box.dataset.calltype;
  const tz = box.dataset.tz;
  const date = box.dataset.date;
  const slotsBox = el("bookslots");
  const goBtn = box.querySelector(".bookgo");
  box.dataset.slot = "";
  if(goBtn) goBtn.disabled = true;
  if(!slotsBox) return;
  if(!callType || !date || !tz){
    slotsBox.innerHTML = '<span class="lbl">Open slots</span><div class="slotempty">Pick a call type and a day to see open slots.</div>';
    return;
  }
  slotsBox.innerHTML = '<span class="lbl">Open slots</span><div class="slotempty">Loading...</div>';
  const params = new URLSearchParams({ callType, date, tz });
  fetch("/api/book-slots?"+params.toString(),{cache:"no-store"})
    .then(r=>r.json().then(d=>({ok:r.ok, d})))
    .then(({ok,d})=>{
      if(!ok) throw new Error(d.error||"Could not load slots.");
      const slots = d.slots||[];
      if(!slots.length){ slotsBox.innerHTML='<span class="lbl">Open slots</span><div class="slotempty">No open slots that day.</div>'; return; }
      slotsBox.innerHTML = '<span class="lbl">Open slots</span><div class="slotgrid">'+
        slots.map(s=>'<button type="button" class="slotbtn" data-act="slotpick" data-slot="'+esc(s)+'">'+esc(slotLabel(s,tz))+'</button>').join("")+
        '</div>';
    })
    .catch(e=>{ slotsBox.innerHTML='<span class="lbl">Open slots</span><div class="slotempty">Could not load slots: '+esc(e.message)+'</div>'; });
}
function renderBooked(startTime, tz){
  const box = el("bookbox"); if(!box) return;
  const when = new Date(startTime).toLocaleString([], { dateStyle:"full", timeStyle:"short", timeZone: tz });
  box.innerHTML = '<div class="bookdone">Booked for <b>'+esc(when)+'</b> ('+esc(tz)+').</div>'+
    '<div class="btnrow"><button type="button" class="btn" data-act="bookagain">Book another call</button></div>';
}
function initBookPanel(){
  const wrap = el("booktoggle"); if(!wrap) return;
  loadBookConfig().then(cfg=>{
    const wrapNow = el("booktoggle"); if(!wrapNow) return;
    const opts = [
      {key:"interview", label:"Interview", ok:cfg.interview},
      {key:"review", label:"Review", ok:cfg.review},
    ];
    wrapNow.innerHTML = opts.map(o=>
      '<button type="button" class="booktype" data-act="booktype" data-type="'+o.key+'"'+(o.ok?"":" disabled")+'>'+o.label+'</button>'
    ).join("") + (opts.some(o=>!o.ok) ? '<span class="hint">'+opts.filter(o=>!o.ok).map(o=>o.label+" is not set up yet").join(", ")+'</span>' : "");
  });
}
```

- [ ] **Step 2: Wire `bookCallBlock` and `initBookPanel` into `openSheet`**

In `function openSheet(l, ctx){`, right after the line `const sheet = el("sheet");`, add:

```js
  CURRENT_LEAD = l;
```

Then find this line inside the `sheet.innerHTML =` template (it currently reads):

```js
      prepBlock(l)+
```

and change it to:

```js
      prepBlock(l)+
      bookCallBlock(l)+
```

Then find the line near the end of `openSheet`:

```js
  loadNotes(l.contactId);
```

and add a line right after it:

```js
  loadNotes(l.contactId);
  initBookPanel();
```

- [ ] **Step 3: Add the new `change` handling for the date input**

Find the existing delegated change listener:

```js
el("sheet").addEventListener("change", async (e)=>{
  const sel = e.target.closest(".stagesel"); if(!sel) return;
```

Replace with:

```js
el("sheet").addEventListener("change", async (e)=>{
  const dateInput = e.target.closest("#bookdate");
  if(dateInput){
    const box = el("bookbox");
    if(box){ box.dataset.date = dateInput.value; refreshSlots(); }
    return;
  }
  const sel = e.target.closest(".stagesel"); if(!sel) return;
```

(The rest of that listener is unchanged.)

- [ ] **Step 4: Add the time-zone `input`/`focus` listeners and the outside-click close**

Add this block right after the `el("sheet").addEventListener("change", ...)` block closes (i.e. right after its final `});`):

```js
el("sheet").addEventListener("input", (e)=>{
  const tzIn = e.target.closest("#tzinput");
  if(!tzIn) return;
  renderTzList(tzIn.value);
});
el("sheet").addEventListener("focus", (e)=>{
  const tzIn = e.target.closest && e.target.closest("#tzinput");
  if(!tzIn) return;
  renderTzList(tzIn.value);
}, true);
document.addEventListener("click", (e)=>{
  const list = el("tzlist"); if(!list || list.hidden) return;
  if(!e.target.closest(".tzbox")) list.hidden = true;
});
```

- [ ] **Step 5: Add the five new `click` branches**

Find the line `if(act==="close"){ closeSheet(); return; }` inside the existing delegated click listener, and add the following branches right after it (before the existing `if(act==="tag"){` branch):

```js
  if(act==="booktype"){
    if(b.disabled) return;
    const box = el("bookbox"); if(!box) return;
    box.dataset.calltype = b.dataset.type;
    box.querySelectorAll(".booktype").forEach(x=>x.classList.toggle("on", x===b));
    refreshSlots();
    return;
  }
  if(act==="tzpick"){
    const box = el("bookbox"); if(!box) return;
    box.dataset.tz = b.dataset.tz;
    const input = el("tzinput"); if(input) input.value = b.dataset.tz;
    const list = el("tzlist"); if(list) list.hidden = true;
    refreshSlots();
    return;
  }
  if(act==="slotpick"){
    const box = el("bookbox"); if(!box) return;
    box.dataset.slot = b.dataset.slot;
    box.querySelectorAll(".slotbtn").forEach(x=>x.classList.toggle("on", x===b));
    const goBtn = box.querySelector(".bookgo"); if(goBtn) goBtn.disabled = false;
    return;
  }
  if(act==="bookagain"){
    const box = el("bookbox"); if(!box || !CURRENT_LEAD) return;
    box.outerHTML = bookPanelHtml(CURRENT_LEAD);
    initBookPanel();
    return;
  }
  if(act==="book"){
    const box = el("bookbox"); if(!box) return;
    const contactId = box.dataset.contact, callType = box.dataset.calltype, tz = box.dataset.tz, slot = box.dataset.slot;
    if(!callType || !slot) return;
    if(!b.classList.contains("arm")){
      b.classList.add("arm"); b.textContent="Tap again to confirm";
      clearTimeout(b._t); b._t=setTimeout(()=>{ b.classList.remove("arm"); b.textContent=b.dataset.label||"Book"; },4000);
      return;
    }
    clearTimeout(b._t); b.classList.remove("arm");
    b.textContent="Booking..."; b.disabled=true;
    const msg = el("bookmsg");
    try{
      const r = await fetch("/api/book-appointment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId, callType, startTime:slot, timezone:tz})});
      const d = await r.json();
      if(r.ok && d.ok){ renderBooked(slot, tz); }
      else{ b.disabled=false; b.textContent=b.dataset.label||"Book"; if(msg){ msg.textContent="That did not go through: "+(d.error||"try again")+"."; msg.className="bookmsg bad"; } }
    }catch(e){ b.disabled=false; b.textContent=b.dataset.label||"Book"; if(msg){ msg.textContent="That did not go through, try again."; msg.className="bookmsg bad"; } }
    return;
  }
```

- [ ] **Step 6: Syntax check**

Run: `node --check public/app.js`
Expected: no output. (`--check` only parses; it does not execute the browser-only code, so `document`/`window`/`Intl.supportedValuesOf` references are safe to check this way.)

- [ ] **Step 7: Cross-check every new `data-act` has a matching branch**

Run: `grep -n 'data-act="\(booktype\|tzpick\|slotpick\|book\|bookagain\)"' public/app.js`
Expected: shows both the HTML-string occurrences (in `bookPanelHtml`/`renderTzList`/`refreshSlots`) and the `if(act===...)` branches — five distinct act names, each appearing at least twice (once where it's set as an attribute, once where it's handled).

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "Add the book-next-call panel to the lead card"
```

---

### Task 8: Push the branch and hand off for the required manual preview test

**Files:** none (git/deploy only)

**Interfaces:** none — this task produces a pushed branch and a request to the user, not code.

- [ ] **Step 1: Confirm all commits are on `book-call-in-toolkit` and the tree is clean**

Run: `git status --short && git log --oneline -8`
Expected: clean working tree (only the pre-existing untracked `public/favicon-final.png`, unrelated to this work, may still show), and the log shows this feature's commits on top of `main`.

- [ ] **Step 2: Push the branch**

Run: `git push -u origin book-call-in-toolkit`
Expected: push succeeds. This repo's GitHub remote is already connected to Vercel (per `README.md`'s deploy steps), so this push produces a preview deployment automatically — no Vercel CLI or dashboard action needed, and no environment variable is touched.

- [ ] **Step 3: Report to the user and stop before merging**

Do not merge this branch. Tell the user the branch is pushed and a preview deployment should appear on the PR/branch shortly, and ask them to do the manual test the spec requires, since it needs a real GHL login and dashboard access this session doesn't have:

1. On the preview deploy, open a test contact's lead card, book one real Interview or Review call through the new panel.
2. Confirm the appointment shows up in the GHL calendar.
3. Confirm GHL sends its own booking confirmation.
4. Confirm the Leads Engine Funnel workflow's "Appointment confirmed" trigger fires and moves the lead to Interview Booked (or Review Booked) automatically, exactly as when a lead books themselves.

If step 4 does not happen automatically, stop and report it — do not merge with a manual workaround in place of the automatic stage move.

---

## Self-Review

**Spec coverage:** call type toggle with hide-if-unconfigured (Task 3, Task 7 Step 1 `initBookPanel`) — covered. Time zone searchable dropdown defaulting to contact/browser tz (Task 7 Step 1) — covered. Day + slot picker via GHL free-slots server-side (Tasks 2, 4, Task 7 `refreshSlots`) — covered. Confirm/book via GHL create-appointment server-side, success/failure display, panel disabled until "Book another call" (Tasks 2, 5, Task 7 `renderBooked`/`bookagain`) — covered. Hardcoded calendar IDs confirmed by the user (Task 1) — covered. Calendar-specific API version (Task 1) — covered. `appointmentStatus: "confirmed"` (Task 2) — covered. Confirmation note text and author/email/time (Task 5) — covered. No Vercel env var touched (every task) — covered. Manual preview verification of the three GHL-side outcomes (Task 8) — covered.

**Placeholder scan:** no TBD/TODO; every step has literal code or an exact command.

**Type consistency:** `calendarIdFor`, `getFreeSlots`, `createAppointment` signatures match between their Task 1/2 definitions and their Task 4/5 call sites. `bookCallBlock`/`bookPanelHtml`/`initBookPanel`/`refreshSlots`/`renderTzList`/`renderBooked` names and call sites match between their Task 7 Step 1 definitions and Steps 2–5 usages. The `/api/book-config`, `/api/book-slots`, `/api/book-appointment` response shapes match between the server tasks (3–5) and the frontend fetch calls that read them (Task 7).
