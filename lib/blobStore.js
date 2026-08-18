// Thin wrapper around @vercel/blob for storing the two JSON documents this
// app needs: the published portfolio content, and the (hashed) auth record.
// Both are stored as plain JSON blobs with a stable pathname so every write
// overwrites the same "slot" rather than piling up new files.

const { put, list } = require("@vercel/blob");

const DATA_PATHNAME = "portfolio-data.json";
const AUTH_PATHNAME = "portfolio-auth.json";

function assertBlobConfigured() {
  // Vercel connects a store to a project one of two ways: the newer OIDC
  // method (BLOB_STORE_ID + VERCEL_OIDC_TOKEN) or the older static
  // BLOB_READ_WRITE_TOKEN. Either is fine — @vercel/blob picks whichever is
  // present automatically. We only need to fail loudly if neither exists.
  const hasStaticToken = !!process.env.BLOB_READ_WRITE_TOKEN;
  const hasOidc = !!process.env.BLOB_STORE_ID && !!process.env.VERCEL_OIDC_TOKEN;
  if (!hasStaticToken && !hasOidc) {
    throw new Error(
      "Vercel Blob storage isn't connected to this deployment. In your Vercel project, go to Storage -> connect your existing Blob store to this project (or create one), then redeploy."
    );
  }
}

async function findBlobUrl(pathname) {
  assertBlobConfigured();
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
  assertBlobConfigured();
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
