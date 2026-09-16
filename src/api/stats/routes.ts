import { apiError } from "../../errors.ts";
import { parseQueryDate } from "../../http/normalize.ts";
import { defineRoute, type RequestContext, type ServerAuth } from "../../http/routes.ts";
import { findStream } from "../../state/servers.ts";
import type { StatsFact } from "../../state/types.ts";
import { formatEasternDate } from "../../time.ts";
import {
  type Count,
  clicksCounts,
  ofKind,
  opensCounts,
  overview,
  series,
  uniqueOpens,
} from "./aggregate.ts";

// Stats API (docs/06 §2). Paths match without case, so `emailClients` and `browserFamilies`
// (postmark.js) reach the doc paths (docs/08 §2.5).

type Ctx = RequestContext & { auth: ServerAuth };

/**
 * The server's facts that pass `tag`, `messagestream` (default: every stream) and the inclusive
 * Eastern `fromdate`/`todate` days (refs/api_stats-api.md:34-37). Errors: refs/api_overview.md:197-201.
 */
function facts({ store, clock, auth, query }: Ctx): StatsFact[] {
  const day = (name: "fromdate" | "todate") => {
    const raw = query.get(name);
    if (raw === undefined) return undefined;
    const parsed = parseQueryDate(raw);
    if (parsed === undefined) throw apiError(900, { family: "stats" });
    return formatEasternDate(parsed.instant);
  };
  const from = day("fromdate");
  const to = day("todate");
  const yearAgo = clock.now();
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  if (from !== undefined && from < formatEasternDate(yearAgo)) {
    throw apiError(1500, { family: "stats" });
  }
  if (from !== undefined && to !== undefined && from > to) {
    throw apiError(1502, { family: "stats" });
  }
  const stream = query.get("messagestream");
  if (stream !== undefined && findStream(store.state, auth, stream) === undefined) {
    throw apiError(1226, { family: "stats" });
  }
  const tag = query.get("tag");
  return store.state.stats.filter((f) => {
    const date = formatEasternDate(f.at);
    return (
      f.ServerID === auth.server.ID &&
      (stream === undefined || f.MessageStream === stream) &&
      (tag === undefined || f.Tag === tag) &&
      (from === undefined || date >= from) &&
      (to === undefined || date <= to)
    );
  });
}

const stat = (path: string, body: (facts: StatsFact[]) => unknown) =>
  defineRoute({
    method: "GET",
    path: `/stats/outbound${path}`,
    auth: "server",
    handler: (ctx) => body(facts(ctx)),
  });

const each = <F extends StatsFact>(facts: F[], key: (fact: F) => string | null): Count[] =>
  facts.flatMap((f) => {
    const k = key(f);
    return k === null ? [] : [{ at: f.at, key: k }];
  });

stat("", overview);

stat("/sends", (f) =>
  series(
    each(ofKind(f, "sent"), () => "Sent"),
    ["Sent"],
  ),
);

stat("/bounces", (f) =>
  series(
    each(ofKind(f, "bounce"), (b) => b.type),
    ["HardBounce", "SMTPApiError", "SoftBounce", "Transient"],
  ),
);

stat("/spam", (f) =>
  series(
    each(ofKind(f, "spamComplaint"), () => "SpamComplaint"),
    ["SpamComplaint"],
  ),
);

stat("/tracked", (f) =>
  series(
    each(ofKind(f, "sent"), (s) => (s.openTracking || s.linkTracking ? "Tracked" : null)),
    ["Tracked"],
  ),
);

stat("/opens", (f) => series(opensCounts(f), ["Opens", "Unique"]));

// Platforms and email clients count unique opens; an open without a platform is `Unknown`
// (INFERRED from "users that opened", refs/api_stats-api.md:500-503).
stat("/opens/platforms", (f) =>
  series(
    each(uniqueOpens(f), (o) => o.platform ?? "Unknown"),
    ["Desktop", "Mobile", "Unknown", "WebMail"],
  ),
);

stat("/opens/emailclients", (f) =>
  series(
    each(uniqueOpens(f), (o) => o.client),
    [],
  ),
);

// No doc gives this body. Its shape comes from the SDK clients (docs/06 §2.2). No source names the
// buckets: postmock keys each unique open with a read time by its whole seconds, "5" (INFERRED).
stat("/opens/readtimes", (f) =>
  series(
    each(uniqueOpens(f), (o) => (o.readSeconds > 0 ? String(o.readSeconds) : null)),
    [],
  ),
);

stat("/clicks", (f) => series(clicksCounts(f), ["Clicks", "Unique"]));

// Browser, platform and location keys count every click (refs/api_stats-api.md:729, :800-802).
stat("/clicks/browserfamilies", (f) =>
  series(
    each(ofKind(f, "click"), (c) => c.browser),
    [],
  ),
);

stat("/clicks/platforms", (f) =>
  series(
    each(ofKind(f, "click"), (c) => c.platform ?? "Unknown"),
    ["Desktop", "Mobile", "Unknown"],
  ),
);

stat("/clicks/location", (f) =>
  series(
    each(ofKind(f, "click"), (c) => c.location),
    ["HTML", "Text"],
  ),
);
