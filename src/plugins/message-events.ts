import type { Plugin } from "../plugins.ts";
import type { MessageEvent, OutboundMessage } from "../state/types.ts";

/**
 * Appends the `MessageEvents` of outbound message details (docs/06 §1.6). Details values are
 * strings (refs/api_messages-api.md:181-236).
 */
const messageEvents: Plugin = {
  install(runtime) {
    const { events } = runtime;
    const add = (message: OutboundMessage | undefined, event: MessageEvent) => {
      message?.MessageEvents.push(event);
    };
    const outbound = (id: string | null) =>
      id === null ? undefined : runtime.store.state.outbound.get(id);

    // DestinationServer and DestinationIP are left out: postmock delivers to no real server.
    events.on("delivered", ({ message, recipient, deliveredAt, details }) =>
      add(message, {
        Recipient: recipient,
        Type: "Delivered",
        ReceivedAt: deliveredAt,
        Details: { DeliveryMessage: details },
      }),
    );
    events.on("bounced", ({ bounce }) => {
      const message = outbound(bounce.MessageID);
      if (bounce.Type === "Transient") {
        add(message, {
          Recipient: bounce.Email,
          Type: "Transient",
          ReceivedAt: bounce.BouncedAt,
          Details: { DeliveryMessage: bounce.Details },
        });
      } else if (bounce.Type !== "SpamComplaint" && bounce.Type !== "SMTPApiError") {
        add(message, {
          Recipient: bounce.Email,
          Type: "Bounced",
          ReceivedAt: bounce.BouncedAt,
          Details: { Summary: bounce.Details, BounceID: String(bounce.ID) },
        });
      }
    });
    // Only the stored first open and first click per link appear, like the opens and clicks reads.
    events.on("opened", ({ open }) => {
      if (!runtime.store.state.opens.includes(open)) return;
      add(outbound(open.MessageID), {
        Recipient: open.Recipient,
        Type: "Opened",
        ReceivedAt: open.ReceivedAt,
        Details: { Summary: `Email opened with ${open.UserAgent}` },
      });
    });
    events.on("clicked", ({ click }) => {
      if (!runtime.store.state.clicks.includes(click)) return;
      const body = click.ClickLocation === "HTML" ? "HTMLBody" : "TextBody";
      add(outbound(click.MessageID), {
        Recipient: click.Recipient,
        Type: "LinkClicked",
        ReceivedAt: click.ReceivedAt,
        Details: {
          Summary: `Tracked Link '${click.OriginalLink}' was clicked from the ${body}.`,
          Link: click.OriginalLink,
          ClickLocation: click.ClickLocation,
        },
      });
    });
    events.on("subscriptionChange", ({ change }) =>
      add(outbound(change.MessageID), {
        Recipient: change.Recipient,
        Type: "SubscriptionChanged",
        ReceivedAt: change.ChangedAt,
        Details: {
          Origin: change.Origin,
          SuppressSending: change.SuppressSending ? "True" : "False",
        },
      }),
    );
  },
};
export default messageEvents;
