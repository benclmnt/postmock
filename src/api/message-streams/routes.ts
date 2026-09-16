import { z } from "zod";
import { apiError } from "../../errors.ts";
import { absent, parseBody, queryBool } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import { defineRoute, type RequestContext, type ServerAuth } from "../../http/routes.ts";
import { streamKey } from "../../state/store.ts";
import type {
  MessageStream,
  MessageStreamType,
  UnsubscribeHandlingType,
} from "../../state/types.ts";
import { formatTimestamp } from "../../time.ts";
import { isPurged, liveStream, PURGE_DELAY_MS, streamJson } from "./streams.ts";

// Message Streams API: docs/04 §4. Error texts come from the docs/02 §4.4 table.

const MAX_STREAMS = 10; // refs/api_message-streams-api.md:4
/** Default streams that cannot be archived (refs/api_overview.md:136). */
const UNARCHIVABLE = new Set(["outbound", "inbound"]);

type Ctx = RequestContext & { auth: ServerAuth };

/** 1220 when the account has no Message Streams API access (docs/04 §4.4). */
function streamsOf(ctx: Ctx): MessageStream[] {
  if (!ctx.store.state.account.messageStreamsApiEnabled) throw apiError(1220);
  const now = ctx.clock.now();
  return [...ctx.store.state.streams.values()].filter(
    (s) => s.ServerID === ctx.auth.server.ID && !isPurged(s, now),
  );
}

function streamOf(ctx: Ctx): MessageStream {
  streamsOf(ctx);
  return liveStream(ctx.store.state, ctx.auth.server.ID, ctx.params.id as string, ctx.clock.now());
}

/** Enum text matched without case, stored in doc case (INFERRED, like query keys: docs/08 R3). */
const oneOf = <T extends string>(values: readonly T[], text: string): T | undefined =>
  values.find((v) => v.toLowerCase() === text.toLowerCase());

const STREAM_TYPES = ["Transactional", "Broadcasts", "Inbound"] as const;
const HANDLING_TYPES = ["None", "Postmark", "Custom"] as const;

defineRoute({
  method: "GET",
  path: "/message-streams",
  auth: "server",
  handler: (ctx) => {
    const typeText = ctx.query.get("MessageStreamType") ?? "All";
    const type = oneOf(["All", ...STREAM_TYPES], typeText);
    if (type === undefined) throw apiError(1221);
    const archived = queryBool.safeParse(ctx.query.get("IncludeArchivedStreams") ?? "false");
    if (!archived.success) throw new Unsupported("invalid IncludeArchivedStreams: not captured");
    // count and offset are accepted and ignored (docs/08 R6).
    const streams = streamsOf(ctx).filter(
      (s) =>
        (type === "All" || s.MessageStreamType === type) &&
        (archived.data || s.ArchivedAt === null),
    );
    return { MessageStreams: streams.map(streamJson), TotalCount: streams.length };
  },
});

defineRoute({
  method: "GET",
  path: "/message-streams/:id",
  auth: "server",
  handler: (ctx) => streamJson(streamOf(ctx)),
});

const handlingSchema = z
  .object({ UnsubscribeHandlingType: absent(z.string()) })
  .nullable()
  .optional();

/**
 * The checked `UnsubscribeHandlingType` for a stream type (1238–1240). Broadcasts require
 * unsubscribe management (refs/api_message-streams-api.md:50); a Transactional or Inbound stream
 * with `Postmark` or `Custom` is not captured.
 */
function handlingType(
  ctx: Ctx,
  streamType: MessageStreamType,
  text: string | undefined,
): UnsubscribeHandlingType {
  if (text === undefined) return streamType === "Broadcasts" ? "Postmark" : "None";
  const value = oneOf(HANDLING_TYPES, text);
  if (value === undefined) throw apiError(1240);
  if (value === "Custom" && !ctx.store.state.account.customUnsubscribeEnabled) throw apiError(1238);
  if (streamType === "Broadcasts" && value === "None") throw apiError(1239);
  if (streamType !== "Broadcasts" && value !== "None") {
    throw new Unsupported(
      `UnsubscribeHandlingType ${value} on a ${streamType} stream: not captured`,
    );
  }
  return value;
}

/** 1234: HTML in a description (tag rule INFERRED). Length limits (1224, 1231) are not documented. */
function checkDescription(description: string | undefined): void {
  if (description !== undefined && /<\/?[a-z!][^>]*>/i.test(description)) throw apiError(1234);
}

const createSchema = z.object({
  ID: z.unknown(),
  Name: absent(z.string()),
  Description: absent(z.string()),
  MessageStreamType: absent(z.string()),
  SubscriptionManagementConfiguration: handlingSchema,
});

