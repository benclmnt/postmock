import { apiError } from "../../errors.ts";
import type { Query } from "../../http/normalize.ts";
import { paged, Unsupported } from "../../http/respond.ts";
import { defineRoute, type RequestContext, type ServerAuth } from "../../http/routes.ts";
import { parseAddressList } from "../../pipeline/addresses.ts";
import { recipientsOf } from "../../recipients/transitions.ts";
import { findStream } from "../../state/servers.ts";
import type {
  ClickEvent,
  InboundMessage,
  InboundStatus,
  OpenEvent,
  OutboundMessage,
  OutboundStatus,
} from "../../state/types.ts";
import {
  clickJson,
  inboundDetailsJson,
  inboundJson,
  openJson,
  outboundDetailsJson,
  outboundJson,
} from "./json.ts";
import { dateRange, paging, retained, sameText, status } from "./query.ts";

// Messages API (docs/06 §1, §5). Every read sees only the authenticated server's data within the
// retention window. Lists are newest first (INFERRED).

type Ctx = RequestContext & { auth: ServerAuth };

const newestFirst = <T extends { ReceivedAt: Date }>(items: T[]) =>
  items.sort((a, b) => b.ReceivedAt.getTime() - a.ReceivedAt.getTime());

// 701 is a summary row; the SDK live test expects "not found" in the text
// (sdk/postmark.js/test/integration/Messages.test.ts:43-47). The exact text is INFERRED.
const notFound = () => apiError(701, { message: "This message was not found." });

/** An optional filter; each present value must match. */
const filter = (query: Query, name: string, matches: (value: string) => boolean) => {
  const value = query.get(name);
  return value === undefined || matches(value);
};

// Subject matches as a substring without case: the dotnet live test asserts that shape
// (sdk/postmark-dotnet/src/Postmark.Tests/ClientMessageSearchingTests.cs:38-41). INFERRED otherwise.
const subjectMatches = (subject: string | null, wanted: string) =>
  (subject ?? "").toLowerCase().includes(wanted.toLowerCase());

const OUTBOUND_STATUS: Record<string, readonly OutboundStatus[]> = {
  queued: ["Queued"],
  // "sent and processed will return the same results" (refs/api_messages-api.md:39).
  sent: ["Sent", "Processed"],
  processed: ["Sent", "Processed"],
};

/**
 * `messagestream`, default `outbound` (refs/api_messages-api.md:43, :634, :853). Postmark's answer
 * for a stream the server lacks is not documented.
 */
function knownStream({ store, auth, query }: Ctx): string {
  const stream = query.get("messagestream") ?? "outbound";
  if (findStream(store.state, auth, stream) === undefined) {
    throw new Unsupported(`messagestream '${stream}' does not exist on this server`);
  }
  return stream;
}

function outboundMessage({ store, clock, auth, params }: Ctx): OutboundMessage {
  const message = store.state.outbound.get(params.id as string);
  if (
    message === undefined ||
    message.ServerID !== auth.server.ID ||
    !retained(message.ReceivedAt, clock.now())
  ) {
    throw notFound();
  }
  return message;
}

defineRoute({
  method: "GET",
  path: "/messages/outbound",
  auth: "server",
  handler: (ctx) => {
    const { store, clock, auth, query } = ctx;
    const { count, offset } = paging(query);
    const inRange = dateRange(query);
    const statuses = status(query, OUTBOUND_STATUS);
    const stream = knownStream(ctx);
    const metadata = Object.entries(query.prefixed("metadata_"));
    // "You can currently only search by a single metadata field at a time"
    // (refs/api_messages-api.md:44). Postmark's answer to two is not known.
    if (metadata.length > 1) throw new Unsupported("more than one metadata_ filter");
    const now = clock.now();
    const matches = [...store.state.outbound.values()].filter(
      (m) =>
        m.ServerID === auth.server.ID &&
        m.MessageStream === stream &&
        retained(m.ReceivedAt, now) &&
        inRange(m.ReceivedAt) &&
        (statuses === undefined || statuses.includes(m.Status)) &&
        filter(query, "recipient", (v) => recipientsOf(m).some((r) => sameText(r, v))) &&
        filter(query, "fromemail", (v) => sameText(parseAddressList(m.From)?.[0]?.Email, v)) &&
        filter(query, "tag", (v) => m.Tag === v) &&
        filter(query, "subject", (v) => subjectMatches(m.Subject, v)) &&
        metadata.every(([key, value]) => m.Metadata[key] === value),
    );
    return paged("Messages", newestFirst(matches).map(outboundJson), count, offset);
  },
});

defineRoute({
  method: "GET",
  path: "/messages/outbound/:id/details",
  auth: "server",
  handler: (ctx) => outboundDetailsJson(outboundMessage(ctx)),
});

defineRoute({
  method: "GET",
  path: "/messages/outbound/:id/dump",
  auth: "server",
  handler: (ctx) => ({ Body: outboundMessage(ctx).rawSource }),
});

const INBOUND_STATUS: Record<string, readonly InboundStatus[]> = {
  blocked: ["Blocked"],
  processed: ["Processed"],
  queued: ["Queued"],
  failed: ["Failed"],
  scheduled: ["Scheduled"],
  // postmark.js sends `sent` (sdk/postmark.js/src/client/models/messages/MessageFilteringParameters.ts:9-16).
  sent: ["Sent"],
};

