// POST /api/update-stage   body: { opportunityId, pipelineStageId }
// Moves a deal to a new stage in GoHighLevel, so a rep never has to open the CRM.
// The token stays on the server.

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";
const PIPELINE_ID = process.env.GHL_PIPELINE_ID || "5BuQSSclHrkgv7OW99od";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!process.env.GHL_TOKEN) {
    res.status(500).json({ error: "Server is missing GHL_TOKEN." });
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
  const { opportunityId, pipelineStageId } = body;
  if (!opportunityId || !pipelineStageId) {
    res.status(400).json({ error: "opportunityId and pipelineStageId are required." });
    return;
  }

  try {
    const r = await fetch(`${BASE}/opportunities/${opportunityId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.GHL_TOKEN}`,
        Version: VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pipelineId: PIPELINE_ID, pipelineStageId }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(502).json({ error: data.message || `GHL ${r.status}` });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
