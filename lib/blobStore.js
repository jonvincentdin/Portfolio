// Thin wrapper around @vercel/blob for storing the two JSON documents this
// app needs: the published portfolio content, and the (hashed) auth record.
//
// The content blob uses a stable, predictable pathname (with overwrite) —
// that's fine, the content is meant to be public anyway.
//
// The auth blob (your password's salt+hash) is different: Vercel Blob's
// "public" access means anyone with the exact URL can fetch the raw JSON
// directly, bypassing our API entirely. Since photo/file uploads live in
// the same store and their URLs appear in the page's HTML, the store's
// base URL isn't really a secret. So the auth blob gets a random,
// unguessable path suffix instead of a fixed name — our server can still
// find it (list() requires the write token, which only our functions
// have), but nobody can just guess the URL. We also delete the previous
// version on every write so old copies don't linger.

const { put, list, del } = require("@vercel/blob");

const DATA_PATHNAME = "portfolio-data.json";
const AUTH_PATHNAME_PREFIX = "portfolio-auth";

async function findBlobUrl(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  const match = blobs.find((b) => b.pathname === pathname);
  return match ? match.url : null;
}

async function findAuthBlob() {
  const { blobs } = await list({ prefix: AUTH_PATHNAME_PREFIX, limit: 10 });
  // Most recently uploaded first, in case an old copy wasn't cleaned up.
  const sorted = blobs.slice().sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return sorted[0] || null;
}

async function readJson(url) {
  if (!url) return null;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function writeJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function readPortfolioData() {
  const url = await findBlobUrl(DATA_PATHNAME);
  return readJson(url);
}
async function writePortfolioData(data) {
  return writeJson(DATA_PATHNAME, data);
}

async function readAuth() {
  const blob = await findAuthBlob();
  return readJson(blob ? blob.url : null);
}
async function writeAuth(auth) {
  const previous = await findAuthBlob();
  await put(`${AUTH_PATHNAME_PREFIX}.json`, JSON.stringify(auth), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: true,
  });
  if (previous) {
    try {
      await del(previous.url);
    } catch (e) {
      // Non-fatal — an old, now-unused credential blob at worst. Don't
      // fail the write over cleanup.
    }
  }
}

module.exports = {
  readPortfolioData,
  writePortfolioData,
  readAuth,
  writeAuth,
};
