import type { Plugin } from "../plugins.ts";
import type { Bounce, StatsFact } from "../state/types.ts";
import { recipientsOf, trackedLinks } from "../tracking.ts";

/**
 * Records a Stats API fact for each countable event (docs/06 §2). Facts outlive messages, opens
 * and clicks, which leave after the retention window (refs/api_stats-api.md:4).
 */
const stats: Plugin = {
  install(runtime) {
    const { events } = runtime;
    const record = (fact: StatsFact) => {
      runtime.store.state.stats.push(fact);
    };
    const from = (b: Bounce) => ({
      ServerID: b.ServerID,
      MessageStream: b.MessageStream,
      Tag: b.Tag,
      at: b.BouncedAt,
    });

    events.on("sent", ({ message }) => {
      const linkTracking = message.TrackLinks !== "None";
      // One fact per recipient: stats count a message once per recipient (refs/api_messages-api.md:50).
      for (const _ of recipientsOf(message)) {
        record({
          kind: "sent",
          ServerID: message.ServerID,
          MessageStream: message.MessageStream,
          Tag: message.Tag,
          at: message.ReceivedAt,
          openTracking: message.TrackOpens,
          linkTracking,
          trackedLinks: linkTracking ? trackedLinks(message).length : 0,
        });
      }
    });
    // The bounce stats keys are HardBounce, SoftBounce, Transient, SMTPApiError
    // (refs/api_stats-api.md:197-200). Other bounce types count nowhere (INFERRED).
    events.on("bounced", ({ bounce }) => {
      if (
        bounce.Type === "HardBounce" ||
        bounce.Type === "SoftBounce" ||
        bounce.Type === "Transient"
      ) {
        record({ kind: "bounce", type: bounce.Type, ...from(bounce) });
      }
    });
    events.on("smtpApiError", ({ bounce }) => {
      record({ kind: "bounce", type: "SMTPApiError", ...from(bounce) });
    });
    events.on("spamComplaint", ({ bounce }) => record({ kind: "spamComplaint", ...from(bounce) }));
    events.on("opened", ({ open }) =>
      record({
        kind: "open",
        ServerID: open.ServerID,
        MessageStream: open.MessageStream,
        Tag: open.Tag,
        at: open.ReceivedAt,
        MessageID: open.MessageID,
        Recipient: open.Recipient,
        platform: open.Platform,
        client: open.Client?.Family ?? null,
        readSeconds: open.ReadSeconds,
      }),
    );
    events.on("clicked", ({ click }) =>
      record({
        kind: "click",
        ServerID: click.ServerID,
        MessageStream: click.MessageStream,
        Tag: click.Tag,
        at: click.ReceivedAt,
        MessageID: click.MessageID,
        Recipient: click.Recipient,
        link: click.OriginalLink,
        location: click.ClickLocation,
        platform: click.Platform,
        browser: click.Client?.Family ?? null,
      }),
    );
  },
};
export default stats;
