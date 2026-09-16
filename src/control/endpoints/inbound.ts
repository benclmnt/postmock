import { z } from "zod";
import { receiveInbound } from "../../inbound/receive.ts";
import { composeMime } from "../../mime/compose.ts";
import { ControlError, controlInput, defineControl } from "../registry.ts";

const address = z.union([z.string(), z.object({ email: z.string(), name: z.string().optional() })]);
const emailOf = (a: z.output<typeof address>) => (typeof a === "string" ? a : a.email);

const spam = {
  spamScore: z.number().default(0),
  spamTests: z.array(z.string()).default([]),
};

const inboundSchema = z.union([
  z.strictObject({ mime: z.string(), rcptTo: z.array(z.string()).min(1), ...spam }),
  z.strictObject({
    from: address,
    to: z.array(address).default([]),
    cc: z.array(address).default([]),
    bcc: z.array(address).default([]),
    replyTo: address.optional(),
    subject: z.string().default(""),
    text: z.string().optional(),
    html: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
    attachments: z
      .array(
        z.object({
          name: z.string(),
          content: z.base64(),
          contentType: z.string(),
          contentId: z.string().optional(),
        }),
      )
      .default([]),
    ...spam,
  }),
]);

// Mail arrives at an inbound address (CONTROL-API.md). The body is raw MIME with its SMTP envelope,
// or fields that postmock writes as MIME; Bcc addresses go only into the envelope.
defineControl({
  method: "POST",
  path: "/control/inbound",
  handler: async (ctx) => {
    const input = controlInput(inboundSchema, ctx.body);
    const mail =
      "mime" in input
        ? input
        : {
            mime: composeMime(input, ctx.clock.now()),
            rcptTo: [...input.to, ...input.cc, ...input.bcc].map(emailOf),
            spamScore: input.spamScore,
            spamTests: input.spamTests,
          };
    const messages = await receiveInbound(ctx, mail);
    if (messages.length === 0) {
      throw new ControlError(`no server has an inbound address among ${mail.rcptTo.join(", ")}`);
    }
    return {
      Messages: messages.map((m) => ({
        MessageID: m.MessageID,
        ServerID: m.ServerID,
        Status: m.Status,
      })),
    };
  },
});
