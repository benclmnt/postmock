import { apiError } from "../../errors.ts";
import { Unsupported } from "../../http/respond.ts";
import { defineRoute } from "../../http/routes.ts";
import {
  acceptOutbound,
  acceptOutbounds,
  draftFromJson,
  type Submission,
  type SubmitResult,
  type Validation,
  validateOutbound,
} from "../../pipeline/submit.ts";
import type { Runtime } from "../../runtime.ts";
import { batchItem, sendResponse } from "./json.ts";

const MAX_BATCH_MESSAGES = 500;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateJson = (
  runtime: Runtime,
  auth: Submission["auth"],
  body: Record<string, unknown>,
): Validation =>
  validateOutbound(runtime, {
    auth,
    channel: "rest",
    draft: draftFromJson(body),
    request: body,
    bulkRequestId: null,
    templateId: null,
  });

// refs/api_email-api.md (docs/03 §1.2).
defineRoute({
  method: "POST",
  path: "/email",
  auth: "serverOrTest",
  handler: async (ctx) => {
    // An empty or non-object body is not captured (docs/02 Q16).
    if (!isObject(ctx.body)) throw new Unsupported("an /email body that is not a JSON object");
    const validation = validateJson(ctx, ctx.auth, ctx.body);
    if (validation.outcome === "rejected") return sendResponse(validation, "");
    const { outbound } = validation;
    return sendResponse(await acceptOutbound(ctx, outbound), outbound.draft.To);
  },
});

// refs/api_email-api.md (docs/03 §1.3, §2): 200 with one item per message, in request order.
defineRoute({
  method: "POST",
  path: "/email/batch",
  auth: "serverOrTest",
  handler: async (ctx) => {
    // An empty body, a non-array, or a non-object item is not captured (docs/02 Q16).
    if (!Array.isArray(ctx.body) || !ctx.body.every(isObject)) {
      throw new Unsupported("a batch body that is not a JSON array of objects");
    }
    if (ctx.body.length > MAX_BATCH_MESSAGES) throw apiError(410);
    // HTTP 413 above 50 MB (refs/api_overview.md:30); its body is not captured (docs/02 Q10).
    if (Buffer.byteLength(JSON.stringify(ctx.body)) > MAX_BATCH_BYTES) {
      throw new Unsupported("HTTP 413 for an oversized batch: body not captured (docs/02 Q10)");
    }
    // Every item is validated before any is stored, so a 501 leaves no partial batch behind.
    const validations = ctx.body.map((body) => validateJson(ctx, ctx.auth, body));
    // Whether 1235 is per item or for the whole request is not captured (docs/03 §8 Q14).
    if (validations.some((v) => v.outcome === "rejected" && v.error.ErrorCode === 1235)) {
      throw new Unsupported("an unknown MessageStream in a batch (docs/03 §8 Q14)");
    }
    const accepted = await acceptOutbounds(
      ctx,
      validations.flatMap((v) => (v.outcome === "valid" ? [v.outbound] : [])),
    );
    let next = 0;
    const items = validations.map((validation) => {
      if (validation.outcome === "rejected") return batchItem(validation, "");
      return batchItem(accepted[next++] as SubmitResult, validation.outbound.draft.To);
    });
    return items;
  },
});
