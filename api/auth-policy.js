// GET /api/auth-policy
// Public, no secrets. Tells the sign-in page whether the shared login has
// been switched off, so the form can say so before a password is sent.

const { blockSharedLoginEnabled, SHARED_LOGIN } = require("../lib/user-map");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }
  res.status(200).json({
    blockSharedLogin: blockSharedLoginEnabled(),
    sharedLogin: SHARED_LOGIN,
  });
};
