/**
 * Tokens and addresses every runner configures its suite with. The tokens exist only in postmock,
 * so a misrouted request gets 401 from real Postmark and sends nothing (docs/09 §4).
 * Addresses avoid `.test` and `.local`: postmark-python validates them (docs/08 E12).
 */
export const CONFORMANCE = {
  serverId: 1,
  accountToken: "postmock-account-token",
  serverToken: "postmock-server-token",
  serverName: "postmock conformance",
  senderEmail: "sender@example.com",
  recipientEmail: "recipient@example.com",
  domain: "example.com",
} as const;
