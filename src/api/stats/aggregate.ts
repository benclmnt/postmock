import type { StatsFact } from "../../state/types.ts";
import { formatEasternDate } from "../../time.ts";

// Stats API bodies from recorded facts (docs/06 §2.2). Days are Eastern dates
// (refs/api_stats-api.md:4). A day with no count is left out, and so is a zero key inside a day
// (:121, :216-218). Totals always carry the documented keys, 0 included: the postmark.js live tests
// read `Sent`, `Tracked` and `Clicks` on an empty server
// (sdk/postmark.js/test/integration/MessageStatistics.test.ts:24, :39; ClickStatistics.test.ts:15).

type Fact<K extends StatsFact["kind"]> = Extract<StatsFact, { kind: K }>;
export type Count = { at: Date; key: string };

export const ofKind = <K extends StatsFact["kind"]>(facts: StatsFact[], kind: K): Fact<K>[] =>
  facts.filter((f): f is Fact<K> => f.kind === kind);

/** `{Days: [{Date, <key>: n}], <key>: total}`, days ascending. */
export function series(counts: Count[], documentedKeys: readonly string[]) {
  const days = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>(documentedKeys.map((k) => [k, 0]));
  for (const { at, key } of counts) {
    const date = formatEasternDate(at);
    const day = days.get(date) ?? new Map<string, number>();
    days.set(date, day);
    day.set(key, (day.get(key) ?? 0) + 1);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return {
    Days: [...days.keys()].sort().map((date) => ({
      Date: date,
      ...Object.fromEntries(days.get(date) as Map<string, number>),
    })),
    ...Object.fromEntries(totals),
  };
}

/** Facts in time order, the first of each identity marked. */
function firsts<F extends StatsFact>(facts: F[], identity: (fact: F) => string) {
  const seen = new Set<string>();
  return [...facts]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((fact) => {
      const id = identity(fact);
      const first = !seen.has(id);
      seen.add(id);
      return { fact, first };
    });
}

// "Unique" opens are per recipient per message; unique clicks per recipient, message and link
// (refs/api_stats-api.md:419, :648). A unique count lands on the day of the first event in range.
const openIdentity = (o: Fact<"open">) => `${o.MessageID}/${o.Recipient.toLowerCase()}`;
const clickIdentity = (c: Fact<"click">) => `${c.MessageID}/${c.Recipient.toLowerCase()}/${c.link}`;

export const uniqueOpens = (facts: StatsFact[]) =>
  firsts(ofKind(facts, "open"), openIdentity)
    .filter((o) => o.first)
    .map((o) => o.fact);

export const opensCounts = (facts: StatsFact[]): Count[] =>
  firsts(ofKind(facts, "open"), openIdentity).flatMap(({ fact, first }) => [
    { at: fact.at, key: "Opens" },
    ...(first ? [{ at: fact.at, key: "Unique" }] : []),
  ]);

export const clicksCounts = (facts: StatsFact[]): Count[] =>
  firsts(ofKind(facts, "click"), clickIdentity).flatMap(({ fact, first }) => [
    { at: fact.at, key: "Clicks" },
    ...(first ? [{ at: fact.at, key: "Unique" }] : []),
  ]);

const rate = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 100 * 1000) / 1000;

/**
 * `/stats/outbound` (refs/api_stats-api.md:43-83). The example's arithmetic gives the rules:
 * `Bounced` is hard + soft + transient without SMTP API errors (64 = 12 + 36 + 16, :209-232), and
 * rates are percentages of `Sent` to 3 decimals (10.406 = 64 / 615). `WithReadTimeRecorded` comes
 * from the SDK models (sdk/postmark.js/src/client/models/stats/Stats.ts:18). The `With*Recorded`
 * keys count unique opens (INFERRED).
 */
export function overview(facts: StatsFact[]) {
  const sent = ofKind(facts, "sent");
  const bounces = ofKind(facts, "bounce");
  const Sent = sent.length;
  const Bounced = bounces.filter((b) => b.type !== "SMTPApiError").length;
  const SpamComplaints = ofKind(facts, "spamComplaint").length;
  const opens = uniqueOpens(facts);
  const clicks = clicksCounts(facts);
  return {
    Sent,
    Bounced,
    SMTPApiErrors: bounces.length - Bounced,
    BounceRate: rate(Bounced, Sent),
    SpamComplaints,
    SpamComplaintsRate: rate(SpamComplaints, Sent),
    Opens: ofKind(facts, "open").length,
    UniqueOpens: opens.length,
    Tracked: sent.filter((s) => s.openTracking || s.linkTracking).length,
    WithLinkTracking: sent.filter((s) => s.linkTracking).length,
    WithOpenTracking: sent.filter((s) => s.openTracking).length,
    TotalTrackedLinksSent: sent.reduce((sum, s) => sum + s.trackedLinks, 0),
    UniqueLinksClicked: clicks.filter((c) => c.key === "Unique").length,
    TotalClicks: clicks.filter((c) => c.key === "Clicks").length,
    WithClientRecorded: opens.filter((o) => o.client !== null).length,
    WithPlatformRecorded: opens.filter((o) => o.platform !== null && o.platform !== "Unknown")
      .length,
    WithReadTimeRecorded: opens.filter((o) => o.readSeconds > 0).length,
  };
}
