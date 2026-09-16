import { z } from "zod";
import { ApiError, apiError } from "../../errors.ts";
import { absent } from "../../http/normalize.ts";
import type { RequestContext, ServerAuth } from "../../http/routes.ts";
import { type OutboundDraft, type SubmitResult, submitOutbound } from "../../pipeline/submit.ts";
import { formatTimestamp } from "../../time.ts";
import { renderContent } from "./content.ts";
import { parseOrReject, sendTemplate, templateIdField, templateModelField } from "./templates.ts";

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

const templatedMessage = z.object({
  TemplateId: templateIdField,
  TemplateAlias: absent(z.string()),
  TemplateModel: templateModelField,
  InlineCss: absent(z.boolean()),
  Subject: absent(z.unknown()),
  HtmlBody: absent(z.unknown()),
  TextBody: absent(z.unknown()),
  ...passed,
});

/**
 * Renders one templated message and submits it. Check order is INFERRED: templated vs content
 * fields (1123), template (1101), model (1120), then the pipeline checks.
 */
async function submitTemplated(
  ctx: RequestContext,
  auth: ServerAuth,
  raw: unknown,
): Promise<{ result: SubmitResult; to: unknown }> {
  const message = parseOrReject(templatedMessage, raw);
  for (const part of ["Subject", "HtmlBody", "TextBody"] as const) {
    if (message[part] !== undefined) {
      throw apiError(1123, {
        message: `The '${part}' field cannot be used when sending with a template.`,
      });
    }
  }
  const { template, layout } = sendTemplate(ctx.store.state, auth.server.ID, message);
  if (message.TemplateModel === undefined) {
    throw apiError(1120, { message: "The 'TemplateModel' field is required." });
  }
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
  const result = await submitOutbound(ctx, {
    auth,
    channel: "rest",
    draft,
    request: raw,
    bulkRequestId: null,
    templateId: template.TemplateId,
  });
  return { result, to: message.To };
}

/**
 * The `/email` response of one message (docs/03 §1.2), or its `{ErrorCode, Message}`. Some
 * recipients suppressed still answers 406 (docs/03 §3.2, INFERRED).
 */
function resultJson(result: SubmitResult, To: unknown) {
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
  const { result, to } = await submitTemplated(ctx, auth, raw);
  // Every send rejection is HTTP 422 (docs/03 §3.1).
  if (result.outcome === "rejected" || result.outcome === "partiallySuppressed") {
    throw new ApiError(422, result.error);
  }
  return resultJson(result, to);
}

const batchBody = z.object({ Messages: z.array(z.unknown()) });

/** One result per message in request order; a failed item is `{ErrorCode, Message}` (docs/03 §2). */
export async function sendBatchWithTemplates(ctx: RequestContext, auth: ServerAuth, body: unknown) {
  const { Messages } = parseOrReject(batchBody, body);
  if (Messages.length > 500) throw apiError(410);
  const results: unknown[] = [];
  for (const raw of Messages) {
    try {
      const { result, to } = await submitTemplated(ctx, auth, raw);
      results.push(resultJson(result, to));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      results.push({ ErrorCode: error.body.ErrorCode, Message: error.body.Message });
    }
  }
  return results;
}
