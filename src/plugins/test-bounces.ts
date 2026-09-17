import { Unsupported } from "../http/respond.ts";
import type { Plugin } from "../plugins.ts";
import { testBounces } from "../recipients/test-bounces.ts";
import { recordBounce } from "../recipients/transitions.ts";

/**
 * A send to `bounce-testing.postmarkapp.com` bounces right after the send answers (docs/07 §2.3).
 * The bounce runs on the clock, so a slow webhook never holds the send, and no `sent` listener
 * order matters. `validateOutbound` already refused the uncaptured types. A suppressed recipient
 * was never sent to and does not bounce. `Details` text and the empty dump are INFERRED.
 */
const testBouncesPlugin: Plugin = {
  install(runtime) {
    runtime.events.on("sent", ({ message }) => {
      const suppressed = new Set(message.suppressedRecipients.map((e) => e.toLowerCase()));
      const recipients = [...message.To, ...message.Cc, ...message.Bcc].filter(
        (a) => !suppressed.has(a.Email.toLowerCase()),
      );
      const bounces = testBounces(message.Headers, recipients);
      if (bounces.length === 0) return;
      runtime.clock.schedule(0, async () => {
        for (const { email, type } of bounces) {
          try {
            await recordBounce(runtime, {
              message,
              email,
              type,
              details: "Test bounce",
              content: "",
            });
          } catch (error) {
            // A suppression added after the send can make the effect uncaptured. The task has no
            // request to answer with 501: log and skip that bounce (as src/api/bulk/bulk.ts does).
            if (!(error instanceof Unsupported)) throw error;
            console.error(`postmock: fake bounce for ${email} skipped: ${error.message}`);
          }
        }
      });
    });
  },
};
export default testBouncesPlugin;
