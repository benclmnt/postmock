import nodemailer from "nodemailer";
import { ServerClient } from "postmark";

// An app that sends with Postmark's own host names: postmark.js with no host option, nodemailer to
// smtp.postmarkapp.com with STARTTLS. Nothing here names postmock. Compose resolves both host names
// to postmock, and NODE_EXTRA_CA_CERTS trusts its test CA (docs/01 §3.3 option B):
//
//   docker compose run --rm example-node
//
// The check at the end reads postmock's control API, as a test would.

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`set ${name}`);
  return value;
}

const token = env("POSTMARK_SERVER_TOKEN");
const to = `default-hosts-${Date.now()}@example.com`;
const from = "sender@example.com";

const sent = await new ServerClient(token).sendEmail({
  From: from,
  To: to,
  Subject: "Hello over REST",
  TextBody: "Sent through api.postmarkapp.com.",
  MessageStream: "outbound",
});
console.log(`REST: ErrorCode ${sent.ErrorCode}, MessageID ${sent.MessageID}`);

const info = await nodemailer
  .createTransport({
    host: "smtp.postmarkapp.com",
    port: 587,
    requireTLS: true,
    // A server API token is both username and password.
    auth: { user: token, pass: token },
  })
  .sendMail({
    from,
    to,
    subject: "Hello over SMTP",
    text: "Sent through smtp.postmarkapp.com.",
    headers: { "X-PM-Message-Stream": "outbound" },
  });
console.log(`SMTP: ${info.response}`);

for (const channel of ["rest", "smtp"]) {
  const url = `${env("POSTMOCK_CONTROL_URL")}/control/messages?channel=${channel}&to=${encodeURIComponent(to)}`;
  const { Messages } = (await (await fetch(url)).json()) as { Messages: unknown[] };
  if (Messages.length !== 1)
    throw new Error(`postmock holds ${Messages.length} ${channel} messages to ${to}`);
}
console.log("postmock received both messages");
