const { put } = require("@vercel/blob");
const crypto = require("crypto");
const { isAuthenticated } = require("../lib/session");

// Vercel serverless functions have a request body size limit (4.5MB on the
// default plan). Since the body here is base64 (~33% larger than the raw
// file), keep an eye on that ceiling for larger uploads.
const MAX_BODY_BYTES = 4.4 * 1024 * 1024;

function sanitizeFilename(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 100) || "file";
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    if (!isAuthenticated(req)) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    const body = req.body || {};
    const { filename, contentType, dataBase64 } = body;
    if (!dataBase64) {
      res.status(400).json({ error: "No file data provided." });
      return;
    }
    if (dataBase64.length > MAX_BODY_BYTES) {
      res.status(413).json({
        error: "That file is too large. Keep uploads under roughly 3MB, or paste an external link instead.",
      });
      return;
    }

    const buffer = Buffer.from(dataBase64, "base64");
    const safeName = sanitizeFilename(filename);
    const pathname = `uploads/${crypto.randomUUID()}-${safeName}`;

    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: contentType || "application/octet-stream",
      addRandomSuffix: false,
    });

    res.status(200).json({ url: blob.url });
  } catch (err) {
    res.status(500).json({ error: err.message || "Upload failed." });
  }
};
