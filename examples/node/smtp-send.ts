import nodemailer from "nodemailer";

// An app that sends through Postmark SMTP. Its configuration points it at postmock; the code is
// the same as against smtp.postmarkapp.com (AGENTS.md rule 3).
//
//   POSTMOCK_SEED=conformance POSTMOCK_SMTP_PORTS=2525 pnpm start
//   SMTP_HOST=127.0.0.1 SMTP_PORT=2525 POSTMARK_SERVER_TOKEN=postmock-server-token \
//   MAIL_FROM=sender@example.com MAIL_TO=recipient@example.com node examples/node/smtp-send.ts

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`set ${name}`);
  return value;
}

const transport = nodemailer.createTransport({
  host: env("SMTP_HOST"),
  port: Number(env("SMTP_PORT")),
  secure: false,
  // A server API token is both username and password.
  auth: { user: env("POSTMARK_SERVER_TOKEN"), pass: env("POSTMARK_SERVER_TOKEN") },
});

const info = await transport.sendMail({
  from: env("MAIL_FROM"),
  to: env("MAIL_TO"),
  subject: "Hello over SMTP",
  text: "Sent through Postmark SMTP.",
  headers: { "X-PM-Message-Stream": "outbound", "X-PM-Tag": "example" },
});
console.log(info.response);
