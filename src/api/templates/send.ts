import { z } from "zod";
import { ApiError, apiError } from "../../errors.ts";
import { absent, intLike, objectOrEmptyArray } from "../../http/normalize.ts";
import type { RequestContext, ServerAuth } from "../../http/routes.ts";
import { type OutboundDraft, type SubmitResult, submitOutbound } from "../../pipeline/submit.ts";
import { formatTimestamp } from "../../time.ts";
import { renderContent } from "./content.ts";
import { activeLayout, activeTemplate, parseOrReject, templateNotFound } from "./templates.ts";

// `/email/withTemplate` and `/email/batchWithTemplates` (docs/03 §1.4–§1.5, docs/06 §3.6).

/** The send fields a templated message passes to the pipeline as received. */
const PASSED_FIELDS = [
  "From",
  "To",
  "Cc",
  "Bcc",
  "ReplyTo",
  "Tag",
  "MessageStream",
  "Headers",
  "Attachments",
  "Metadata",
  "TrackOpens",
  "TrackLinks",
] as const satisfies ReadonlyArray<keyof OutboundDraft>;

const passed = Object.fromEntries(
  PASSED_FIELDS.map((key) => [key, z.unknown().optional()]),
) as Record<(typeof PASSED_FIELDS)[number], z.ZodOptional<z.ZodUnknown>>;

/** php sends `TemplateId: 0` beside an alias and `TemplateModel: []` (docs/08 R10). */
const templatedMessage = z.object({
  TemplateId: z.preprocess((v) => (v === 0 || v === null ? undefined : v), intLike.optional()),
  TemplateAlias: absent(z.string()),
  TemplateModel: z.preprocess(
    (v) => (v === null ? undefined : v),
    objectOrEmptyArray(z.record(z.string(), z.unknown())).optional(),
  ),
  InlineCss: absent(z.boolean()),
  Subject: absent(z.unknown()),
  HtmlBody: absent(z.unknown()),
  TextBody: absent(z.unknown()),
  ...passed,
});

/**
 * Renders one templated message and submits it. Check order is INFERRED: template reference (1101),
 * templated vs content fields (1123), lookup (1101), model (1120), then the pipeline checks.
 */
async function submitTemplated(
  ctx: RequestContext,
  auth: ServerAuth,
  raw: unknown,
): Promise<SubmitResult> {
  const message = parseOrReject(templatedMessage, raw);
  const { state } = ctx.store;
  const serverId = auth.server.ID;
  if (message.TemplateId === undefined && message.TemplateAlias === undefined) {
    throw templateNotFound("TemplateId");
  }
  for (const part of ["Subject", "HtmlBody", "TextBody"] as const) {
    if (message[part] !== undefined) {
      throw apiError(1123, {
        message: `The '${part}' field cannot be used when sending with a template.`,
      });
    }
  }
  // TemplateId wins over TemplateAlias (refs/api_templates-api.md:181-182).
  const template =
    message.TemplateId === undefined
      ? activeTemplate(state, serverId, message.TemplateAlias ?? "")
      : activeTemplate(state, serverId, String(message.TemplateId));
  if (template.TemplateType !== "Standard") {
    throw templateNotFound(message.TemplateId === undefined ? "Alias" : "TemplateId");
  }
  if (message.TemplateModel === undefined) {
    throw apiError(1120, { message: "The 'TemplateModel' field is required." });
  }
  const layout =
    template.LayoutTemplate === null
      ? null
      : activeLayout(state, serverId, template.LayoutTemplate);
  const rendered = renderContent(
    template,
    layout,
    message.TemplateModel,
    message.InlineCss ?? true,
  );
  if (!rendered.ok) throw new Error(`stored template ${template.TemplateId} does not parse`);
  const draft: OutboundDraft = {
    ...Object.fromEntries(PASSED_FIELDS.map((key) => [key, message[key]])),
    Subject: rendered.content.Subject ?? undefined,
    HtmlBody: rendered.content.HtmlBody ?? undefined,
    TextBody: rendered.content.TextBody ?? undefined,
  } as OutboundDraft;
  return submitOutbound(ctx, {
    auth,
    channel: "rest",
    draft,
    request: raw,
    bulkRequestId: null,
    templateId: template.TemplateId,
  });
}

/**
 * The `/email` response of one message (docs/03 §1.2), or its `{ErrorCode, Message}`. Some
 * recipients suppressed still answers 406 (docs/03 §3.2, INFERRED).
 */
function resultJson(result: SubmitResult, raw: unknown) {
  const To = (raw as Record<string, unknown>).To;
  switch (result.outcome) {
    case "accepted":
      return {
        To,
        SubmittedAt: formatTimestamp(result.message.ReceivedAt),
        MessageID: result.message.MessageID,
        ErrorCode: 0,
        Message: "OK",
      };
    case "validated":
      return {
        To,
        SubmittedAt: formatTimestamp(result.submittedAt),
        MessageID: result.messageId,
        ErrorCode: 0,
        Message: "Test job accepted",
      };
    case "rejected":
    case "partiallySuppressed":
      return result.error;
  }
}

export async function sendWithTemplate(ctx: RequestContext, auth: ServerAuth, raw: unknown) {
  const result = await submitTemplated(ctx, auth, raw);
  if (result.outcome === "rejected" || result.outcome === "partiallySuppressed") {
    throw apiError(result.error.ErrorCode, { message: result.error.Message });
  }
  return resultJson(result, raw);
}

const batchBody = z.object({ Messages: z.array(z.unknown()) });

/** One result per message in request order; a failed item is `{ErrorCode, Message}` (docs/03 §2). */
export async function sendBatchWithTemplates(ctx: RequestContext, auth: ServerAuth, body: unknown) {
  const { Messages } = parseOrReject(batchBody, body);
  if (Messages.length > 500) throw apiError(410);
  const results: unknown[] = [];
  for (const raw of Messages) {
    try {
      const result = await submitTemplated(ctx, auth, raw);
      results.push(resultJson(result, raw));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      results.push({ ErrorCode: error.body.ErrorCode, Message: error.body.Message });
    }
  }
  return results;
}
