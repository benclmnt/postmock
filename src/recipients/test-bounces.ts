import { Unsupported } from "../http/respond.ts";
import { type Address, BOUNCE_TYPES, type BounceType, type Header } from "../state/types.ts";
import { bounceEffectCaptured } from "./transitions.ts";

/** The black-hole domain whose recipients bounce at once (docs/07 §2.3). */
export const BOUNCE_TESTING_DOMAIN = "bounce-testing.postmarkapp.com";

const TYPES = new Map(
  Object.keys(BOUNCE_TYPES).map((type) => [type.toLowerCase(), type as BounceType]),
);
const known = (value: string) => TYPES.get(value.replaceAll("_", "").toLowerCase());

export interface TestBounce {
  email: string;
  type: BounceType;
}

/**
 * The fake bounce of each recipient on `bounce-testing.postmarkapp.com` (docs/07 §2.3). The type
 * comes from `X-PM-Bounce-Type`, else the local part; case and `_` do not matter. An unknown local
 * part and `SpamComplaint` give HardBounce (DOC). The header winning over the local part is
 * INFERRED. Throws `Unsupported` for an unknown header value and for a type whose effect on the
 * address is not captured, so a send can refuse before it stores anything.
 */
export function testBounces(
  headers: readonly Header[],
  recipients: readonly Address[],
): TestBounce[] {
  const header = headers.find((h) => h.Name.toLowerCase() === "x-pm-bounce-type")?.Value;
  return recipients.flatMap(({ Email }) => {
    const at = Email.lastIndexOf("@");
    if (Email.slice(at + 1).toLowerCase() !== BOUNCE_TESTING_DOMAIN) return [];
    const named = known(header ?? Email.slice(0, at));
    if (named === undefined && header !== undefined) {
      throw new Unsupported(`X-PM-Bounce-Type '${header}': not a bounce type (docs/07 §2.3)`);
    }
    const type = named === undefined || named === "SpamComplaint" ? "HardBounce" : named;
    if (!bounceEffectCaptured(type)) {
      throw new Unsupported(
        `a fake ${type} bounce: its effect on the address is not captured (docs/04 Q13)`,
      );
    }
    return [{ email: Email, type }];
  });
}
