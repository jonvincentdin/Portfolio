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
- `api/media.js` — lists everything you've previously uploaded, so an entry
  can reuse an existing file instead of uploading a duplicate.
- `lib/session.js` — a signed, HttpOnly cookie proves you're logged in. No
  session database — the cookie itself is the proof (HMAC-signed).
- `lib/blobStore.js` — thin wrapper around Vercel Blob for the two JSON
  documents this app needs (your content, and your hashed password).
- `data.json` — the seed content used only the very first time the site
  runs, before anything has been saved to Blob storage yet.

## Profiles

Profiles let you set up different named "views" of the same portfolio — for
example a "Full Profile" and a "School Profile" that only shows a subset of
sections — **without duplicating any content or files.** Every profile
shares the exact same achievements, projects, skills, etc.; each profile
just has its own list of which sections are hidden and what order they
appear in.

In edit mode, "Viewing: [Profile name]" in the edit bar opens the Profiles
manager, where you can create new profiles, rename or delete them, and
switch which one is currently active. Whichever profile is active is what
every visitor sees — switching it takes effect immediately, the same way
any other edit does. Use "Manage sections" (also in the edit bar) to
configure the active profile's section visibility and order.

## Reusing uploaded files (media library)

Anywhere you can attach a photo or file — project photos, project files,
certificates on Achievements/Education or custom-section entries, your
profile photo — there's a "Browse library" option alongside "Upload from
device." It lists everything you've already uploaded (with thumbnails for
images) so you can reuse the same file across multiple entries, or across
multiple Profiles, instead of uploading a fresh duplicate copy each time.

The library only lists files under the `uploads/` folder in your Blob
store — the same folder every upload already goes into (`api/upload.js`
writes there, `api/media.js` only ever reads from there). It never lists
`portfolio-data.json` or the `portfolio-auth-*.json` credentials file, since
those live outside `uploads/` and aren't files you'd want to "attach" to an
entry anyway.

Because it depends on Vercel Blob storage and serverless functions, **this
app can't run by just opening `index.html` in a browser, and a plain static
file server (like `python -m http.server` or a VS Code Live Server) won't
work either** — those don't run the code in `api/`. You need either a real
Vercel deployment or the Vercel CLI's local dev server (`vercel dev`), which
actually executes those functions. See below.

## Setup — required either way

Both testing locally and deploying for real need these set up once, via
your Vercel project (not in the code):

1. **Vercel Blob storage.** In your Vercel project → **Storage** tab →
   **Create Database** → **Blob**. Connecting it auto-adds a
   `BLOB_READ_WRITE_TOKEN` environment variable — you don't set this by hand.
2. **`SESSION_SECRET`.** In your Vercel project → **Settings** →
   **Environment Variables**, add `SESSION_SECRET` set to any long random
   string (e.g. run `openssl rand -hex 32` and paste the output). This signs
   both your login cookie and verification-code challenges — pick it once
   and leave it alone (changing it logs everyone out and invalidates any
   code you're mid-way through entering).
3. **`OWNER_EMAIL`.** The email address verification codes get sent to —
   e.g. `jonvincent.din@gmail.com`. Anyone who can read that inbox can log
   in, so use one only you control.
4. **`RESEND_API_KEY`.** Email delivery goes through [Resend](https://resend.com)
   (free tier is plenty for this). Sign up, grab an API key from
   **Settings → API Keys**, and add it here.
   - By default, emails send from Resend's shared `onboarding@resend.dev`
     address, which **only delivers to the email your Resend account itself
     is registered with.** If `OWNER_EMAIL` is a different address, verify a
     domain in Resend and set `RESEND_FROM` (optional) to something like
     `Portfolio <noreply@yourdomain.com>` so it can send to any address.

`BLOB_READ_WRITE_TOKEN` and `SESSION_SECRET` are required — without them,
`/api/data` and `/api/auth` can't work at all. `OWNER_EMAIL` and
`RESEND_API_KEY` are not required to log in: if either is missing, the app
skips the email-code step and lets you in on the password alone (with a
heads-up toast saying so), rather than locking you out entirely. Add both
whenever you want that extra step back — it applies automatically the next
time you log in, no code changes needed.

## Testing it

**Fastest: deploy it, then test on the real URL.**
1. Push this project to a GitHub repo.
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
3. Do the setup steps above (Blob storage, `SESSION_SECRET`, `OWNER_EMAIL`,
   `RESEND_API_KEY`).
4. If you added the env vars *after* the first deploy, redeploy once from the
   **Deployments** tab so the functions pick them up.
5. Open your `https://…vercel.app` URL, click your name, set a password,
   then check your email for the code — it'll actually persist now.

**Or iterate locally first, with the Vercel CLI:**
```bash
npm install -g vercel
vercel link        # connects this folder to a Vercel project (creates one if needed)
# then in the Vercel dashboard: add the env vars from Setup above
vercel env pull .env.local
vercel dev          # starts a local server that actually runs api/*.js
```
Open the printed `http://localhost:3000` URL. Login and data now work
locally the same way they will once deployed.

## About the password and login security

- **Hashed, never stored as plain text.** SHA-256 + a random salt, checked
  server-side on every login — not just a front-end gate.
- **Email verification on every setup, login, and password change.** After
  the password checks out, a 6-digit code is emailed to `OWNER_EMAIL`; you
  need that code too before access is granted. This closes an important gap
  in simple password-only setups: without it, whoever visits the live site
  *first* could claim the password before you do. With it, only someone who
  can read your inbox can ever gain access.
- **Codes expire in 10 minutes** and are single-purpose (a login code can't
  be reused to change your password, etc.).
- **Lockout after 5 wrong attempts** (wrong password *or* wrong code) — the
  account locks for 15 minutes. This applies per credentials, not per IP, so
  it protects against brute-forcing without needing to track visitors.
- **Every page refresh logs you out of edit mode**, on purpose — even mid-
  session, reloading always requires the password + code again rather than
  silently staying logged in. Trades a little convenience for a much shorter
  window where a session could be misused (e.g. on a shared computer).
- The auth blob (your salt+hash) is stored at a random, unguessable path in
  Blob storage rather than a predictable one — since photo/file URLs from
  this same storage account are visible in the page's HTML, a predictable
  path for anything sensitive would be a real risk.
- The session cookie is `HttpOnly` (invisible to page JavaScript) and
  `Secure` on real deployments (HTTPS only).

None of this protects against someone with direct access to your Vercel
project's environment variables or Blob storage — that's a different trust
boundary (protect your Vercel account with a strong password and 2FA, same
as anywhere else).

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
| `api/auth.js` | Password setup/login/change with email verification, lockout |
| `api/upload.js` | Photo/file uploads to Blob storage |
| `api/media.js` | Lists previous uploads for reuse across entries |
| `lib/session.js` | Signed login-cookie helper |
| `lib/challenge.js` | Signed, stateless verification-code tokens |
| `lib/email.js` | Sends verification codes via Resend |
| `lib/blobStore.js` | Reads/writes the JSON documents in Blob storage |
| `lib/passwordHash.js` | Password hashing/verification |
| `data.json` | Seed content, used only before anything is saved |

Projects are organized into categories (e.g. "Web Apps", "Client Work"), each
holding its own list of project entries — add categories and entries from the
Projects tab in edit mode.
