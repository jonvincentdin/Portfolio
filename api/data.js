const { readPortfolioData, writePortfolioData } = require("../lib/blobStore");
const { isAuthenticated } = require("../lib/session");
const defaultData = require("../data.json");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const data = await readPortfolioData();
      res.status(200).json(data || defaultData);
      return;
    }

    if (req.method === "POST") {
      if (!isAuthenticated(req)) {
        res.status(401).json({ error: "Not authenticated." });
        return;
      }
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Invalid data." });
        return;
      }
      await writePortfolioData(body);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error." });
  }
};
