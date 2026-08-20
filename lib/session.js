// Small stateless session helper. We don't have a database for sessions,
// so instead of storing session state anywhere, we sign a value with a
// secret (HMAC-SHA256) and hand the signed token to the browser as a cookie.
// On each request we re-verify the signature. If it's valid and not too
// old, the request is treated as authenticated. Nothing about the actual
// password is ever stored in the cookie.

const crypto = require("crypto");

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "portfolio_session";

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

function verify(token) {
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

function makeSessionValue() {
  return `authenticated:${Date.now()}`;
}

function isSessionValueValid(value) {
  if (!value || !value.startsWith("authenticated:")) return false;
  const ts = parseInt(value.split(":")[1], 10);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < SESSION_MAX_AGE_MS;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx < 0) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  const value = verify(token);
  return isSessionValueValid(value);
}

function isProductionEnv() {
  // Vercel sets VERCEL_ENV to "production" or "preview" on deployed
  // environments (both served over https). Locally, via `vercel dev` or
  // plain `node`, neither is set to "production", so we skip the Secure
  // flag there — browsers silently drop Secure cookies on http://localhost,
  // which would otherwise make login look like it "doesn't save" locally.
  return process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
}

function setSessionCookie(res) {
  const token = sign(makeSessionValue());
  const maxAgeSeconds = Math.floor(SESSION_MAX_AGE_MS / 1000);
  const secureAttr = isProductionEnv() ? " Secure;" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly;${secureAttr} SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
}

function clearSessionCookie(res) {
  const secureAttr = isProductionEnv() ? " Secure;" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly;${secureAttr} SameSite=Lax; Max-Age=0`
  );
}

module.exports = {
  isAuthenticated,
  setSessionCookie,
  clearSessionCookie,
};
