const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_GHL_USERS,
  SHARED_LOGIN,
  parseUserMap,
  ghlUserIdFor,
  isSharedLogin,
  blockSharedLoginEnabled,
} = require("../lib/user-map");

test("verified toolkit emails map to GHL user ids", () => {
  assert.equal(ghlUserIdFor("josiah@aiconichub.ai"), "SLnpGBz1NsZ239besXTI");
  assert.equal(ghlUserIdFor("John@aiconichub.ai"), "MUNKZmhGJSUuuvPln2EW");
  assert.equal(ghlUserIdFor("carlos@aiconichub.com"), "AOUCbDCIibDz2Xu7d1lE");
  assert.equal(ghlUserIdFor("rj@aiconichub.ai"), "sAkgrb2SCIg8AVNeLN29");
  assert.equal(ghlUserIdFor("sheine@aiconichub.ai"), "4oMmmWRbGW6sTdLLS5IC");
});

test("an unknown email has no mapped id", () => {
  assert.equal(ghlUserIdFor("someone@aiconichub.ai"), "");
});

test("the shared login is never mapped, even from the env override", () => {
  const prev = process.env.GHL_USER_MAP;
  process.env.GHL_USER_MAP = `${SHARED_LOGIN}:AOUCbDCIibDz2Xu7d1lE`;
  try {
    assert.equal(ghlUserIdFor(SHARED_LOGIN), "");
    assert.equal(isSharedLogin(" Contact@aiconichub.ai "), true);
  } finally {
    if (prev === undefined) delete process.env.GHL_USER_MAP;
    else process.env.GHL_USER_MAP = prev;
  }
});

test("GHL_USER_MAP overrides one email and leaves the others", () => {
  const prev = process.env.GHL_USER_MAP;
  process.env.GHL_USER_MAP = "rj@aiconichub.ai:NEWID, extra@aiconichub.ai:EXTRA1";
  try {
    assert.equal(ghlUserIdFor("rj@aiconichub.ai"), "NEWID");
    assert.equal(ghlUserIdFor("john@aiconichub.ai"), DEFAULT_GHL_USERS["john@aiconichub.ai"]);
    assert.equal(ghlUserIdFor("extra@aiconichub.ai"), "EXTRA1");
  } finally {
    if (prev === undefined) delete process.env.GHL_USER_MAP;
    else process.env.GHL_USER_MAP = prev;
  }
});

test("GHL_USER_MAP accepts JSON", () => {
  assert.deepEqual(parseUserMap('{"rj@aiconichub.ai":"JSONID"}'), { "rj@aiconichub.ai": "JSONID" });
  assert.deepEqual(parseUserMap("{not json"), {});
});

test("BLOCK_SHARED_LOGIN is off unless explicitly turned on", () => {
  const prev = process.env.BLOCK_SHARED_LOGIN;
  try {
    delete process.env.BLOCK_SHARED_LOGIN;
    assert.equal(blockSharedLoginEnabled(), false);
    process.env.BLOCK_SHARED_LOGIN = "0";
    assert.equal(blockSharedLoginEnabled(), false);
    process.env.BLOCK_SHARED_LOGIN = "yes";
    assert.equal(blockSharedLoginEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.BLOCK_SHARED_LOGIN;
    else process.env.BLOCK_SHARED_LOGIN = prev;
  }
});
