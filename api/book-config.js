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
