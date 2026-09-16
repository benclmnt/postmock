import type { Runtime } from "../runtime.ts";
import type { Server, Webhook, WebhookRecordType, WebhookTriggers } from "../state/types.ts";
import { deliver, OUTBOUND, type Target } from "./deliver.ts";

/** A hook that receives an event: a `/webhooks` row, or the server's own hook URL. */
export type Hook = { kind: "webhook"; webhook: Webhook } | { kind: "server"; server: Server };

export interface OutboundEvent {
  serverId: number;
  messageStream: string;
  recordType: Exclude<WebhookRecordType, "Inbound">;
  trigger: keyof WebhookTriggers;
  /** The server hook URL field for this event; none for SpamComplaint and SubscriptionChange. */
  serverHookUrl: ((server: Server) => string) | null;
  /** The body for one hook, or null when that hook filters the event out. */
  payload: (hook: Hook) => object | null;
}

/**
 * Sends an event to every verified `/webhooks` row of its stream with the trigger on, then to the
 * server hook URL (docs/05 §1.5, §5). Server hook URLs apply to every stream (INFERRED, Q10).
 */
export async function emitOutbound(runtime: Runtime, event: OutboundEvent): Promise<void> {
  const server = runtime.store.state.servers.get(event.serverId);
  if (server === undefined) return;
  const hooks: Array<{ hook: Hook; target: Target }> = [];
  for (const webhook of runtime.store.state.webhooks.values()) {
    if (
      webhook.ServerID === server.ID &&
      webhook.MessageStream === event.messageStream &&
      webhook.Status === "verified" &&
      webhook.Triggers[event.trigger].Enabled
    ) {
      hooks.push({
        hook: { kind: "webhook", webhook },
        target: {
          serverId: server.ID,
          webhookId: webhook.ID,
          url: webhook.Url,
          httpAuth: webhook.HttpAuth,
          headers: webhook.HttpHeaders,
        },
      });
    }
  }
  const serverUrl = event.serverHookUrl?.(server) ?? "";
  if (serverUrl !== "") {
    hooks.push({
      hook: { kind: "server", server },
      target: { serverId: server.ID, webhookId: null, url: serverUrl, httpAuth: null, headers: [] },
    });
  }
  for (const { hook, target } of hooks) {
    const payload = event.payload(hook);
    if (payload !== null) {
      await deliver(runtime, { target, recordType: event.recordType, payload, policy: OUTBOUND });
    }
  }
}
