const { list } = require("@vercel/blob");
const { isAuthenticated } = require("../lib/session");

// Lists everything under uploads/ so the editor can reuse a file already
// uploaded somewhere else instead of uploading a duplicate copy. This is
// what makes multiple Profiles (or just multiple entries) share the same
// underlying photo/file instead of each one silently creating its own copy.
// Owner-only: this enumerates every upload at once, which is more exposure
// than any single already-public file URL on its own.
module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    if (!isAuthenticated(req)) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    const items = [];
    let cursor;
    do {
      const result = await list({ prefix: "uploads/", cursor, limit: 200 });
      items.push(...result.blobs);
      cursor = result.cursor;
    } while (cursor);

    items.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.status(200).json({
      items: items.map((b) => ({
        url: b.url,
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt,
        contentType: b.contentType || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error." });
  }
};
