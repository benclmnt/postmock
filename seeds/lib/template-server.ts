/**
 * The server whose template list starts with one template (`seeds/conformance/80-templates.ts`).
 * postmark-cli sends with the first listed template before its own tests create any
 * (sdk/postmark-cli/test/integration/email.template.test.ts:36-39,62-67). The dotnet suite counts the
 * templates of the core conformance server, so they stay on their own server. IDs from the T8
 * range (docs/11 §5).
 */
export const TEMPLATE_SERVER = {
  id: 8000,
  token: "postmock-template-server-token",
  name: "postmock templates",
  templateId: 8000,
} as const;
