import { dumpAvailable } from "../../recipients/transitions.ts";
import { BOUNCE_TYPES, type Bounce } from "../../state/types.ts";
import { formatTimestamp } from "../../time.ts";

/**
 * A bounce in doc field order (refs/api_bounce-api.md:155-176, 247-270). A list item has a `Z`
 * `BouncedAt` and no `Content`; a single bounce has an Eastern offset and `Content` (Q12).
 */
export const bounceJson = (b: Bounce, now: Date, shape: "list" | "single") => ({
  ID: b.ID,
  Type: b.Type,
  TypeCode: BOUNCE_TYPES[b.Type].TypeCode,
  Name: BOUNCE_TYPES[b.Type].Name,
  Tag: b.Tag,
  MessageID: b.MessageID,
  ServerID: b.ServerID,
  MessageStream: b.MessageStream,
  Description: b.Description,
  Details: b.Details,
  Email: b.Email,
  From: b.From,
  BouncedAt: formatTimestamp(b.BouncedAt, shape === "list" ? "utc" : "eastern"),
  DumpAvailable: dumpAvailable(b, now),
  Inactive: b.Inactive,
  CanActivate: b.CanActivate,
  Subject: b.Subject,
  ...(shape === "single" && { Content: b.Content }),
});
