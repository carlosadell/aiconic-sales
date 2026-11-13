const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("path");
const { DEFAULT_GHL_USERS, SHARED_LOGIN } = require("../lib/user-map");

test("the dry run lists personal logins and does not include the shared login", () => {
  const script = path.join(__dirname, "..", "scripts", "invite-toolkit-users.js");
  const run = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  for (const email of Object.keys(DEFAULT_GHL_USERS)) {
    assert.equal(run.stdout.includes(email), true, email);
  }
  assert.equal(run.stdout.includes("Invited "), false);
  assert.equal(Object.keys(DEFAULT_GHL_USERS).includes(SHARED_LOGIN), false);
});

test("sending without a service key fails and does not print a key", () => {
  const script = path.join(__dirname, "..", "scripts", "invite-toolkit-users.js");
  const run = spawnSync(process.execPath, [script, "--send"], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: "" },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(run.stdout.includes("Invited "), false);
});
