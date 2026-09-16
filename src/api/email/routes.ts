import { apiError } from "../../errors.ts";
import { Unsupported } from "../../http/respond.ts";
import { defineRoute } from "../../http/routes.ts";
import { draftFromJson, type Submission, submitOutbound } from "../../pipeline/submit.ts";
import type { Runtime } from "../../runtime.ts";
import { batchItem, sendResponse } from "./json.ts";

const MAX_BATCH_MESSAGES = 500;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Submits one `/email` JSON object and returns its result and the `To` echo. */
async function submitJson(runtime: Runtime, auth: Submission["auth"], body: unknown) {
  // An empty or non-object body is not captured (docs/02 Q16).
  if (!isObject(body)) throw new Unsupported("an /email body that is not a JSON object");
  const draft = draftFromJson(body);
  const result = await submitOutbound(runtime, {
    auth,
    channel: "rest",
    draft,
    request: body,
    bulkRequestId: null,
    templateId: null,
  });
  return { result, to: typeof draft.To === "string" ? draft.To : "" };
}

// refs/api_email-api.md (docs/03 §1.2).
defineRoute({
  method: "POST",
  path: "/email",
  auth: "serverOrTest",
  handler: async (ctx) => {
    const { result, to } = await submitJson(ctx, ctx.auth, ctx.body);
    return sendResponse(result, to);
  },
});

// refs/api_email-api.md (docs/03 §1.3, §2): 200 with one item per message, in request order.
defineRoute({
  method: "POST",
  path: "/email/batch",
  auth: "serverOrTest",
  handler: async (ctx) => {
    if (!Array.isArray(ctx.body)) throw new Unsupported("a batch body that is not a JSON array");
    if (ctx.body.length > MAX_BATCH_MESSAGES) throw apiError(410);
    // HTTP 413 above 50 MB (refs/api_overview.md:30); its body is not captured (docs/02 Q10).
    if (Buffer.byteLength(JSON.stringify(ctx.body)) > MAX_BATCH_BYTES) {
      throw new Unsupported("HTTP 413 for an oversized batch: body not captured (docs/02 Q10)");
    }
    const items = [];
    for (const body of ctx.body) {
      const { result, to } = await submitJson(ctx, ctx.auth, body);
      items.push(batchItem(result, to));
    }
    return items;
  },
});
