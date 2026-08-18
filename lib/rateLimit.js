// Lightweight brute-force protection. There's no separate database for this
// app (see lib/blobStore.js), so counters live as a few extra fields right
// on the same auth JSON document that already holds the password hash.
// The caller is responsible for reading the auth doc, calling these helpers
// (which mutate it in place), and writing it back — see api/auth.js.

const WINDOW_MS = 15 * 60 * 1000; // attempts are counted within a rolling window
const LOCK_MS = 15 * 60 * 1000; // how long a lockout lasts once triggered

function isLocked(auth, key) {
  const lockUntil = auth && auth[`${key}LockUntil`];
  if (lockUntil && Date.now() < lockUntil) return lockUntil;
  return null;
}

function lockMessage(lockUntil) {
  const mins = Math.max(1, Math.ceil((lockUntil - Date.now()) / 60000));
  return `Too many attempts — try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

// Records one event (a failed password check, a wrong code, a code being
// sent, etc.) under `key`. Once `maxCount` events land inside the rolling
// window, locks that key for LOCK_MS. Returns the lockUntil timestamp if
// this call just triggered the lock, otherwise null.
function recordEvent(auth, key, maxCount) {
  const now = Date.now();
  const windowField = `${key}WindowStart`;
  const countField = `${key}Count`;
  if (!auth[windowField] || now - auth[windowField] > WINDOW_MS) {
    auth[windowField] = now;
    auth[countField] = 0;
  }
  auth[countField] = (auth[countField] || 0) + 1;
  if (auth[countField] >= maxCount) {
    auth[`${key}LockUntil`] = now + LOCK_MS;
    auth[countField] = 0;
    return auth[`${key}LockUntil`];
  }
  return null;
}

function clearEvents(auth, key) {
  delete auth[`${key}WindowStart`];
  delete auth[`${key}Count`];
  delete auth[`${key}LockUntil`];
}

module.exports = { isLocked, lockMessage, recordEvent, clearEvents };
