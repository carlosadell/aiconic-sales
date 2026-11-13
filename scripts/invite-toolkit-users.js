#!/usr/bin/env node
// Sends a Supabase invite to each salesperson's own Aiconic email.
// They set their own password from the email. Nothing in this script prints
// a password or the service key.
//
// The toolkit already lets someone create their own account in the browser
// (see the sign-in page: "Create an account"). Use this only when you would
// rather send the invite yourself.
//
// You need the service_role key for the toolkit Supabase project
// (ref unbednxvxdwozjtqzwgq). It is not the anon key, and it is not in Vercel.
// In the Supabase dashboard: Project Settings, API, service_role.
// Do not paste the key into chat. Pass it as an environment variable.
//
// Dry run (prints the emails, sends nothing):
//   node scripts/invite-toolkit-users.js
//
// Send the invites:
//   SUPABASE_SERVICE_ROLE_KEY='…' node scripts/invite-toolkit-users.js --send
//
// Optional: TOOLKIT_URL defaults to https://aiconic-sales.vercel.app
// The invite link comes back to /?reset=1 so they can choose a password.

const { SUPABASE_URL } = require("../lib/auth");
const { DEFAULT_GHL_USERS, SHARED_LOGIN } = require("../lib/user-map");

const ORIGIN = process.env.TOOLKIT_URL || "https://aiconic-sales.vercel.app";
const send = process.argv.includes("--send");

const emails = Object.keys(DEFAULT_GHL_USERS)
  .map((e) => e.toLowerCase())
  .filter((e) => e !== SHARED_LOGIN)
  .sort();

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  if (!send) {
    console.log("Dry run. No emails will be sent. Pass --send to invite these accounts:");
    emails.forEach((e) => console.log("  " + e));
    console.log("");
    console.log("Each person can also do this themselves, with no script:");
    console.log("  1. Open " + ORIGIN);
    console.log("  2. Click Create an account.");
    console.log("  3. Use the email above and a password only they know (8 or more characters).");
    console.log("  4. Open the confirmation email and click the link.");
    console.log("  5. Sign in on the toolkit with that same email and password.");
    return;
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    fail(
      "SUPABASE_SERVICE_ROLE_KEY is not set, so no invite was sent.\n" +
      "Get it from the toolkit Supabase project (ref unbednxvxdwozjtqzwgq):\n" +
      "Project Settings, then API, then service_role. Pass it as an env var, not in chat."
    );
  }
  for (const email of emails) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, redirect_to: `${ORIGIN}/?reset=1` }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = body.msg || body.error_description || body.error || r.status;
      console.error("FAILED " + email + ": " + msg);
      continue;
    }
    console.log("Invited " + email);
  }
}

main().catch((e) => fail(String(e && e.message || e)));
