// Stateless email-verification codes.
//
// There's no database for "pending" login/setup/password-change actions, so
// instead of storing anything server-side, the pending action (plus a hash
// of the one-time code we emailed) is packed into a signed, timestamped
// token and handed back to the browser. The browser sends the token back
// along with the code the user typed in; we re-verify the signature (so the
// token can't be tampered with client-side), check the code hash, and check
// it hasn't expired. The plain code is never embedded in the token — only a
// one-way HMAC of it — so nothing sensitive leaks to the browser between
// steps.

const crypto = require("crypto");

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CODE_LENGTH = 6;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is not set. Add it in your Vercel project settings (Settings -> Environment Variables)."
    );
  }
  return secret;
}

function generateCode() {
  const max = 10 ** CODE_LENGTH;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(CODE_LENGTH, "0");
}

function hashCode(code) {
  return crypto.createHmac("sha256", getSecret()).update(String(code)).digest("hex");
}

function sign(value) {
  const sig = crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
  return Buffer.from(`${value}.${sig}`, "utf8").toString("base64url");
}

function unsign(token) {
  let raw;
  try {
    raw = Buffer.from(String(token), "base64url").toString("utf8");
  } catch (e) {
    return null;
  }
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return null;
  const value = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  let expected;
  try {
    expected = crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
  } catch (e) {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

// Creates a signed challenge token embedding the pending action, an expiry,
// and a hash of the one-time code (never the code itself).
function createChallenge(action, payload, code) {
  const record = {
    action,
    payload: payload || {},
    codeHash: hashCode(code),
    exp: Date.now() + CODE_TTL_MS,
  };
  return sign(JSON.stringify(record));
}

function decodeChallenge(token) {
  const raw = unsign(token);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (!record || typeof record !== "object" || !record.exp) return null;
    return record;
  } catch (e) {
    return null;
  }
}

// Verifies a token + submitted code. Returns {action, payload} on success,
// or null if the token is invalid, expired, or the code doesn't match.
function verifyChallenge(token, code) {
  const record = decodeChallenge(token);
  if (!record) return null;
  if (Date.now() > record.exp) return null;
  const submitted = hashCode(String(code || "").trim());
  const a = Buffer.from(submitted);
  const b = Buffer.from(String(record.codeHash || ""));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { action: record.action, payload: record.payload };
}

// Re-issues a fresh code for the same pending action (used by "resend"),
// without needing the original code.
function reissueChallenge(token) {
  const record = decodeChallenge(token);
  if (!record) return null;
  if (Date.now() > record.exp) return null;
  const code = generateCode();
  const newToken = createChallenge(record.action, record.payload, code);
  return { token: newToken, code };
}

module.exports = { generateCode, createChallenge, verifyChallenge, reissueChallenge };
