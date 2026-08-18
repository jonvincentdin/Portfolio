const crypto = require("crypto");

// scrypt is a deliberately slow, memory-hard KDF — far more resistant to
// offline brute-forcing than a single fast SHA-256 pass. It's built into
// Node's crypto module, so no extra dependency is needed.
const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function randomHex(numBytes) {
  return crypto.randomBytes(numBytes).toString("hex");
}

function hashPassword(password, saltHex) {
  const salt = saltHex || randomHex(16);
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT_OPTS).toString("hex");
  return { salt, hash };
}

// Older stored hashes (from before this upgrade) are a plain SHA-256 digest
// — 64 hex characters. New scrypt hashes are 128 hex characters (64 bytes).
// Detecting by length lets existing passwords keep working without forcing
// everyone to reset.
function isLegacyHash(hash) {
  return typeof hash === "string" && hash.length === 64;
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  if (isLegacyHash(hash)) {
    const legacy = crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
    const a = Buffer.from(legacy);
    const b = Buffer.from(hash);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const attempt = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT_OPTS).toString("hex");
  const a = Buffer.from(attempt, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword, isLegacyHash };
