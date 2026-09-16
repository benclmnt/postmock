import { z } from "zod";
import { ApiError, apiError } from "../../errors.ts";
import { absent } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import type { RequestContext, ServerAuth } from "../../http/routes.ts";
import {
  acceptOutbound,
  acceptOutbounds,
  draftFromJson,
  type OutboundDraft,
  refuseSenderAfterDataError,
  type SubmitResult,
  type Validation,
  validateOutbound,
} from "../../pipeline/submit.ts";
import { batchItem, sendResponse } from "../email/json.ts";
import { renderContent } from "./content.ts";
import {
  CONTENT_PARTS,
  parseOrReject,
  sendTemplate,
  templateIdField,
  templateModelField,
} from "./templates.ts";

// `/email/withTemplate` and `/email/batchWithTemplates` (docs/03 §1.4–§1.5, docs/06 §3.6).

const MAX_BATCH_MESSAGES = 500;

/** The template fields of a message; the send fields go through `draftFromJson`. */
const templateFields = z.object({
  TemplateId: templateIdField,
  TemplateAlias: absent(z.string()),
  TemplateModel: templateModelField,
  InlineCss: absent(z.boolean()),
});

/**
 * Renders one templated message and validates the result. Check order is INFERRED: templated vs
 * content fields (1123), template (1101), model (1120), then the pipeline checks. A template error
 * throws `ApiError`.
 */
function validateTemplated(
  ctx: RequestContext,
  auth: ServerAuth,
  raw: Record<string, unknown>,
): Validation {
  const draft = draftFromJson(raw);
  try {
    return validateRendered(ctx, auth, raw, draft);
  } catch (error) {
    if (error instanceof ApiError) refuseSenderAfterDataError(ctx, auth, draft.From);
    throw error;
  }
}

function validateRendered(
  ctx: RequestContext,
  auth: ServerAuth,
  raw: Record<string, unknown>,
  draft: OutboundDraft,
): Validation {
  const message = parseOrReject(templateFields, raw);
  for (const part of CONTENT_PARTS) {
    // R9: null and "" are absent (docs/08).
    if (draft[part] !== undefined && draft[part] !== null && draft[part] !== "") {
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
  return validateOutbound(ctx, {
    auth,
    channel: "rest",
    draft: {
      ...draft,
      Subject: rendered.content.Subject ?? undefined,
      HtmlBody: rendered.content.HtmlBody ?? undefined,
      TextBody: rendered.content.TextBody ?? undefined,
    },
    request: raw,
    bulkRequestId: null,
    templateId: template.TemplateId,
  });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function sendWithTemplate(ctx: RequestContext, auth: ServerAuth, body: unknown) {
  if (!isObject(body)) throw new Unsupported("a send body that is not a JSON object");
  const validation = validateTemplated(ctx, auth, body);
  if (validation.outcome === "rejected") return sendResponse(validation, "");
  const { outbound } = validation;
  return sendResponse(await acceptOutbound(ctx, outbound), outbound.draft.To);
}

const batchBody = z.object({ Messages: z.array(z.unknown()) });

/**
 * One item per message in request order (docs/03 §2). Every item is validated before any is
 * stored, as on `/email/batch`.
 */
export async function sendBatchWithTemplates(ctx: RequestContext, auth: ServerAuth, body: unknown) {
  const { Messages } = parseOrReject(batchBody, body);
  if (!Messages.every(isObject)) throw new Unsupported("a batch message that is not an object");
  if (Messages.length > MAX_BATCH_MESSAGES) throw apiError(410);
  const validations = Messages.map((raw): Validation => {
    try {
      return validateTemplated(ctx, auth, raw);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { outcome: "rejected", field: "", error: error.body };
    }
  });
  // Whether 1235 is per item or for the whole request is not captured (docs/03 §8 Q14).
  if (validations.some((v) => v.outcome === "rejected" && v.error.ErrorCode === 1235)) {
    throw new Unsupported("an unknown MessageStream in a batch (docs/03 §8 Q14)");
  }
  const accepted = await acceptOutbounds(
    ctx,
    validations.flatMap((v) => (v.outcome === "valid" ? [v.outbound] : [])),
  );
  let next = 0;
  return validations.map((validation) =>
    validation.outcome === "rejected"
      ? batchItem(validation, "")
      : batchItem(accepted[next++] as SubmitResult, validation.outbound.draft.To),
  );
}
