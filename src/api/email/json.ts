import { apiError } from "../../errors.ts";
import { batchItemError } from "../../pipeline/inactive.ts";
import type { SubmitResult } from "../../pipeline/submit.ts";
import { formatTimestamp } from "../../time.ts";

type Success = Extract<SubmitResult, { outcome: "accepted" | "validated" }>;

/**
 * A send result, in the order of refs/api_email-api.md "Example response". `to` is the request `To`
 * value, echoed as sent (docs/03 §1.2). The test token answers "Test job accepted" (docs/03 §4).
 */
function success(result: Success, to: string) {
  const [submittedAt, messageId, text] =
    result.outcome === "accepted"
      ? [result.message.ReceivedAt, result.message.MessageID, "OK"]
      : [result.submittedAt, result.messageId, "Test job accepted"];
  return {
    To: to,
    SubmittedAt: formatTimestamp(submittedAt),
    MessageID: messageId,
    ErrorCode: 0,
    Message: text,
  };
}

/** The `POST /email` response, or the error envelope (HTTP 422 for every send code). */
export function sendResponse(result: SubmitResult, to: string) {
  if (result.outcome === "rejected" || result.outcome === "partiallySuppressed") {
    throw apiError(result.error.ErrorCode, { message: result.error.Message });
  }
  return success(result, to);
}

/** One batch item: the send response, or `{ErrorCode, Message}` only (docs/03 §2). */
export function batchItem(result: SubmitResult, to: string) {
  if (result.outcome === "rejected" || result.outcome === "partiallySuppressed") {
    return batchItemError(result.error);
  }
  return success(result, to);
}
