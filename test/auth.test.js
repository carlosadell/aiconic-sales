const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.GHL_TOKEN = "test-token";
process.env.GHL_LOCATION_ID = "loc-test";
delete process.env.GHL_USER_MAP;
delete process.env.BLOCK_SHARED_LOGIN;

for (const key of Object.keys(require.cache)) {
  if (/\/lib\/(ghl|auth|user-map)\.js$/.test(key)) delete require.cache[key];
}

const { requireUser, clearUserCache, SHARED_LOGIN_MESSAGE } = require("../lib/auth");
const policy = require("../api/auth-policy");

const USERS = [
  { id: "SLnpGBz1NsZ239besXTI", name: "Josiah Six", email: "josiah@aiconichub.ai" },
  { id: "MUNKZmhGJSUuuvPln2EW", name: "John Bryan", email: "john@iconicbusinesshub.com" },
  { id: "AOUCbDCIibDz2Xu7d1lE", name: "Carlos Adell", email: "carlos@carlosadellonline.com" },
  { id: "aETdHBWw2pDStHdGyfSt", name: "Hello Aiconic", email: "hello@aiconichub.ai" },
];

let usersStatus = 200;
const realFetch = global.fetch;

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function res() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {},
  };
}

before(() => {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      const token = String((opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || "");
      const email = token.replace(/^Bearer\s+/i, "").trim();
      if (!email || email === "bad") return json(401, {});
      return json(200, { id: "sb-" + email, email, email_confirmed_at: "2026-01-01T00:00:00Z" });
    }
    if (u.includes("/users/")) {
      if (usersStatus !== 200) return json(usersStatus, { message: "down" });
      return json(200, { users: USERS });
    }
    return realFetch(url, opts);
  };
});

after(() => {
  global.fetch = realFetch;
  delete process.env.BLOCK_SHARED_LOGIN;
  delete process.env.GHL_USER_MAP;
});

beforeEach(() => {
  clearUserCache();
  usersStatus = 200;
  delete process.env.BLOCK_SHARED_LOGIN;
  delete process.env.GHL_USER_MAP;
});

function req(email) {
  return { headers: { authorization: "Bearer " + email } };
}

test("a mapped Aiconic email is linked to that GHL user id and name", async () => {
  const out = res();
  const who = await requireUser(req("john@aiconichub.ai"), out);
  assert.equal(out.statusCode, 0);
  assert.equal(who.ghlUserId, "MUNKZmhGJSUuuvPln2EW");
  assert.equal(who.name, "John Bryan");
  assert.equal(who.email, "john@aiconichub.ai");
});

test("an email that already matches a GHL user still resolves when it is not in the map", async () => {
  const who = await requireUser(req("hello@aiconichub.ai"), res());
  assert.equal(who.ghlUserId, "aETdHBWw2pDStHdGyfSt");
  assert.equal(who.name, "Hello Aiconic");
});

test("the shared login still works until the switch is on, and is not linked to a GHL user", async () => {
  const who = await requireUser(req("contact@aiconichub.ai"), res());
  assert.equal(who.email, "contact@aiconichub.ai");
  assert.equal(who.ghlUserId, "");
  assert.equal(who.name, "Contact");
});

test("the shared login is refused once BLOCK_SHARED_LOGIN is on", async () => {
  process.env.BLOCK_SHARED_LOGIN = "1";
  const out = res();
  const who = await requireUser(req("contact@aiconichub.ai"), out);
  assert.equal(who, null);
  assert.equal(out.statusCode, 403);
  assert.match(out.body.error, /retired/);
  assert.equal(out.body.error, SHARED_LOGIN_MESSAGE);
});

test("a personal login still works while the shared login is blocked", async () => {
  process.env.BLOCK_SHARED_LOGIN = "1";
  const who = await requireUser(req("josiah@aiconichub.ai"), res());
  assert.equal(who.ghlUserId, "SLnpGBz1NsZ239besXTI");
  assert.equal(who.name, "Josiah Six");
});

test("when the user list is down, a mapped id is still used", async () => {
  usersStatus = 400;
  const who = await requireUser(req("carlos@aiconichub.com"), res());
  assert.equal(who.ghlUserId, "AOUCbDCIibDz2Xu7d1lE");
  assert.equal(who.name, "Carlos");
});

test("an override id replaces the built-in one", async () => {
  process.env.GHL_USER_MAP = "john@aiconichub.ai:OVERRIDEID";
  const who = await requireUser(req("john@aiconichub.ai"), res());
  assert.equal(who.ghlUserId, "OVERRIDEID");
  assert.equal(who.name, "John");
});

test("auth policy reports the switch without requiring a session", async () => {
  const off = res();
  await policy({ method: "GET" }, off);
  assert.equal(off.statusCode, 200);
  assert.equal(off.body.blockSharedLogin, false);
  assert.equal(off.body.sharedLogin, "contact@aiconichub.ai");
  process.env.BLOCK_SHARED_LOGIN = "1";
  const on = res();
  await policy({ method: "GET" }, on);
  assert.equal(on.body.blockSharedLogin, true);
});