defineRoute({
  method: "POST",
  path: "/message-streams",
  auth: "server",
  handler: (ctx) => {
    const streams = streamsOf(ctx);
    const parsed = parseBody(createSchema, ctx.body ?? {});
    if (!parsed.success) throw new Unsupported("malformed stream body: error not captured");
    const body = parsed.data;
    const id = body.ID;
    if (typeof id !== "string" || id === "") throw apiError(1222);
    if (id.toLowerCase().startsWith("pm-")) throw apiError(1233);
    // Allowed characters after the first letter are INFERRED.
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,29}$/.test(id)) throw apiError(1227);
    if (body.Name === undefined) throw apiError(1223);
    checkDescription(body.Description);
    const type = oneOf(STREAM_TYPES, body.MessageStreamType ?? "");
    if (type === "Inbound") throw apiError(1228); // every server has its inbound stream
    if (type === undefined) throw apiError(1221);
    if (streams.some((s) => s.ID.toLowerCase() === id.toLowerCase())) throw apiError(1230);
    if (streams.length >= MAX_STREAMS) throw apiError(1225);
    const handling = handlingType(
      ctx,
      type,
      body.SubscriptionManagementConfiguration?.UnsubscribeHandlingType,
    );
    const stream: MessageStream = {
      ID: id,
      ServerID: ctx.auth.server.ID,
      Name: body.Name,
      Description: body.Description ?? null,
      MessageStreamType: type,
      CreatedAt: ctx.clock.now(),
      UpdatedAt: null,
      ArchivedAt: null,
      ExpectedPurgeDate: null,
      SubscriptionManagementConfiguration: { UnsubscribeHandlingType: handling },
    };
    // A purged stream with this ID is replaced (INFERRED).
    ctx.store.state.streams.set(streamKey(stream.ServerID, id), stream);
    return streamJson(stream);
  },
});

const editSchema = z.object({
  Name: absent(z.string()),
  Description: absent(z.string()),
  SubscriptionManagementConfiguration: handlingSchema,
});

// java sends the whole stream object; only these three fields change (docs/04 §4.1).
defineRoute({
  method: "PATCH",
  path: "/message-streams/:id",
  auth: "server",
  handler: (ctx) => {
    const stream = streamOf(ctx);
    const parsed = parseBody(editSchema, ctx.body ?? {});
    if (!parsed.success) throw new Unsupported("malformed stream body: error not captured");
    const body = parsed.data;
    checkDescription(body.Description);
    const text = body.SubscriptionManagementConfiguration?.UnsubscribeHandlingType;
    const handling =
      text === undefined
        ? stream.SubscriptionManagementConfiguration.UnsubscribeHandlingType
        : handlingType(ctx, stream.MessageStreamType, text);
    if (body.Name !== undefined) stream.Name = body.Name;
    if (body.Description !== undefined) stream.Description = body.Description;
    stream.SubscriptionManagementConfiguration = { UnsubscribeHandlingType: handling };
    stream.UpdatedAt = ctx.clock.now();
    return streamJson(stream);
  },
});

// Archive and unarchive accept an empty body and `{}` (docs/04 §6); the body is not read.
defineRoute({
  method: "POST",
  path: "/message-streams/:id/archive",
  auth: "server",
  handler: (ctx) => {
    const stream = streamOf(ctx);
    if (UNARCHIVABLE.has(stream.ID)) throw apiError(1229);
    if (stream.ArchivedAt !== null)
      throw new Unsupported("archive of an archived stream: not captured");
    const now = ctx.clock.now();
    stream.ArchivedAt = now;
    stream.ExpectedPurgeDate = new Date(now.getTime() + PURGE_DELAY_MS);
    // ID string and ServerID integer (docs/04 §4.2 disagreements; dotnet reads int ServerID).
    return {
      ID: stream.ID,
      ServerID: stream.ServerID,
      ExpectedPurgeDate: formatTimestamp(stream.ExpectedPurgeDate),
    };
  },
});

defineRoute({
  method: "POST",
  path: "/message-streams/:id/unarchive",
  auth: "server",
  handler: (ctx) => {
    streamsOf(ctx);
    const stream = ctx.store.state.streams.get(
      streamKey(ctx.auth.server.ID, ctx.params.id as string),
    );
    if (stream === undefined) throw apiError(1226, { family: "streams" });
    if (isPurged(stream, ctx.clock.now())) throw apiError(1232);
    if (stream.ArchivedAt === null)
      throw new Unsupported("unarchive of an active stream: not captured");
    stream.ArchivedAt = null;
    stream.ExpectedPurgeDate = null;
    return streamJson(stream);
  },
});