function inboundMessage({ store, clock, auth, params }: Ctx): InboundMessage {
  const message = store.state.inbound.get(params.id as string);
  if (
    message === undefined ||
    message.ServerID !== auth.server.ID ||
    !retained(message.ReceivedAt, clock.now())
  ) {
    throw notFound();
  }
  return message;
}

defineRoute({
  method: "GET",
  path: "/messages/inbound",
  auth: "server",
  handler: ({ store, clock, auth, query }) => {
    const { count, offset } = paging(query);
    const inRange = dateRange(query);
    // "if no status is specified, only processed messages are returned" (refs/api_messages-api.md:315).
    const statuses = status(query, INBOUND_STATUS) ?? ["Processed"];
    const now = clock.now();
    const matches = [...store.state.inbound.values()].filter(
      (m) =>
        m.ServerID === auth.server.ID &&
        retained(m.ReceivedAt, now) &&
        inRange(m.ReceivedAt) &&
        statuses.includes(m.Status) &&
        filter(query, "recipient", (v) =>
          [
            m.OriginalRecipient,
            ...[...m.ToFull, ...m.CcFull, ...m.BccFull].map((a) => a.Email),
          ].some((r) => sameText(r, v)),
        ) &&
        filter(query, "fromemail", (v) => sameText(m.FromFull.Email, v)) &&
        filter(query, "tag", (v) => m.Tag === v) &&
        filter(query, "subject", (v) => subjectMatches(m.Subject, v)) &&
        filter(query, "mailboxhash", (v) => m.MailboxHash === v),
    );
    return paged("InboundMessages", newestFirst(matches).map(inboundJson), count, offset);
  },
});

defineRoute({
  method: "GET",
  path: "/messages/inbound/:id/details",
  auth: "server",
  handler: (ctx) => inboundDetailsJson(inboundMessage(ctx)),
});

// Opens and clicks (refs/api_messages-api.md:626-653, :835-853). Filter values match without case
// (INFERRED, docs/06 Q10).
function trackingFilters<E extends OpenEvent | ClickEvent>(ctx: Ctx, events: E[]): E[] {
  const { query, auth, clock } = ctx;
  const stream = knownStream(ctx);
  const now = clock.now();
  return events.filter(
    (e) =>
      e.ServerID === auth.server.ID &&
      e.MessageStream === stream &&
      retained(e.ReceivedAt, now) &&
      filter(query, "recipient", (v) => sameText(e.Recipient, v)) &&
      filter(query, "tag", (v) => e.Tag === v) &&
      filter(query, "client_name", (v) => sameText(e.Client?.Name, v)) &&
      filter(query, "client_company", (v) => sameText(e.Client?.Company, v)) &&
      filter(query, "client_family", (v) => sameText(e.Client?.Family, v)) &&
      filter(query, "os_name", (v) => sameText(e.OS?.Name, v)) &&
      filter(query, "os_family", (v) => sameText(e.OS?.Family, v)) &&
      filter(query, "os_company", (v) => sameText(e.OS?.Company, v)) &&
      filter(query, "platform", (v) => sameText(e.Platform, v)) &&
      filter(query, "country", (v) => sameText(e.Geo?.Country, v)) &&
      filter(query, "region", (v) => sameText(e.Geo?.Region, v)) &&
      filter(query, "city", (v) => sameText(e.Geo?.City, v)),
  );
}

/** Events of one message. Single-message reads take only `count` and `offset` (docs/06 §1.7). */
function ofMessage<E extends OpenEvent | ClickEvent>(ctx: Ctx, events: E[]): E[] {
  const message = outboundMessage(ctx);
  return events.filter((e) => e.MessageID === message.MessageID);
}

defineRoute({
  method: "GET",
  path: "/messages/outbound/opens",
  auth: "server",
  handler: (ctx) => {
    const { count, offset } = paging(ctx.query);
    const opens = newestFirst(trackingFilters(ctx, [...ctx.store.state.opens]));
    return paged(
      "Opens",
      opens.map((o) => openJson(o, false)),
      count,
      offset,
    );
  },
});

defineRoute({
  method: "GET",
  path: "/messages/outbound/opens/:id",
  auth: "server",
  handler: (ctx) => {
    const { count, offset } = paging(ctx.query);
    const opens = newestFirst(ofMessage(ctx, ctx.store.state.opens));
    return paged(
      "Opens",
      opens.map((o) => openJson(o, true)),
      count,
      offset,
    );
  },
});

defineRoute({
  method: "GET",
  path: "/messages/outbound/clicks",
  auth: "server",
  handler: (ctx) => {
    const { count, offset } = paging(ctx.query);
    const clicks = newestFirst(trackingFilters(ctx, [...ctx.store.state.clicks]));
    return paged(
      "Clicks",
      clicks.map((c) => clickJson(c, false)),
      count,
      offset,
    );
  },
});

defineRoute({
  method: "GET",
  path: "/messages/outbound/clicks/:id",
  auth: "server",
  handler: (ctx) => {
    const { count, offset } = paging(ctx.query);
    const clicks = newestFirst(ofMessage(ctx, ctx.store.state.clicks));
    return paged(
      "Clicks",
      clicks.map((c) => clickJson(c, true)),
      count,
      offset,
    );
  },
});
