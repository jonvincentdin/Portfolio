const { readAuth, writeAuth } = require("../lib/blobStore");
const { hashPassword, verifyPassword, isLegacyHash } = require("../lib/passwordHash");
const { isAuthenticated, setSessionCookie, clearSessionCookie } = require("../lib/session");
const { generateCode, createChallenge, verifyChallenge, reissueChallenge } = require("../lib/otp");
const { sendEmail } = require("../lib/email");
const { isLocked, lockMessage, recordEvent, clearEvents } = require("../lib/rateLimit");

// Every login, password change, and first-time setup is confirmed with a
// 6-digit code emailed to the owner — this is a single-owner site, so this
// address is who "owns" it. Override with OWNER_EMAIL if you ever need to.
const OWNER_EMAIL = process.env.OWNER_EMAIL || "jonvincent.din@gmail.com";

async function sendCode(action, payload) {
  const code = generateCode();
  const token = createChallenge(action, payload, code);
  const verbs = { setup: "set up your", login: "unlock your", change: "change your" };
  await sendEmail({
    to: OWNER_EMAIL,
    subject: `Your verification code: ${code}`,
    text: `Use this code to ${verbs[action] || "confirm your"} portfolio edit password:\n\n${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`,
  });
  return token;
}

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
      const auth = (await readAuth()) || {};
      if (auth.hash) {
        res.status(409).json({ error: "A password is already set. Use login instead." });
        return;
      }
      const sendLock = isLocked(auth, "send");
      if (sendLock) {
        res.status(429).json({ error: lockMessage(sendLock) });
        return;
      }
      const password = String(body.password || "");
      if (password.length < 4) {
        res.status(400).json({ error: "Use at least 4 characters." });
        return;
      }
      const { salt, hash } = hashPassword(password);
      recordEvent(auth, "send", 8);
      await writeAuth(auth);
      let token;
      try {
        token = await sendCode("setup", { salt, hash });
      } catch (err) {
        res.status(500).json({ error: err.message || "Couldn't send the verification email." });
        return;
      }
      res.status(200).json({ ok: true, pending: true, token, ownerEmail: OWNER_EMAIL });
      return;
    }

    if (action === "login") {
      const auth = (await readAuth()) || {};
      if (!auth.hash) {
        res.status(400).json({ error: "No password has been set up yet." });
        return;
      }
      const pwLock = isLocked(auth, "pw");
      if (pwLock) {
        res.status(429).json({ error: lockMessage(pwLock) });
        return;
      }
      const password = String(body.password || "");
      if (!verifyPassword(password, auth.salt, auth.hash)) {
        const justLocked = recordEvent(auth, "pw", 5);
        await writeAuth(auth);
        res.status(401).json({ error: justLocked ? lockMessage(justLocked) : "That password isn't right." });
        return;
      }
      clearEvents(auth, "pw");
      // Transparently upgrade older, weaker password hashes on next login.
      let salt = auth.salt, hash = auth.hash;
      if (isLegacyHash(auth.hash)) {
        const upgraded = hashPassword(password);
        salt = upgraded.salt; hash = upgraded.hash;
      }
      const sendLock = isLocked(auth, "send");
      if (sendLock) {
        await writeAuth(auth);
        res.status(429).json({ error: lockMessage(sendLock) });
        return;
      }
      recordEvent(auth, "send", 8);
      auth.salt = salt; auth.hash = hash;
      await writeAuth(auth);
      let token;
      try {
        token = await sendCode("login", {});
      } catch (err) {
        res.status(500).json({ error: err.message || "Couldn't send the verification email." });
        return;
      }
      res.status(200).json({ ok: true, pending: true, token, ownerEmail: OWNER_EMAIL });
      return;
    }

    if (action === "change") {
      if (!isAuthenticated(req)) {
        res.status(401).json({ error: "Not authenticated." });
        return;
      }
      const auth = (await readAuth()) || {};
      if (!auth.hash) {
        res.status(400).json({ error: "No password has been set up yet." });
        return;
      }
      const pwLock = isLocked(auth, "pw");
      if (pwLock) {
        res.status(429).json({ error: lockMessage(pwLock) });
        return;
      }
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      if (!verifyPassword(current, auth.salt, auth.hash)) {
        const justLocked = recordEvent(auth, "pw", 5);
        await writeAuth(auth);
        res.status(401).json({ error: justLocked ? lockMessage(justLocked) : "Current password is wrong." });
        return;
      }
      if (next.length < 4) {
        res.status(400).json({ error: "Use at least 4 characters." });
        return;
      }
      clearEvents(auth, "pw");
      const sendLock = isLocked(auth, "send");
      if (sendLock) {
        await writeAuth(auth);
        res.status(429).json({ error: lockMessage(sendLock) });
        return;
      }
      recordEvent(auth, "send", 8);
      await writeAuth(auth);
      const { salt, hash } = hashPassword(next);
      let token;
      try {
        token = await sendCode("change", { salt, hash });
      } catch (err) {
        res.status(500).json({ error: err.message || "Couldn't send the verification email." });
        return;
      }
      res.status(200).json({ ok: true, pending: true, token, ownerEmail: OWNER_EMAIL });
      return;
    }

    if (action === "resend-code") {
      const auth = (await readAuth()) || {};
      const sendLock = isLocked(auth, "send");
      if (sendLock) {
        res.status(429).json({ error: lockMessage(sendLock) });
        return;
      }
      const reissued = reissueChallenge(String(body.token || ""));
      if (!reissued) {
        res.status(400).json({ error: "That request has expired. Start over." });
        return;
      }
      recordEvent(auth, "send", 8);
      await writeAuth(auth);
      try {
        await sendEmail({
          to: OWNER_EMAIL,
          subject: `Your verification code: ${reissued.code}`,
          text: `Use this code to confirm your portfolio edit password:\n\n${reissued.code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`,
        });
      } catch (err) {
        res.status(500).json({ error: err.message || "Couldn't send the verification email." });
        return;
      }
      res.status(200).json({ ok: true, token: reissued.token, ownerEmail: OWNER_EMAIL });
      return;
    }

    if (action === "verify-code") {
      const auth = (await readAuth()) || {};
      const codeLock = isLocked(auth, "code");
      if (codeLock) {
        res.status(429).json({ error: lockMessage(codeLock) });
        return;
      }
      const challenge = verifyChallenge(String(body.token || ""), String(body.code || ""));
      if (!challenge) {
        const justLocked = recordEvent(auth, "code", 6);
        await writeAuth(auth);
        res.status(401).json({ error: justLocked ? lockMessage(justLocked) : "That code is wrong or has expired." });
        return;
      }
      clearEvents(auth, "code");

      if (challenge.action === "setup") {
        auth.salt = challenge.payload.salt;
        auth.hash = challenge.payload.hash;
        await writeAuth(auth);
        setSessionCookie(res);
        res.status(200).json({ ok: true });
        return;
      }

      if (challenge.action === "login") {
        await writeAuth(auth);
        setSessionCookie(res);
        res.status(200).json({ ok: true });
        return;
      }

      if (challenge.action === "change") {
        if (!isAuthenticated(req)) {
          res.status(401).json({ error: "Your session expired — log in and try again." });
          return;
        }
        auth.salt = challenge.payload.salt;
        auth.hash = challenge.payload.hash;
        await writeAuth(auth);
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: "Unknown pending action." });
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
