import { apiError } from "../../errors.ts";
import { defineRoute, type RequestContext, type ServerAuth } from "../../http/routes.ts";
import { deliverInbound } from "../../inbound/deliver.ts";
import type { InboundMessage, InboundStatus } from "../../state/types.ts";

// Bypass and retry of inbound messages (refs/api_messages-api.md:525-601, docs/06 §1).
// The 701 texts are INFERRED from the docs/02 §4.4 summary.

function transition(
  { store, params, auth }: RequestContext & { auth: ServerAuth },
  from: InboundStatus,
  action: string,
): InboundMessage {
  const message = store.state.inbound.get(params.id ?? "");
  if (message === undefined || message.ServerID !== auth.server.ID) {
    throw apiError(701, { message: "This message was not found." });
  }
  if (message.Status !== from)
    throw apiError(701, { message: `This message cannot be ${action}.` });
  return message;
}

defineRoute({
  method: "PUT",
  path: "/messages/inbound/:id/bypass",
  auth: "server",
  handler: async (ctx) => {
    const message = transition(ctx, "Blocked", "bypassed");
    message.Status = "Queued";
    await deliverInbound(ctx, message);
    return { ErrorCode: 0, Message: `Successfully bypassed message: ${message.MessageID}.` };
  },
});

// A retry starts the retry schedule again (INFERRED).
defineRoute({
  method: "PUT",
  path: "/messages/inbound/:id/retry",
  auth: "server",
  handler: async (ctx) => {
    const message = transition(ctx, "Failed", "retried");
    message.Status = "Queued";
    await deliverInbound(ctx, message);
    return {
      ErrorCode: 0,
      Message: `Successfully rescheduled failed message: ${message.MessageID}.`,
    };
  },
});
