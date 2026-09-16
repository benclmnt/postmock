import { z } from "zod";
import { ApiError, apiError, type ErrorBody } from "../../errors.ts";
import { absent, parseBody, queryInt } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import { defineRoute, type RequestContext, type ServerAuth } from "../../http/routes.ts";
import type { OutboundDraft } from "../../pipeline/submit.ts";
import { submitOutbound } from "../../pipeline/submit.ts";
import { newMessageId } from "../../state/ids.ts";
import { findStream, type TestTokenContext } from "../../state/servers.ts";
import type { State } from "../../state/store.ts";
import type { BulkRequest, Template } from "../../state/types.ts";
import { formatTimestamp } from "../../time.ts";
import { renderContent } from "../templates/content.ts";
import {
  type Content,
  invalidField,
  nullable,
  sendTemplate,
  templateIdField,
  templateModelField,
} from "../templates/templates.ts";
import { type BulkJob, bulkStatusJson, scheduleBulk } from "./bulk.ts";

// Bulk API (docs/03 §1.6; refs/api_bulk-email.md). Not in the Swagger spec.

/** 422 / 14 on all three endpoints until the account is approved (refs/api_bulk-email.md:411-420). */
function requireBulkApproval(state: State): void {
  if (!state.account.bulkApiEnabled) {
    throw apiError(14, {
      message:
        "This endpoint requires approval to access. Contact support to use the Bulk API postmarkapp.com/contact",
    });
  }
}

const header = z.object({ Name: z.string(), Value: z.unknown().optional() });
const metadata = nullable(z.record(z.string(), z.unknown()));
const headers = nullable(z.array(header));
const passed = z.unknown().optional();

const bulkMessage = z.object({
  To: passed,
  Cc: passed,
  Bcc: passed,
  TemplateModel: templateModelField,
  Metadata: metadata,
  Headers: headers,
});

const bulkBody = z.object({
  From: passed,
  ReplyTo: passed,
  Subject: absent(z.string()),
  HtmlBody: absent(z.string()),
  TextBody: absent(z.string()),
  TemplateId: templateIdField,
  TemplateAlias: absent(z.string()),
  InlineCss: absent(z.boolean()),
  Tag: passed,
  Metadata: metadata,
  MessageStream: absent(z.string()),
  TrackOpens: passed,
  TrackLinks: passed,
  Attachments: passed,
  Headers: headers,
  Messages: z.array(bulkMessage),
});

/** Message-level headers replace request-level headers of the same name (refs/api_bulk-email.md:85, :92). */
type RawHeader = z.output<typeof header>;

function mergeHeaders(request: RawHeader[] | undefined, message: RawHeader[] | undefined) {
  if (request === undefined) return message;
  const names = new Set((message ?? []).map((h) => h.Name.toLowerCase()));
  return [...request.filter((h) => !names.has(h.Name.toLowerCase())), ...(message ?? [])];
}

/** The field a pipeline error names: `Invalid 'To' address: 'x'.` → `To` (refs/api_bulk-email.md:217-230). */
function errorField(error: ErrorBody): string {
  const field = /'([A-Za-z]+)'/.exec(error.Message)?.[1];
  if (field === undefined) {
    throw new Unsupported(`the bulk 'Errors' key for ErrorCode ${error.ErrorCode} is not captured`);
  }
  return field;
}

/**
 * Validates every message before any is accepted: one malformed field rejects the request with its
 * own code, several with ErrorCode 11 and an `Errors` map (refs/api_bulk-email.md:185, :213-231, :406-407).
 * The pipeline validates without storing when it sees a test context; this one holds the real server
 * and its streams. Suppressions are not malformed fields (refs/api_bulk-email.md:185).
 */
async function checkMessages(ctx: RequestContext, auth: ServerAuth, drafts: OutboundDraft[]) {
  const dryRun: TestTokenContext = {
    kind: "test",
    server: auth.server,
    streams: [...ctx.store.state.streams.values()].filter((s) => s.ServerID === auth.server.ID),
  };
  const errors = new Map<string, ErrorBody>();
  for (const draft of drafts) {
    const result = await submitOutbound(ctx, {
      auth: dryRun,
      channel: "rest",
      draft,
      request: null,
      bulkRequestId: null,
      templateId: null,
    });
    if (result.outcome !== "rejected" || result.error.ErrorCode === 406) continue;
    errors.set(`${result.error.ErrorCode}/${result.error.Message}`, result.error);
  }
  const found = [...errors.values()];
  const [only] = found;
  if (only === undefined) return;
  // Every send rejection is HTTP 422 (docs/03 §3.1).
  if (found.length === 1) throw new ApiError(422, only);
  const Errors: Record<string, ErrorBody[]> = {};
  for (const error of found) {
    const field = errorField(error);
    Errors[field] = [...(Errors[field] ?? []), error];
  }
  throw apiError(11, {
    message: "Multiple errors occurred. Inspect the Errors property for more information.",
    extra: { Errors },
  });
}

