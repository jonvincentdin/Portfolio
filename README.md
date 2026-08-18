# Portfolio

A single-owner portfolio site with a real (tiny) backend: Vercel serverless
functions for auth and data, and Vercel Blob storage to persist everything.
Edits save for every visitor immediately — no export/redeploy step needed.

## How it works

- `index.html` / `style.css` / `script.js` — the front end.
- `api/data.js` — reads/writes your portfolio content (GET is public, POST
  requires you to be logged in).
- `api/auth.js` — password setup/login/change. Passwords are hashed
  (SHA-256 + random salt) before they're stored — never saved as plain text.
- `api/upload.js` — handles photo/file uploads (resized client-side first),
  storing them in Vercel Blob and returning a public URL.
- `lib/session.js` — a signed, HttpOnly cookie proves you're logged in. No
  session database — the cookie itself is the proof (HMAC-signed).
- `lib/blobStore.js` — thin wrapper around Vercel Blob for the two JSON
  documents this app needs (your content, and your hashed password).
- `data.json` — the seed content used only the very first time the site
  runs, before anything has been saved to Blob storage yet.

Because it depends on Vercel Blob storage and serverless functions, **this
app can't run by just opening `index.html` in a browser, and a plain static
file server (like `python -m http.server` or a VS Code Live Server) won't
work either** — those don't run the code in `api/`. You need either a real
Vercel deployment or the Vercel CLI's local dev server (`vercel dev`), which
actually executes those functions. See below.

## Setup — required either way

Both testing locally and deploying for real need two things set up once,
via your Vercel project (not in the code):

1. **Vercel Blob storage.** In your Vercel project → **Storage** tab →
   **Create Database** → **Blob**. Connecting it auto-adds a
   `BLOB_READ_WRITE_TOKEN` environment variable — you don't set this by hand.
2. **`SESSION_SECRET`.** In your Vercel project → **Settings** →
   **Environment Variables**, add `SESSION_SECRET` set to any long random
   string (e.g. run `openssl rand -hex 32` and paste the output). This is
   what signs your login cookie — pick it once and leave it alone (changing
   it logs everyone out).

If either of these is missing, `/api/auth` and `/api/data` will fail — that's
almost certainly why a password "doesn't save": there's nothing there yet to
save it to.

## Testing it

**Fastest: deploy it, then test on the real URL.**
1. Push this project to a GitHub repo.
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
3. Do the two setup steps above (Blob storage + `SESSION_SECRET`).
4. If you added the env vars *after* the first deploy, redeploy once from the
   **Deployments** tab so the functions pick them up.
5. Open your `https://…vercel.app` URL, click your name, set a password —
   it'll actually persist now.

**Or iterate locally first, with the Vercel CLI:**
```bash
npm install -g vercel
vercel link        # connects this folder to a Vercel project (creates one if needed)
# then in the Vercel dashboard: add Blob storage + SESSION_SECRET as above
vercel env pull .env.local
vercel dev          # starts a local server that actually runs api/*.js
```
Open the printed `http://localhost:3000` URL. Login and data now work
locally the same way they will once deployed.

## About the password

Set on first use, hashed server-side (SHA-256 + a random salt) before it's
stored in Blob storage — the plain text is never saved anywhere. It's shared
by anyone who knows it (there's only one editor account, by design), checked
by the server on every save, not just a front-end gate. A signed session
cookie is what keeps you logged in between requests; it's `HttpOnly` (not
readable by page JavaScript) and only marked `Secure` on a real deployment,
so it also works correctly over plain `http://localhost` during local
testing.

## About the contact form

There's no message-relay service, so "Send message" opens the visitor's own
email app with the message pre-filled, addressed to your contact email. They
press send from their own client — a real email lands in your inbox, no
third-party service required. This does mean the visitor needs a configured
email client on their device.

## File overview

| File | Purpose |
|---|---|
| `index.html` | Page shell, loads fonts, `style.css`, `script.js` |
| `style.css` | All styling, theme/text-size system |
| `script.js` | Front-end app logic — rendering and editing |
| `api/data.js` | Read/write portfolio content |
| `api/auth.js` | Password setup, login, change, logout |
| `api/upload.js` | Photo/file uploads to Blob storage |
| `lib/session.js` | Signed login-cookie helper |
| `lib/blobStore.js` | Reads/writes the two JSON documents in Blob storage |
| `lib/passwordHash.js` | Password hashing/verification |
| `data.json` | Seed content, used only before anything is saved |

Projects are organized into categories (e.g. "Web Apps", "Client Work"), each
holding its own list of project entries — add categories and entries from the
Projects tab in edit mode.
