import { bulkStatusJson } from "../../api/bulk/bulk.ts";
import { ControlError, defineControl } from "../registry.ts";

// Postmark cancels a bulk request that has not finished (refs/api_bulk-email.md:190 `Cancelled`).
// The messages not yet released stay unsent; the counters keep their values.
defineControl({
  method: "POST",
  path: "/control/bulk/:id/cancel",
  handler: ({ store, params }) => {
    const bulk = store.state.bulkRequests.get(params.id ?? "");
    if (bulk === undefined) throw new ControlError(`no bulk request '${params.id}'`);
    if (bulk.Status !== "Accepted" && bulk.Status !== "Processing") {
      throw new ControlError(`bulk request '${bulk.Id}' is ${bulk.Status}`);
    }
    bulk.Status = "Cancelled";
    return bulkStatusJson(bulk);
  },
});
