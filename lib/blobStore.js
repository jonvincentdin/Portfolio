// Thin wrapper around @vercel/blob for storing the two JSON documents this
// app needs: the published portfolio content, and the (hashed) auth record.
// Both are stored as plain JSON blobs with a stable pathname so every write
// overwrites the same "slot" rather than piling up new files.

const { put, list } = require("@vercel/blob");

const DATA_PATHNAME = "portfolio-data.json";
const AUTH_PATHNAME = "portfolio-auth.json";

async function findBlobUrl(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  const match = blobs.find((b) => b.pathname === pathname);
  return match ? match.url : null;
}

async function readJson(pathname) {
  const url = await findBlobUrl(pathname);
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
  return readJson(DATA_PATHNAME);
}
async function writePortfolioData(data) {
  return writeJson(DATA_PATHNAME, data);
}
async function readAuth() {
  return readJson(AUTH_PATHNAME);
}
async function writeAuth(auth) {
  return writeJson(AUTH_PATHNAME, auth);
}

module.exports = {
  readPortfolioData,
  writePortfolioData,
  readAuth,
  writeAuth,
};
