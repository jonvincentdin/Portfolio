const crypto = require("crypto");

function randomHex(numBytes) {
  return crypto.randomBytes(numBytes).toString("hex");
}

function hashPassword(password, saltHex) {
  const salt = saltHex || randomHex(16);
  const hash = crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const attempt = crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
  const a = Buffer.from(attempt);
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword };
