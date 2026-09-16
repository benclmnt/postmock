import { z } from "zod";
import { apiError } from "../../errors.ts";
import { parseBody } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import type { Store } from "../../state/store.ts";
import { SERVER_COLORS, type Server } from "../../state/types.ts";

const TRACK_LINKS = ["None", "HtmlAndText", "HtmlOnly", "TextOnly"] as const;
const HOOK_FIELDS = [
  "InboundHookUrl",
  "BounceHookUrl",
  "OpenHookUrl",
  "DeliveryHookUrl",
  "ClickHookUrl",
] as const;

// `null` means "leave as is": dotnet drops null keys, java and php send them (docs/08 R9).
// An empty hook URL clears it, so `absent` (which also drops `""`) does not apply to hook URLs.
const keep = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (v === null ? undefined : v), schema.optional());

// refs/api_server-api.md:115-134 (docs/06 §4.1). Unknown and read-only keys are dropped (docs/08 R12).
const editSchema = z.object({
  Name: keep(z.string()),
  Color: keep(z.string()),
  RawEmailEnabled: keep(z.boolean()),
  SmtpApiActivated: keep(z.boolean()),
  InboundHookUrl: keep(z.string()),
  BounceHookUrl: keep(z.string()),
  OpenHookUrl: keep(z.string()),
  DeliveryHookUrl: keep(z.string()),
  ClickHookUrl: keep(z.string()),
  PostFirstOpenOnly: keep(z.boolean()),
  TrackOpens: keep(z.boolean()),
  TrackLinks: keep(z.string()),
  InboundDomain: keep(z.string()),
  InboundSpamThreshold: keep(z.number()),
  IncludeBounceContentInHook: keep(z.boolean()),
  EnableSmtpApiErrorHooks: keep(z.boolean()),
});

const isHookUrl = (value: string): boolean => {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Applies a `PUT /server` body (and the same body of `PUT /servers/{id}`) to `server`.
 * Validates every field before it changes one, so a rejected edit changes nothing.
 */
export function editServer(store: Store, server: Server, body: unknown): Server {
  if (body === undefined) throw apiError(609);
  const parsed = parseBody(editSchema, body);
  // The error for a wrongly typed field is not captured (AGENTS.md rule 5).
  if (!parsed.success)
    throw new Unsupported(`server edit with a wrongly typed field: ${parsed.error.message}`);
  const edit = parsed.data;

  const others = [...store.state.servers.values()].filter((s) => s.ID !== server.ID);
  if (edit.Name !== undefined) {
    // 608 text INFERRED from the docs/02 §4.4 summary.
    if (edit.Name.trim() === "")
      throw apiError(608, { message: "Server name is invalid or missing." });
    if (others.some((s) => s.Name.toLowerCase() === edit.Name?.toLowerCase())) throw apiError(603);
  }
  const color = SERVER_COLORS.find((c) => c === edit.Color?.toLowerCase());
  if (edit.Color !== undefined && color === undefined) throw apiError(607);
  for (const field of HOOK_FIELDS) {
    const value = edit[field];
    // 606 text INFERRED from the docs/02 §4.4 summary.
    if (value !== undefined && !isHookUrl(value)) {
      throw apiError(606, { message: `The supplied ${field} is not valid.` });
    }
  }
  const threshold = edit.InboundSpamThreshold;
  if (
    threshold !== undefined &&
    !(Number.isInteger(threshold) && threshold >= 0 && threshold <= 30)
  ) {
    throw apiError(611);
  }
  const trackLinks = TRACK_LINKS.find((t) => t === edit.TrackLinks);
  if (edit.TrackLinks !== undefined && trackLinks === undefined) throw apiError(612);
  const domain = edit.InboundDomain?.toLowerCase();
  if (domain !== undefined && domain !== "") {
    if (domain.includes("postmarkapp.com")) {
      throw apiError(608, {
        message: "An inbound domain containing postmarkapp.com cannot be used.",
      });
    }
    if (others.some((s) => s.InboundDomain.toLowerCase() === domain)) throw apiError(602);
    // The MX check (610) needs DNS; postmock treats the MX record as present (INFERRED).
  }

  const { Color: _color, TrackLinks: _trackLinks, ...rest } = edit;
  const changes: Partial<Server> = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  );
  Object.assign(server, changes, {
    ...(color !== undefined && { Color: color }),
    ...(trackLinks !== undefined && { TrackLinks: trackLinks }),
  });
  return server;
}
