import type { Runtime } from "../runtime.ts";
import type { InboundMessage } from "../state/types.ts";
import { deliver, INBOUND } from "../webhooks/deliver.ts";
import { inboundPayload } from "../webhooks/payloads.ts";

/**
 * POSTs an inbound message to the server's `InboundHookUrl` (docs/05 §3.6, §4.1) and tracks its
 * status: `Processed` on success, `Scheduled` while a retry waits, `Failed` after a 403 or the last
 * retry. A server without a hook URL processes the message at once. The status names follow the
 * inbound search filter (refs/api_messages-api.md:315); the mapping is INFERRED.
 */
export async function deliverInbound(runtime: Runtime, message: InboundMessage): Promise<void> {
  const server = runtime.store.state.servers.get(message.ServerID);
  if (server === undefined) throw new Error(`inbound message ${message.MessageID}: no server`);
  if (server.InboundHookUrl === "") {
    message.Status = "Processed";
    return;
  }
  await deliver(runtime, {
    target: {
      serverId: server.ID,
      webhookId: null,
      url: server.InboundHookUrl,
      httpAuth: null,
      headers: [],
    },
    recordType: "Inbound",
    payload: inboundPayload(message, server.RawEmailEnabled),
    policy: INBOUND,
    onResult: (result) => {
      message.Status =
        result === "success" ? "Processed" : result === "retry" ? "Scheduled" : "Failed";
    },
  });
}
