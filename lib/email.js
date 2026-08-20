// Sends the verification code by email via Resend (https://resend.com).
// Uses plain fetch against their HTTP API so we don't need to add a
// dependency. Requires two environment variables, set in your Vercel
// project (Settings -> Environment Variables):
//
//   RESEND_API_KEY  — from your Resend account (Settings -> API Keys)
//   OWNER_EMAIL     — the address codes get sent to (only you should read
//                      this inbox — anyone who can read it can log in)
//
// Optional:
//   RESEND_FROM     — defaults to Resend's shared onboarding sender, which
//                      only delivers to the email address your Resend
//                      account itself is registered with. To send to any
//                      address, verify a domain in Resend and set this to
//                      something like "Portfolio <noreply@yourdomain.com>".

const SUBJECT_BY_PURPOSE = {
  setup: "Your portfolio verification code",
  login: "Your portfolio login code",
  "change-password": "Your portfolio password-change code",
  "reset-password": "Your portfolio password-reset code",
};

async function sendVerificationEmail(purpose, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.OWNER_EMAIL;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY environment variable is not set. Add it in your Vercel project settings to enable email verification."
    );
  }
  if (!to) {
    throw new Error(
      "OWNER_EMAIL environment variable is not set. Add it in your Vercel project settings — this is where verification codes are sent."
    );
  }

  const subject = SUBJECT_BY_PURPOSE[purpose] || "Your verification code";
  const from = process.env.RESEND_FROM || "Portfolio <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: `Your verification code is ${code}.\n\nIt expires in 10 minutes. If you didn't request this, you can safely ignore this email — no changes were made.`,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to send the verification email.");
  }
}

module.exports = { sendVerificationEmail };
