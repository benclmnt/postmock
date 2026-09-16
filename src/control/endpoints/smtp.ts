import { z } from "zod";
import { newHex } from "../../state/ids.ts";
import { streamKey } from "../../state/store.ts";
import { ControlError, controlInput, defineControl } from "../registry.ts";

// docs/07 Mock must: tests create and revoke SMTP tokens, and fault the SMTP session.

defineControl({
  method: "POST",
  path: "/control/smtp/tokens",
  handler: ({ store, body }) => {
    const input = controlInput(z.object({ serverId: z.int(), messageStream: z.string() }), body);
    const server = store.state.servers.get(input.serverId);
    if (server === undefined) throw new ControlError(`no server ${input.serverId}`);
    const stream = store.state.streams.get(streamKey(server.ID, input.messageStream));
    if (stream === undefined) {
      throw new ControlError(`server ${server.ID} has no stream '${input.messageStream}'`);
    }
    // The UI refuses these like ErrorCodes 1457, 1459 and 1460 (refs/api_overview.md:191-194).
    if (stream.MessageStreamType === "Inbound") {
      throw new ControlError("Tokens cannot be used with inbound streams.");
    }
    if (stream.ArchivedAt !== null) {
      throw new ControlError(
        "A token cannot be issued for an archived stream scheduled for deletion.",
      );
    }
    if (!server.SmtpApiActivated) {
      throw new ControlError("SMTP is currently disabled for the specified server.");
    }
    // Key formats are not documented (docs/07 Q16): INFERRED.
    const token = {
      accessKey: newHex(16),
      secretKey: newHex(32),
      serverId: server.ID,
      messageStream: stream.ID,
    };
    store.state.smtpTokens.set(token.accessKey, token);
    return {
      AccessKey: token.accessKey,
      SecretKey: token.secretKey,
      ServerID: token.serverId,
      MessageStream: token.messageStream,
    };
  },
});

defineControl({
  method: "DELETE",
  path: "/control/smtp/tokens/:accessKey",
  handler: ({ store, params }) => {
    const accessKey = params.accessKey as string;
    if (!store.state.smtpTokens.delete(accessKey)) {
      throw new ControlError(`no SMTP token '${accessKey}'`);
    }
    return { AccessKey: accessKey };
  },
});

const faultSchema = z.object({
  stage: z.enum(["connect", "mail", "rcpt", "data"]),
  times: z.int().positive().default(1),
  // A 4xx or 5xx reply; 421 also closes the connection (an outage or an idle close).
  reply: z.object({ code: z.int().min(400).max(599), message: z.string().min(1) }),
});

defineControl({
  method: "POST",
  path: "/control/smtp/faults",
  handler: ({ store, body }) => {
    const { stage, times, reply } = controlInput(faultSchema, body);
    store.state.smtpFaults.push({
      stage,
      remaining: times,
      code: reply.code,
      message: reply.message,
    });
    return { faults: store.state.smtpFaults.length };
  },
});
