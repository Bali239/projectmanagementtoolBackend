import nodemailer from "nodemailer";

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function isEmailServiceConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

export async function sendEmailVerificationEmail({ email, name, verificationUrl }) {
  if (!isEmailServiceConfigured()) throw new Error("SMTP is not configured");

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const safeName = escapeHtml(name || "there");
  const safeUrl = escapeHtml(verificationUrl);

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Verify your LetsDo email",
    text: `Hi ${name || "there"},\n\nVerify your email address to finish creating your LetsDo account:\n\n${verificationUrl}\n\nThis link expires in 24 hours.`,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f8f6;font-family:Arial,sans-serif;color:#17211f">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;background:#f4f8f6">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce8e3;border-radius:12px">
          <tr><td style="padding:32px 36px">
            <p style="margin:0 0 24px;color:#087568;font-size:14px;font-weight:700">LetsDo</p>
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">Verify your email</h1>
            <p style="margin:0 0 24px;color:#53615d;font-size:15px;line-height:1.6">Hi ${safeName}, verify this email address to finish creating your account. The link expires in 24 hours.</p>
            <p style="margin:0 0 24px"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#087568;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">Verify email address</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  });
}

export async function sendPasswordResetEmail({ email, name, resetUrl }) {
  if (!isEmailServiceConfigured()) throw new Error("SMTP is not configured");

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  const safeName = escapeHtml(name || "there");

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Reset your LetsDo password",
    text: `Hi ${name || "there"},\n\nUse this link to reset your LetsDo password. It expires in one hour.\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f8f6;font-family:Arial,sans-serif;color:#17211f">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;background:#f4f8f6">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce8e3;border-radius:12px">
          <tr><td style="padding:32px 36px">
            <p style="margin:0 0 24px;color:#087568;font-size:14px;font-weight:700">LetsDo</p>
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">Reset your password</h1>
            <p style="margin:0 0 24px;color:#53615d;font-size:15px;line-height:1.6">Hi ${safeName}, use the button below to choose a new password. This link expires in one hour.</p>
            <p style="margin:0 0 24px"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#087568;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">Reset password</a></p>
            <p style="margin:0 0 12px;color:#687570;font-size:12px;line-height:1.6">If the button does not work, copy this link into your browser:</p>
            <p style="margin:0 0 24px;overflow-wrap:anywhere;font-size:12px;line-height:1.6"><a href="${escapeHtml(resetUrl)}" style="color:#087568">${escapeHtml(resetUrl)}</a></p>
            <hr style="border:0;border-top:1px solid #e7eeeb;margin:24px 0" />
            <p style="margin:0;color:#83908b;font-size:12px;line-height:1.6">If you did not request a password reset, you can safely ignore this message.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  });
}

export async function sendAuthActivityEmail({ email, name, event }) {
  if (!isEmailServiceConfigured()) throw new Error("SMTP is not configured");

  const isSignIn = event === "sign-in";
  const actionTime = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date());
  const safeName = escapeHtml(name || "there");
  const heading = isSignIn ? "New sign-in to your account" : "You signed out of your account";
  const description = isSignIn
    ? "A sign-in to your LetsDo account was completed. If this was you, no action is needed."
    : "Your LetsDo account was signed out successfully.";
  const securityNote = isSignIn
    ? "If you do not recognize this activity, reset your password immediately and review your account security."
    : "If you did not sign out, sign in again and review your account security.";
  const resetUrl = `${(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "")}/forgot-password`;
  const subject = isSignIn ? "New sign-in to your LetsDo account" : "LetsDo sign-out confirmation";

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject,
    text: `Hi ${name || "there"},\n\n${description}\n\nTime (UTC): ${actionTime}\n\n${securityNote}${isSignIn ? `\n\nReset your password: ${resetUrl}` : ""}\n\nLetsDo Security`,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f8f6;font-family:Arial,sans-serif;color:#17211f">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;background:#f4f8f6">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce8e3;border-radius:12px">
          <tr><td style="padding:32px 36px">
            <p style="margin:0 0 24px;color:#087568;font-size:14px;font-weight:700">LetsDo</p>
            <p style="display:inline-block;margin:0 0 16px;padding:6px 10px;border-radius:999px;background:${isSignIn ? "#e8f5ef" : "#eef2f1"};color:${isSignIn ? "#087568" : "#53615d"};font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">Account activity</p>
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">${heading}</h1>
            <p style="margin:0 0 24px;color:#53615d;font-size:15px;line-height:1.6">Hi ${safeName}, ${description}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border:1px solid #e3ebe7;border-radius:8px">
              <tr><td style="padding:14px 16px;color:#687570;font-size:12px">Activity time</td><td align="right" style="padding:14px 16px;color:#17211f;font-size:12px;font-weight:600">${escapeHtml(actionTime)} UTC</td></tr>
            </table>
            <p style="margin:0 0 18px;color:#53615d;font-size:13px;line-height:1.6">${securityNote}</p>
            ${isSignIn ? `<p style="margin:0 0 24px"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#087568;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none">Reset password</a></p>` : ""}
            <hr style="border:0;border-top:1px solid #e7eeeb;margin:24px 0" />
            <p style="margin:0;color:#83908b;font-size:11px;line-height:1.6">This is an automatic account security notification. Please do not reply to this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  });
}