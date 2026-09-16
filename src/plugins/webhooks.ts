import { deliverInbound } from "../inbound/deliver.ts";
import type { Plugin } from "../plugins.ts";
import type { Bounce } from "../state/types.ts";
import { emitOutbound, type Hook } from "../webhooks/outbound.ts";
import {
  bouncePayload,
  clickPayload,
  deliveryPayload,
  openPayload,
  subscriptionChangePayload,
} from "../webhooks/payloads.ts";

const bounceContent = (hook: Hook, trigger: "Bounce" | "SpamComplaint") =>
  hook.kind === "webhook"
    ? hook.webhook.Triggers[trigger].IncludeContent
    : hook.server.IncludeBounceContentInHook;

/** The webhook emitter: every domain event becomes a POST to the hooks that ask for it (docs/05 §5). */
const webhooks: Plugin = {
  install(runtime) {
    const { events } = runtime;
    events.on("delivered", (e) =>
      emitOutbound(runtime, {
        serverId: e.message.ServerID,
        messageStream: e.message.MessageStream,
        recordType: "Delivery",
        trigger: "Delivery",
        serverHookUrl: (s) => s.DeliveryHookUrl,
        payload: () => deliveryPayload(e),
      }),
    );
    const toBounceHooks = (bounce: Bounce) =>
      emitOutbound(runtime, {
        serverId: bounce.ServerID,
        messageStream: bounce.MessageStream,
        recordType: "Bounce",
        trigger: "Bounce",
        serverHookUrl: (s) => s.BounceHookUrl,
        payload: (hook) => bouncePayload("Bounce", bounce, bounceContent(hook, "Bounce")),
      });
    events.on("bounced", ({ bounce }) => toBounceHooks(bounce));
    // SMTP API errors reach the bounce hooks only with the server switch (docs/05 §2.8).
    events.on("smtpApiError", async ({ bounce }) => {
      if (runtime.store.state.servers.get(bounce.ServerID)?.EnableSmtpApiErrorHooks === true) {
        await toBounceHooks(bounce);
      }
    });
    events.on("spamComplaint", ({ bounce }) =>
      emitOutbound(runtime, {
        serverId: bounce.ServerID,
        messageStream: bounce.MessageStream,
        recordType: "SpamComplaint",
        trigger: "SpamComplaint",
        serverHookUrl: null,
        payload: (hook) =>
          bouncePayload("SpamComplaint", bounce, bounceContent(hook, "SpamComplaint")),
      }),
    );
    events.on("opened", ({ open }) =>
      emitOutbound(runtime, {
        serverId: open.ServerID,
        messageStream: open.MessageStream,
        recordType: "Open",
        trigger: "Open",
        serverHookUrl: (s) => s.OpenHookUrl,
        payload: (hook) => {
          const firstOnly =
            hook.kind === "webhook"
              ? hook.webhook.Triggers.Open.PostFirstOpenOnly
              : hook.server.PostFirstOpenOnly;
          return firstOnly && !open.FirstOpen ? null : openPayload(open);
        },
      }),
    );
    events.on("clicked", ({ click }) =>
      emitOutbound(runtime, {
        serverId: click.ServerID,
        messageStream: click.MessageStream,
        recordType: "Click",
        trigger: "Click",
        serverHookUrl: (s) => s.ClickHookUrl,
        payload: () => clickPayload(click),
      }),
    );
    events.on("subscriptionChange", ({ change }) =>
      emitOutbound(runtime, {
        serverId: change.ServerID,
        messageStream: change.MessageStream,
        recordType: "SubscriptionChange",
        trigger: "SubscriptionChange",
        serverHookUrl: null,
        payload: () => subscriptionChangePayload(change),
      }),
    );
    // A blocked message waits for a bypass (docs/05 §4.1).
    events.on("inboundReceived", async ({ message }) => {
      if (message.Status !== "Blocked") await deliverInbound(runtime, message);
    });
  },
};
export default webhooks;
