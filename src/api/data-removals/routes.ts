import { z } from "zod";
import { apiError } from "../../errors.ts";
import { parseBody } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import { defineRoute } from "../../http/routes.ts";
import { isEmailAddress } from "../../recipients/transitions.ts";
import type { DataRemoval } from "../../state/types.ts";

// Data Removals API: docs/04 §5. A request stays Pending: the time to Done and what it erases are
// not captured (Q16). The 1300 and 1301 texts are INFERRED from their summary rows.

const EMPTY = "Empty request.";
const NOT_FOUND = "Missing or incorrect data removal request ID.";

const json = (r: DataRemoval) => ({ ID: r.ID, Status: r.Status });

function checkAccess(enabled: boolean): void {
  if (!enabled) throw apiError(1302);
}

const createSchema = z.object({
  RequestedBy: z.string(),
  RequestedFor: z.string(),
  NotifyWhenCompleted: z.boolean(),
});

defineRoute({
  method: "POST",
  path: "/data-removals",
  auth: "account",
  handler: ({ store, clock, body }) => {
    checkAccess(store.state.account.dataRemovalsEnabled);
    if (body === undefined || z.object({}).strict().safeParse(body).success) {
      throw apiError(1300, { message: EMPTY });
    }
    const parsed = parseBody(createSchema, body);
    if (!parsed.success)
      throw new Unsupported("malformed data removal body: error not captured (Q16)");
    const request = parsed.data;
    if (!isEmailAddress(request.RequestedFor)) {
      throw new Unsupported("invalid RequestedFor: error not captured (docs/04 Q16)");
    }
    const removal: DataRemoval = {
      ID: store.nextId("dataRemoval"),
      ...request,
      Status: "Pending",
      createdAt: clock.now(),
    };
    store.state.dataRemovals.set(removal.ID, removal);
    return json(removal);
  },
});

defineRoute({
  method: "GET",
  path: "/data-removals/:id",
  auth: "account",
  handler: ({ store, params }) => {
    checkAccess(store.state.account.dataRemovalsEnabled);
    const raw = params.id as string;
    const removal = /^\d+$/.test(raw) ? store.state.dataRemovals.get(Number(raw)) : undefined;
    if (removal === undefined) throw apiError(1301, { message: NOT_FOUND });
    return json(removal);
  },
});
