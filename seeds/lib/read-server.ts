/**
 * The server that holds the message history the read suites need (`seeds/conformance/40-messages.ts`).
 * A runner maps the dotnet and php `READ_*` tokens to `token`; the write suites keep using the core
 * conformance server, whose counts this history leaves alone. IDs from the T4 range (docs/11 §5).
 */
export const READ_SERVER = {
  id: 4000,
  token: "postmock-read-server-token",
  name: "postmock read history",
} as const;
