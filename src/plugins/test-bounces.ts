import type { Plugin } from "../plugins.ts";
import { recordBounce } from "../recipients/transitions.ts";
import { BOUNCE_TYPES, type BounceType, type OutboundMessage } from "../state/types.ts";

/** The black-hole domain whose recipients bounce at once (docs/07 §2.3). */
export const BOUNCE_TESTING_DOMAIN = "bounce-testing.postmarkapp.com";

const TYPES = new Map(
  Object.keys(BOUNCE_TYPES).map((type) => [type.toLowerCase(), type as BounceType]),
);

/**
 * The bounce type for a recipient: the `X-PM-Bounce-Type` header, else the local part. Case and
 * `_` do not matter; an unknown value and `SpamComplaint` give HardBounce
 * (refs/support_article_1239-how-to-test-bounces.md:40,88-90).
 */
export function testBounceType(message: OutboundMessage, localPart: string): BounceType {
  const header = message.Headers.find((h) => h.Name.toLowerCase() === "x-pm-bounce-type");
  const type = TYPES.get((header?.Value ?? localPart).replaceAll("_", "").toLowerCase());
  return type === undefined || type === "SpamComplaint" ? "HardBounce" : type;
}

/**
 * A send to `bounce-testing.postmarkapp.com` bounces immediately, with the bounce event, stats and a
 * HardBounce suppression (docs/07 §2.3). `Details` text and the empty dump are INFERRED.
 */
const testBounces: Plugin = {
  install(runtime) {
    runtime.events.on("sent", async ({ message }) => {
      for (const { Email } of [...message.To, ...message.Cc, ...message.Bcc]) {
        const at = Email.lastIndexOf("@");
        if (Email.slice(at + 1).toLowerCase() !== BOUNCE_TESTING_DOMAIN) continue;
        await recordBounce(runtime, {
          message,
          email: Email,
          type: testBounceType(message, Email.slice(0, at)),
          details: "Test bounce",
          content: "",
        });
      }
    });
  },
};
export default testBounces;
