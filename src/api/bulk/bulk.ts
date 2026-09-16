import { Unsupported } from "../../http/respond.ts";
import type { ServerAuth } from "../../http/routes.ts";
import {
  acceptOutbound,
  type OutboundDraft,
  type Submission,
  validateOutbound,
} from "../../pipeline/submit.ts";
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

/** A bulk message submission. REST sends generate no MIME source yet. */
export const bulkSubmission = (
  auth: ServerAuth,
  draft: OutboundDraft,
  request: unknown,
  bulkRequestId: string | null,
  templateId: number | null,
): Submission => ({
  auth,
  channel: "rest",
  draft,
  request,
  bulkRequestId,
  templateId,
});

/**
 * Accepted → Processing → Completed. A message with every recipient suppressed, or one that failed
 * to render, counts in `FailedCount`; the rest in `ReleasedCount` (refs/api_bulk-email.md:303-316).
 * A message that state changed since accept (a deleted stream) fails its checks and counts as
 * failed too (INFERRED). A message with only some recipients suppressed counts as released
 * (INFERRED, docs/03 Q21). A cancelled request releases nothing more.
 *
 * `Unsupported` in a job (an archived stream, a listener) has no request to answer with 501, and
 * the docs give no count for it. The request stops releasing and keeps its counters, so it never
 * reaches Completed; the reason goes to stderr and `GET /control/bulk/:id` (AGENTS.md rule 5).
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
      if (bulk.Status !== "Processing" || bulk.unsupported !== null) return;
      try {
        bulk[
          (await release(runtime, auth, bulk, job, templateId)) ? "ReleasedCount" : "FailedCount"
        ] += 1;
      } catch (error) {
        if (!(error instanceof Unsupported)) throw error;
        bulk.unsupported = error.message;
        console.error(`postmock: bulk request ${bulk.Id} stopped: ${error.message}`);
        return;
      }
      const done = bulk.ReleasedCount + bulk.FailedCount;
      bulk.PercentageCompleted = (done / bulk.TotalMessages) * 100;
      if (done === bulk.TotalMessages) bulk.Status = "Completed";
    });
  });
}

/** Sends one bulk message; true when it was released. */
async function release(
  runtime: Runtime,
  auth: ServerAuth,
  bulk: BulkRequest,
  job: BulkJob,
  templateId: number | null,
): Promise<boolean> {
  if (!job.rendered.ok) return false;
  const validation = validateOutbound(
    runtime,
    bulkSubmission(auth, job.draft, job.request, bulk.Id, templateId),
  );
  if (validation.outcome === "rejected") return false;
  const result = await acceptOutbound(runtime, validation.outbound);
  if (result.outcome !== "accepted" && result.outcome !== "partiallySuppressed") return false;
  bulk.messageIds.push(result.message.MessageID);
  return true;
}
