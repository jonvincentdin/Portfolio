const { readAuth, writeAuth } = require("../lib/blobStore");
const { hashPassword, verifyPassword } = require("../lib/passwordHash");
const { isAuthenticated, setSessionCookie, clearSessionCookie } = require("../lib/session");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const auth = await readAuth();
      res.status(200).json({
        hasPassword: !!(auth && auth.hash),
        authenticated: isAuthenticated(req),
      });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = req.body || {};
    const action = body.action;

    if (action === "setup") {
      const existing = await readAuth();
      if (existing && existing.hash) {
        res.status(409).json({ error: "A password is already set. Use login instead." });
        return;
      }
      const password = String(body.password || "");
      if (password.length < 4) {
        res.status(400).json({ error: "Use at least 4 characters." });
        return;
      }
      const { salt, hash } = hashPassword(password);
      await writeAuth({ salt, hash });
      setSessionCookie(res);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "login") {
      const auth = await readAuth();
      if (!auth || !auth.hash) {
        res.status(400).json({ error: "No password has been set up yet." });
        return;
      }
      const password = String(body.password || "");
      if (!verifyPassword(password, auth.salt, auth.hash)) {
        res.status(401).json({ error: "That password isn't right." });
        return;
      }
      setSessionCookie(res);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "change") {
      if (!isAuthenticated(req)) {
        res.status(401).json({ error: "Not authenticated." });
        return;
      }
      const auth = await readAuth();
      if (!auth || !auth.hash) {
        res.status(400).json({ error: "No password has been set up yet." });
        return;
      }
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      if (!verifyPassword(current, auth.salt, auth.hash)) {
        res.status(401).json({ error: "Current password is wrong." });
        return;
      }
      if (next.length < 4) {
        res.status(400).json({ error: "Use at least 4 characters." });
        return;
      }
      const { salt, hash } = hashPassword(next);
      await writeAuth({ salt, hash });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "logout") {
      clearSessionCookie(res);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error." });
  }
};
