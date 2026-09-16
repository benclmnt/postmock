import { formatTimestamp } from "../../time.ts";
import { ControlError, defineControl } from "../registry.ts";

// The webhook delivery log (docs/05 §6): one row per POST attempt, oldest first.
defineControl({
  method: "GET",
  path: "/control/webhooks/attempts",
  handler: ({ store, query }) => {
    const int = (name: string) => {
      const value = query.get(name);
      if (value !== null && !/^\d+$/.test(value))
        throw new ControlError(`${name} must be an integer`);
      return value === null ? null : Number(value);
    };
    const [serverId, webhookId] = [int("serverId"), int("webhookId")];
    const recordType = query.get("recordType");
    const rows = store.state.webhookAttempts.filter(
      (a) =>
        (serverId === null || a.serverId === serverId) &&
        (webhookId === null || a.webhookId === webhookId) &&
        (recordType === null || a.recordType === recordType),
    );
    return {
      Attempts: rows.map((a) => ({
        ServerID: a.serverId,
        WebhookID: a.webhookId,
        RecordType: a.recordType,
        Url: a.url,
        TraceID: a.traceId,
        Attempt: a.attempt,
        At: formatTimestamp(a.at, "utc"),
        Headers: a.headers,
        Body: JSON.parse(a.body) as unknown,
        ...("status" in a.outcome ? { HttpStatus: a.outcome.status } : { Error: a.outcome.error }),
        Result: a.result,
        NextAttemptAt: a.nextAttemptAt === null ? null : formatTimestamp(a.nextAttemptAt, "utc"),
      })),
    };
  },
});
