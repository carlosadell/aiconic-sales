# Book next call, in the toolkit lead card

## Goal

Let a sales rep book the lead's next call (Interview or Review) straight from the
lead card, no form, no re-typing. The card already knows the lead's GHL contact
ID; booking reuses it. No changes to any other panel or route.

## Stack context

This app is a plain static site (`public/*.html/js/css`, zero build step, zero
npm dependencies) plus Vercel serverless functions (`api/*.js`, CommonJS). There
is no framework, no component library, no date library. Everything here matches
that: vanilla JS/CSS, no new dependency.

## Calendar IDs

Hardcoded in `lib/ghl.js`, the same override pattern as `PIPELINE_ID`:

```js
const INTERVIEW_CALENDAR_ID = process.env.GHL_INTERVIEW_CALENDAR_ID || "oyKtsCQY2OlFKGS6z0YD";
const REVIEW_CALENDAR_ID = process.env.GHL_REVIEW_CALENDAR_ID || "EkNg9CbinOGLYq4LDtfP";
```

Both confirmed directly by the user from real booked appointments in GHL. No
Vercel env vars are added, changed, or read for this feature.

## GHL API version

Every existing call in `lib/ghl.js` sends `Version: 2021-07-28` via the shared
`headers()` helper. The calendar free-slots and create-appointment endpoints
require `Version: 2021-04-15` instead. `headers()` and `ghlFetch()` take an
optional `version` override (default stays `2021-07-28`), so only the two new
calendar calls pass `2021-04-15` and nothing else changes.

## `lib/ghl.js` additions

- `getFreeSlots(calendarId, dateStr, timezone)` — calls
  `GET /calendars/:calendarId/free-slots` with a generously padded
  `startDate`/`endDate` (the requested day ± 2 days, as epoch ms) and the
  `timezone` query param, then returns just `data[dateStr].slots` (an array of
  tz-aware ISO strings). Padding sidesteps fragile "start of day in an
  arbitrary IANA zone" math — GHL already buckets the response by calendar-local
  date for the given timezone, so we simply read the one date key we asked
  about.
- `createAppointment({ calendarId, contactId, startTime, timezone })` — calls
  `POST /calendars/events/appointments` with `calendarId, locationId,
  contactId, startTime, timezone, appointmentStatus: "confirmed"`. Explicitly
  confirming the appointment (rather than leaving GHL's `new` default) is
  required for the Leads Engine Funnel workflow's "Appointment confirmed"
  trigger to fire and move the lead's stage automatically, exactly as when a
  lead books themselves. No `assignedUserId` — the calendar owns who it's
  assigned to. `endTime`, `toNotify`, `ignoreFreeSlotValidation` are left at
  GHL's defaults (GHL computes duration from the calendar, sends its own
  confirmation, and re-validates the slot is still free).

Both use `ghlFetch()`, so they get the same retry/rate-limit handling as every
other call.

## New server routes

Same conventions as every existing route: `requireUser()` first, 400 for bad
input, 502 with `String(e.message||e)` for a GHL failure.

- **`GET /api/book-config`** → `{ interview: bool, review: bool }`, true when
  that calendar ID resolves to a non-empty string. Since both are hardcoded,
  this is normally always `{interview:true, review:true}`; it exists so a
  blank override env var still hides that option instead of breaking.
- **`GET /api/book-slots?callType=&date=&tz=`** → `{ slots: [...] }`. Validates
  `callType` is `interview`|`review` and that calendar is configured, `date` is
  `YYYY-MM-DD`, `tz` is a non-empty string. Resolves the calendar ID and calls
  `getFreeSlots`.
- **`POST /api/book-appointment`** `{contactId, callType, startTime,
  timezone}` → `{ ok: true, appointment }`. Validates the same as above plus
  `contactId`/`startTime`. Calls `createAppointment`, then best-effort calls
  `addNote(contactId, note, who.ghlUserId)` (wrapped in try/catch — a note
  failure must not undo a successful booking) with:

  `"{Interview|Review} booked from the sales toolkit by {who.name} ({who.email}) for {date and time formatted in the booked timezone}."`

  formatted with `new Date(startTime).toLocaleString("en-US", { timeZone,
  dateStyle: "full", timeStyle: "short" })` (native `Intl`, Node 18+, no
  dependency), same as the note left by `addNote`, `addTag`, `send-sms`, and
  `send-email` today.

No changes to `api/leads.js` — `l.timezone` (contact's GHL timezone, or the
existing appointment's timezone when there is one) and `l.contactId` already
reach the browser and are sufficient.

## Frontend

New `bookCallBlock(l)` in `public/app.js`, wired into `openSheet()` right after
`prepBlock(l)` — an early, prominent numbered section (`.dohead` auto-numbers).
Follows the sheet's existing delegated-click/`data-act` pattern; new act cases
handle the toggle, day/tz/slot changes, and the arm-then-confirm `Book` button
(same double-tap pattern as `tag`/`sms`/`email`).

1. **Call type toggle** — two buttons styled like the existing `.tab`/`.tab.on`
   toggle. Backed by `/api/book-config` (fetched once per page load and
   cached, same idea as `SEND_DOMAIN`). A calendar that isn't configured shows
   its button disabled with a short `.hint` note instead of disappearing.
2. **Time zone selector** — a small custom searchable combobox (text input +
   filtered list, plain JS, no library), populated from
   `Intl.supportedValuesOf('timeZone')`. Defaults to `l.timezone` if present,
   else `Intl.DateTimeFormat().resolvedOptions().timeZone` (rep's browser).
3. **Day + slot picker** — native `<input type="date">`, `min` = today. On
   change (or on time zone / call type change), fetches `/api/book-slots` and
   renders the returned slots as a button grid, each formatted in the selected
   time zone (e.g. "9:00 AM"), reusing the `.pbtn` visual style for the
   selected slot.
4. **Confirm** — "Book" arms then confirms (`data-armed` + 4s timeout, same as
   the tag buttons), then calls `/api/book-appointment`. On success, the panel
   is replaced by a confirmation card showing the booked date, time, and time
   zone, plus a "Book another call" button that resets the panel back to step
   1. On failure, the exact `error` string from the response is shown inline
   (no swallowed errors), the panel stays interactive, and nothing is
   disabled.

## Out of scope / explicitly not touched

- No new npm dependency, no framework.
- No Vercel environment variable is added, removed, or read.
- No change to `api/leads.js`, the lead object shape, or any other panel.
- No change to who a booked appointment is assigned to — the calendar decides.

## Manual verification before merge

Per the user: test one real booking on a test contact on the preview deploy
before merging, and confirm all three:

1. The appointment shows up in the GHL calendar.
2. GHL sends its own booking confirmation.
3. The Leads Engine Funnel workflow's "Appointment confirmed" trigger fires and
   moves the lead to Interview Booked (or Review Booked) on its own, exactly as
   when a lead books themselves.

If the stage does not move automatically, stop and report back before merging
— do not merge with a manual workaround.
