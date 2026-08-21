const { readAuth, writeAuth } = require("../lib/blobStore");
const { hashPassword, verifyPassword } = require("../lib/passwordHash");
const { isAuthenticated, setSessionCookie, clearSessionCookie } = require("../lib/session");
const { createChallenge, verifyChallenge } = require("../lib/challenge");
const { sendVerificationEmail } = require("../lib/email");

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const SETUP_REQUEST_COOLDOWN_MS = 60 * 1000; // 1 minute, so an unset site can't be email-bombed

function isLocked(auth) {
  return !!(auth && auth.lockUntil && Date.now() < auth.lockUntil);
}
function lockedResponse(res, auth) {
  const secondsLeft = Math.ceil((auth.lockUntil - Date.now()) / 1000);
  res.status(429).json({
    error: `Too many attempts. Try again in about ${Math.ceil(secondsLeft / 60)} minute(s).`,
  });
}
async function recordFailure(auth) {
  const failedAttempts = (auth && auth.failedAttempts ? auth.failedAttempts : 0) + 1;
  const next = Object.assign({}, auth, { failedAttempts });
  if (failedAttempts >= LOCKOUT_THRESHOLD) {
    next.lockUntil = Date.now() + LOCKOUT_MS;
  }
  await writeAuth(next);
  return next;
}
async function recordSuccess(auth) {
  const next = Object.assign({}, auth, { failedAttempts: 0, lockUntil: 0 });
  await writeAuth(next);
  return next;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const auth = await readAuth();
      res.status(200).json({
        hasPassword: !!(auth && auth.hash),
        authenticated: isAuthenticated(req),
        locked: isLocked(auth),
      });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = req.body || {};
    const action = body.action;

    // ---- First-time setup: request a code ----
    if (action === "setup-request") {
      const existing = await readAuth();
      if (existing && existing.hash) {
        res.status(409).json({ error: "A password is already set. Use login instead." });
        return;
      }
      if (existing && existing.lastSetupRequestAt && Date.now() - existing.lastSetupRequestAt < SETUP_REQUEST_COOLDOWN_MS) {
        res.status(429).json({ error: "Please wait a moment before requesting another code." });
        return;
      }
      const password = String(body.password || "");
      if (password.length < 4) {
        res.status(400).json({ error: "Use at least 4 characters." });
        return;
      }
      const { salt, hash } = hashPassword(password);
      const { token, code } = createChallenge("setup", { salt, hash });
      await sendVerificationEmail("setup", code);
      await writeAuth(Object.assign({}, existing, { lastSetupRequestAt: Date.now() }));
      res.status(200).json({ challenge: token });
      return;
    }

    // ---- First-time setup: confirm the code ----
    if (action === "setup-verify") {
      const existing = await readAuth();
      if (existing && existing.hash) {
        res.status(409).json({ error: "A password is already set. Use login instead." });
        return;
      }
      const result = verifyChallenge(body.challenge, String(body.code || ""), "setup");
      if (!result.ok) {
        res.status(400).json({ error: result.reason === "expired" ? "That code has expired — request a new one." : "That code isn't right." });
        return;
      }
      await writeAuth({ salt: result.payload.salt, hash: result.payload.hash, failedAttempts: 0, lockUntil: 0 });
      setSessionCookie(res);
      res.status(200).json({ ok: true });
      return;
    }

    // ---- Login: request a code (only sent once the password is confirmed correct) ----
    if (action === "login-request") {
      const auth = await readAuth();
      if (!auth || !auth.hash) {
        res.status(400).json({ error: "No password has been set up yet." });
        return;
      }
      if (isLocked(auth)) { lockedResponse(res, auth); return; }
      const password = String(body.password || "");
      if (!verifyPassword(password, auth.salt, auth.hash)) {
        await recordFailure(auth);
        res.status(401).json({ error: "That password isn't right." });
        return;
      }
      await recordSuccess(auth);
      const { token, code } = createChallenge("login", null);
      await sendVerificationEmail("login", code);
      res.status(200).json({ challenge: token });
      return;
    }

    // ---- Login: confirm the code ----
    if (action === "login-verify") {
      const auth = await readAuth();
      if (!auth || !auth.hash) {
        res.status(400).json({ error: "No password has been set up yet." });
        return;
      }
      if (isLocked(auth)) { lockedResponse(res, auth); return; }
      const result = verifyChallenge(body.challenge, String(body.code || ""), "login");
      if (!result.ok) {
        await recordFailure(auth);
        res.status(400).json({ error: result.reason === "expired" ? "That code has expired — start over." : "That code isn't right." });
        return;
      }
      await recordSuccess(auth);
      setSessionCookie(res);
      res.status(200).json({ ok: true });
      return;
    }

    // ---- Forgot password: request a code (does NOT require the current
    // password or an existing session — proving control of OWNER_EMAIL is
    // the whole point, since that's the same trust boundary login already
    // relies on). Deliberately ignores lockout too: if you're locked out
    // because you don't remember the password, this is the way out. ----
    if (action === "reset-request") {
      const existing = await readAuth();
      if (!existing || !existing.hash) {
        res.status(400).json({ error: "No password has been set up yet." });
        return;
      }
      if (existing.lastResetRequestAt && Date.now() - existing.lastResetRequestAt < SETUP_REQUEST_COOLDOWN_MS) {
        res.status(429).json({ error: "Please wait a moment before requesting another code." });
        return;
      }
      const newPassword = String(body.newPassword || "");
      if (newPassword.length < 4) {
        res.status(400).json({ error: "Use at least 4 characters." });
        return;
      }
      const { salt, hash } = hashPassword(newPassword);
      const { token, code } = createChallenge("reset-password", { salt, hash });
      await sendVerificationEmail("reset-password", code);
      await writeAuth(Object.assign({}, existing, { lastResetRequestAt: Date.now() }));
      res.status(200).json({ challenge: token });
      return;
    }

    // ---- Forgot password: confirm the code, then actually set the new
    // password and log the person in. ----
    if (action === "reset-verify") {
      const existing = await readAuth();
      if (!existing || !existing.hash) {
        res.status(400).json({ error: "No password has been set up yet." });
        return;
      }
      const result = verifyChallenge(body.challenge, String(body.code || ""), "reset-password");
      if (!result.ok) {
        res.status(400).json({ error: result.reason === "expired" ? "That code has expired — start over." : "That code isn't right." });
        return;
      }
      await writeAuth({ salt: result.payload.salt, hash: result.payload.hash, failedAttempts: 0, lockUntil: 0 });
      setSessionCookie(res);
      res.status(200).json({ ok: true });
      return;
    }

    // ---- Change password: request a code (must already be logged in) ----
    if (action === "change-request") {
      if (!isAuthenticated(req)) {
        res.status(401).json({ error: "Not authenticated." });
        return;
      }
      const auth = await readAuth();
      if (!auth || !auth.hash) {
        res.status(400).json({ error: "No password has been set up yet." });
        return;
      }
      if (isLocked(auth)) { lockedResponse(res, auth); return; }
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      if (!verifyPassword(current, auth.salt, auth.hash)) {
        await recordFailure(auth);
        res.status(401).json({ error: "Current password is wrong." });
        return;
      }
      if (next.length < 4) {
        res.status(400).json({ error: "Use at least 4 characters." });
        return;
      }
      await recordSuccess(auth);
      const { salt, hash } = hashPassword(next);
      const { token, code } = createChallenge("change-password", { salt, hash });
      await sendVerificationEmail("change-password", code);
      res.status(200).json({ challenge: token });
      return;
    }

    // ---- Change password: confirm the code ----
    if (action === "change-verify") {
      if (!isAuthenticated(req)) {
        res.status(401).json({ error: "Not authenticated." });
        return;
      }
      const result = verifyChallenge(body.challenge, String(body.code || ""), "change-password");
      if (!result.ok) {
        res.status(400).json({ error: result.reason === "expired" ? "That code has expired — start over." : "That code isn't right." });
        return;
      }
      await writeAuth({ salt: result.payload.salt, hash: result.payload.hash, failedAttempts: 0, lockUntil: 0 });
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
