// Sends the verification-code emails via Resend (https://resend.com), a
// simple transactional email API that works over plain HTTPS (no SMTP
// credentials to manage) and has a free tier that easily covers a personal
// site's login volume.
//
// Requires a RESEND_API_KEY environment variable — see README.md for setup.

const DEFAULT_FROM = "Portfolio Security <onboarding@resend.dev>";

async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY environment variable is not set. Add it in your Vercel project settings so verification codes can be emailed — see README.md."
    );
  }
  const from = process.env.OTP_FROM_EMAIL || DEFAULT_FROM;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message || "Couldn't send the verification email. Try again.");
  }
}

module.exports = { sendEmail };
