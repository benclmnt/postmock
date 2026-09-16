import type { ServerAuth } from "../../http/routes.ts";
import { type OutboundDraft, submitOutbound } from "../../pipeline/submit.ts";
import type { Runtime } from "../../runtime.ts";
import type { BulkRequest } from "../../state/types.ts";
import { formatTimestamp } from "../../time.ts";
import type { RenderOutcome } from "../templates/content.ts";

// The bulk request status object and its processing on the clock (docs/03 §1.6; refs/api_bulk-email.md).

/** Processing starts after this delay, then releases one message per step (INFERRED timings). */
export const BULK_START_MS = 1000;
export const BULK_STEP_MS = 10;

export interface BulkJob {
  /** The draft with rendered content, or the render failure that counts it as failed. */
  draft: OutboundDraft;
  rendered: RenderOutcome;
  /** The `Messages[]` entry, for `GET /control/messages`. */
  request: unknown;
}

/**
 * The status object of all three endpoints. Absent values are omitted, never null
 * (refs/api_bulk-email.md:238-240); `SubmittedAt` uses `Z` (refs/api_bulk-email.md:204).
 */
export const bulkStatusJson = (bulk: BulkRequest) => ({
  Id: bulk.Id,
  SubmittedAt: formatTimestamp(bulk.SubmittedAt, "utc"),
  Status: bulk.Status,
  TotalMessages: bulk.TotalMessages,
  PercentageCompleted: bulk.PercentageCompleted,
  ReleasedCount: bulk.ReleasedCount,
  FailedCount: bulk.FailedCount,
  ...(bulk.Subject !== null && { Subject: bulk.Subject }),
});

/**
 * Accepted → Processing → Completed. A message with every recipient suppressed, or one that failed
 * to render, counts in `FailedCount`; the rest in `ReleasedCount` (refs/api_bulk-email.md:303-316).
 * A message with only some recipients suppressed counts as released (INFERRED, docs/03 Q21).
 * A cancelled request releases nothing more. A pipeline `Unsupported` inside a job crashes postmock:
 * a job runs on the clock, where no request can carry the 501.
 */
export function scheduleBulk(
  runtime: Runtime,
  auth: ServerAuth,
  bulk: BulkRequest,
  jobs: readonly BulkJob[],
  templateId: number | null,
): void {
  const { clock } = runtime;
  clock.schedule(BULK_START_MS, () => {
    if (bulk.Status === "Accepted") bulk.Status = "Processing";
  });
  jobs.forEach((job, i) => {
    clock.schedule(BULK_START_MS + (i + 1) * BULK_STEP_MS, async () => {
      if (bulk.Status !== "Processing") return;
      const result = job.rendered.ok
        ? await submitOutbound(runtime, {
            auth,
            channel: "rest",
            draft: job.draft,
            request: job.request,
            bulkRequestId: bulk.Id,
            templateId,
          })
        : undefined;
      if (result?.outcome === "accepted" || result?.outcome === "partiallySuppressed") {
        bulk.ReleasedCount += 1;
        bulk.messageIds.push(result.message.MessageID);
      } else {
        bulk.FailedCount += 1;
      }
      const done = bulk.ReleasedCount + bulk.FailedCount;
      bulk.PercentageCompleted = (done / bulk.TotalMessages) * 100;
      if (done === bulk.TotalMessages) bulk.Status = "Completed";
    });
  });
}
