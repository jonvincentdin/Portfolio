// Stateless email-verification-code helper.
//
// We don't want a database just to track "which code did we send and to
// whom" — so instead we hash the code, put that hash (plus an expiry, a
// purpose, and any small payload the flow needs to carry through) into a
// token, and sign the whole thing with SESSION_SECRET. We hand that token
// to the browser; it comes back with the code the person typed in. We
// re-verify the signature, check the expiry, and compare the code's hash.
// Nothing is stored server-side, so there's nothing to clean up and
// nothing extra an attacker could read from storage.

const crypto = require("crypto");

const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is not set. Add it in your Vercel project settings (Settings -> Environment Variables)."
    );
  }
  return secret;
}

function sign(value) {
  const sig = crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
  return `${value}.${sig}`;
}

function verifySignature(token) {
  if (!token || typeof token !== "string") return null;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const value = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  let expected;
  try {
    expected = crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
  } catch (e) {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return value;
}

function generateCode() {
  // Cryptographically random 6-digit code, zero-padded.
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

/**
 * Creates a new challenge for the given purpose ("setup" | "login" |
 * "change-password"). `payload` is optional and is carried through
 * unmodified — e.g. change-password uses it to carry the *new* password's
 * salt/hash so they only get written once the code is confirmed.
 * Returns { token, code }: send `code` by email, hand `token` to the client.
 */
function createChallenge(purpose, payload) {
  const code = generateCode();
  const body = {
    p: purpose,
    ch: hashCode(code),
    exp: Date.now() + CHALLENGE_TTL_MS,
    d: payload || null,
  };
  const value = "challenge:" + Buffer.from(JSON.stringify(body)).toString("base64url");
  return { token: sign(value), code };
}

/**
 * Verifies a submitted code against a challenge token for the given
 * purpose. Returns the original payload (possibly null) on success, or
 * null if the token is invalid, expired, for the wrong purpose, or the
 * code doesn't match.
 */
function verifyChallenge(token, code, purpose) {
  const value = verifySignature(token);
  if (!value || !value.startsWith("challenge:")) return { ok: false, reason: "invalid" };
  let body;
  try {
    body = JSON.parse(Buffer.from(value.slice("challenge:".length), "base64url").toString("utf8"));
  } catch (e) {
    return { ok: false, reason: "invalid" };
  }
  if (body.p !== purpose) return { ok: false, reason: "invalid" };
  if (!body.exp || Date.now() > body.exp) return { ok: false, reason: "expired" };
  const a = Buffer.from(hashCode(code));
  const b = Buffer.from(body.ch);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "wrong_code" };
  }
  return { ok: true, payload: body.d };
}

module.exports = { createChallenge, verifyChallenge };
