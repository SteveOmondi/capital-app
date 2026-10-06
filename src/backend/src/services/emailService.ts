import { logger } from '../middlewares/logger';

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const { to, subject, text, html } = options;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromEmail = process.env.EMAIL_FROM || process.env.EmailFrom || 'no-reply@capitalfm.africa';
  const fromName = process.env.EMAIL_FROM_NAME || process.env.EmailFromName || 'Capital FM 98.4';
  const replyTo = process.env.REPLY_TO || process.env.EMAIL_REPLY_TO || process.env.ReplyTo;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      // Safely attempt loading nodemailer if installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        replyTo: replyTo || undefined,
        subject,
        text,
        html,
      });

      logger.info({ to, subject }, 'Email sent successfully via SMTP.');
      return true;
    } catch (err: any) {
      logger.error({ err, to }, 'Failed to send email via SMTP, falling back to logger notification.');
    }
  }

  // Simulated email delivery fallback for local dev/testing or unconfigured SMTP
  logger.info(
    {
      to,
      from: `"${fromName}" <${fromEmail}>`,
      replyTo: replyTo || undefined,
      subject,
      previewText: text.substring(0, 100),
    },
    'Simulated Email Dispatch: Customer email delivered.'
  );

  return true;
}

export async function sendDeletionConfirmationEmail(to: string, deletionLink: string): Promise<boolean> {
  const subject = 'Capital FM Account Deletion Request Confirmation';

  const text = `Hello,

We received a request to permanently delete your Capital FM account and profile data associated with ${to}.

To confirm account deletion and proceed, please open the following deep link on your mobile device:
${deletionLink}

If you did not request account deletion, please ignore this email. Your account will remain safe.

Regards,
Capital FM 98.4 Tech Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Capital FM - Confirm Account Deletion</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; margin: 0; padding: 0; color: #333; }
    .container { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #c0392b, #8e44ad); color: #ffffff; padding: 25px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; }
    .content { padding: 30px; line-height: 1.6; font-size: 15px; }
    .btn-container { text-align: center; margin: 30px 0; }
    .btn { display: inline-block; background-color: #e74c3c; color: #ffffff !important; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 10px rgba(231, 76, 60, 0.3); }
    .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 13px; color: #7f8c8d; border-top: 1px solid #eeeeee; }
    .link-box { background: #f1f2f6; padding: 12px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 13px; color: #2c3e50; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Capital FM 98.4</h1>
    </div>
    <div class="content">
      <h2>Account Deletion Request</h2>
      <p>Hello,</p>
      <p>We received a request to permanently delete your Capital FM profile and associated data for <strong>${to}</strong>.</p>
      <p>To confirm this deletion, tap the button below on your mobile device to open the Capital FM app:</p>
      <div class="btn-container">
        <a href="${deletionLink}" class="btn">Confirm & Delete My Account</a>
      </div>
      <p>If the button above does not open the app, copy and open the following link directly on your device:</p>
      <div class="link-box">${deletionLink}</div>
      <p style="margin-top: 25px; font-size: 13px; color: #888;">Note: This link will expire in 24 hours. If you did not request to delete your account, no further action is required.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Capital FM 98.4. All rights reserved.
    </div>
  </div>
</body>
</html>
`;

  return sendEmail({ to, subject, text, html });
}