defineRoute({
  method: "POST",
  path: "/email/bulk",
  auth: "server",
  handler: async (ctx) => {
    const { store, auth } = ctx;
    const { state } = store;
    requireBulkApproval(state);
    const parsed = parseBody(bulkBody, ctx.body ?? {});
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path ?? [];
      throw invalidField(String(path.findLast((p) => typeof p === "string")));
    }
    const input = parsed.data;
    if (input.Messages.length === 0) throw new Unsupported("a bulk request with no Messages");

    const templated = input.TemplateId !== undefined || input.TemplateAlias !== undefined;
    let content: Content = {
      Subject: input.Subject ?? null,
      HtmlBody: input.HtmlBody ?? null,
      TextBody: input.TextBody ?? null,
    };
    let layout: Template | null = null;
    let templateId: number | null = null;
    if (templated) {
      // Content beside a template: 1123, as on /email/withTemplate (INFERRED).
      if (Object.values(content).some((v) => v !== null)) {
        throw apiError(1123, {
          message: "Subject, HtmlBody and TextBody cannot be used when sending with a template.",
        });
      }
      const sent = sendTemplate(state, auth.server.ID, input);
      content = sent.template;
      templateId = sent.template.TemplateId;
      layout = sent.layout;
    }

    // Absent: the default broadcast stream (refs/api_bulk-email.md:81; docs/04 Q7 for its ID).
    const streamId = input.MessageStream ?? "broadcast";
    const stream = findStream(state, auth, streamId);
    if (stream === undefined) throw apiError(1226, { family: "streams" });
    if (stream.MessageStreamType !== "Broadcasts") {
      throw new Unsupported(`bulk sends on a ${stream.MessageStreamType} stream are not captured`);
    }

    // Body keys arrive in any case (docs/08 R8); `request` keeps each entry as sent.
    const rawMessages = Object.entries(ctx.body as Record<string, unknown>).find(
      ([key]) => key.toLowerCase() === "messages",
    )?.[1] as unknown[];
    const jobs: BulkJob[] = input.Messages.map((message, i) => {
      // Message-level metadata keys win over request-level keys (INFERRED per key).
      const Metadata =
        input.Metadata === undefined && message.Metadata === undefined
          ? undefined
          : { ...input.Metadata, ...message.Metadata };
      const rendered = renderContent(
        content,
        layout,
        message.TemplateModel ?? {},
        input.InlineCss ?? true,
      );
      const body = rendered.ok ? rendered.content : content;
      const draft: OutboundDraft = {
        From: input.From,
        To: message.To,
        Cc: message.Cc,
        Bcc: message.Bcc,
        ReplyTo: input.ReplyTo,
        Subject: body.Subject ?? undefined,
        HtmlBody: body.HtmlBody ?? undefined,
        TextBody: body.TextBody ?? undefined,
        Tag: input.Tag,
        MessageStream: streamId,
        Headers: mergeHeaders(input.Headers, message.Headers),
        Attachments: input.Attachments,
        Metadata,
        TrackOpens: input.TrackOpens,
        TrackLinks: input.TrackLinks,
      };
      return { draft, rendered, request: rawMessages[i] };
    });
    // Validation sees the source content, so a render failure stays a FailedCount (refs/api_bulk-email.md:185).
    await checkMessages(
      ctx,
      auth,
      jobs.map((job) => ({
        ...job.draft,
        Subject: content.Subject ?? undefined,
        HtmlBody: content.HtmlBody ?? undefined,
        TextBody: content.TextBody ?? undefined,
      })),
    );

    const bulk: BulkRequest = {
      Id: newMessageId(),
      ServerID: auth.server.ID,
      SubmittedAt: ctx.clock.now(),
      Status: "Accepted",
      TotalMessages: jobs.length,
      PercentageCompleted: 0,
      ReleasedCount: 0,
      FailedCount: 0,
      // A templated request has no request Subject, so the key is omitted (INFERRED).
      Subject: input.Subject ?? null,
      messageIds: [],
    };
    state.bulkRequests.set(bulk.Id, bulk);
    scheduleBulk(ctx, auth, bulk, jobs, templateId);
    // The dotnet live test reads TotalMessages from the POST answer, so it is the full status
    // object (sdk/postmark-dotnet/src/Postmark.Tests/ClientBulkSendingTests.cs:51-54).
    return bulkStatusJson(bulk);
  },
});

/** Another server's request is 404 / 12 like an unknown one (refs/api_bulk-email.md:427-429). */
defineRoute({
  method: "GET",
  path: "/email/bulk/:id",
  auth: "server",
  handler: ({ store, params, auth }) => {
    requireBulkApproval(store.state);
    const bulk = store.state.bulkRequests.get(params.id ?? "");
    if (bulk === undefined || bulk.ServerID !== auth.server.ID) throw apiError(12);
    return bulkStatusJson(bulk);
  },
});

// PaginationKey: unpadded base64 of the next page's first request, like the doc example
// `{"SubmittedAt":…}` (refs/api_bulk-email.md:380, :395). postmock adds its Id and uses the URL-safe
// alphabet, so the key needs no escaping in a query string (INFERRED).
const encodeKey = (bulk: BulkRequest) =>
  Buffer.from(
    JSON.stringify({ SubmittedAt: formatTimestamp(bulk.SubmittedAt, "utc"), Id: bulk.Id }),
  ).toString("base64url");

defineRoute({
  method: "GET",
  path: "/email/bulk",
  auth: "server",
  handler: ({ store, query, auth }) => {
    requireBulkApproval(store.state);
    const paging = query.pick(z.object({ count: queryInt }));
    // docs/03 Q20: the count default and range are not documented.
    if (!paging.success || paging.data.count < 1 || paging.data.count > 500) {
      throw new Unsupported(
        "GET /email/bulk needs a count from 1 to 500; other values are not captured",
      );
    }
    const requests = [...store.state.bulkRequests.values()]
      .filter((b) => b.ServerID === auth.server.ID)
      .reverse()
      .sort((a, b) => b.SubmittedAt.getTime() - a.SubmittedAt.getTime());
    const key = query.get("paginationKey");
    let start = 0;
    if (key !== undefined) {
      start = requests.findIndex((b) => encodeKey(b) === key);
      if (start === -1) throw apiError(13);
    }
    const page = requests.slice(start, start + paging.data.count);
    const next = requests[start + paging.data.count];
    return {
      Requests: page.map(bulkStatusJson),
      ...(next !== undefined && { PaginationKey: encodeKey(next) }),
    };
  },
});
