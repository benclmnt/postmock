import { apiError } from "../../errors.ts";
import type { Runtime } from "../../runtime.ts";
import type { State } from "../../state/store.ts";
import { streamKey } from "../../state/store.ts";
import type { MessageStream } from "../../state/types.ts";
import { formatTimestamp } from "../../time.ts";

/** Archived streams are deleted 45 days after archiving (refs/api_message-streams-api.md:48). */
export const PURGE_DELAY_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Deletes an archived stream with its suppressions and bounces at its purge date, unless it was
 * unarchived before. "deleted (alongside associated data)":
 * sdk/postmark-dotnet/src/Postmark/PostmarkClient.cs:1242. Messages of the stream stay (INFERRED).
 */
export function schedulePurge(runtime: Runtime, stream: MessageStream, due: Date): void {
  const key = streamKey(stream.ServerID, stream.ID);
  runtime.clock.schedule(due.getTime() - runtime.clock.now().getTime(), () => {
    const state = runtime.store.state;
    if (state.streams.get(key)?.ExpectedPurgeDate?.getTime() !== due.getTime()) return;
    state.streams.delete(key);
    state.purgedStreams.add(key);
    const inStream = (row: { ServerID: number; MessageStream: string }) =>
      row.ServerID === stream.ServerID && row.MessageStream === stream.ID;
    for (const [k, row] of state.suppressions) if (inStream(row)) state.suppressions.delete(k);
    for (const [id, bounce] of state.bounces) if (inStream(bounce)) state.bounces.delete(id);
  });
}

/** A stream of the server, or 422 / 1226. IDs match with case kept (INFERRED). */
export function liveStream(state: State, serverId: number, id: string): MessageStream {
  const stream = state.streams.get(streamKey(serverId, id));
  if (stream === undefined) throw apiError(1226, { family: "streams" });
  return stream;
}

const stamp = (d: Date | null) => (d === null ? null : formatTimestamp(d));

/** refs/api_message-streams-api.md:40-50, in doc field order. */
export const streamJson = (s: MessageStream) => ({
  ID: s.ID,
  ServerID: s.ServerID,
  Name: s.Name,
  Description: s.Description,
  MessageStreamType: s.MessageStreamType,
  CreatedAt: formatTimestamp(s.CreatedAt),
  UpdatedAt: stamp(s.UpdatedAt),
  ArchivedAt: stamp(s.ArchivedAt),
  ExpectedPurgeDate: stamp(s.ExpectedPurgeDate),
  SubscriptionManagementConfiguration: {
    UnsubscribeHandlingType: s.SubscriptionManagementConfiguration.UnsubscribeHandlingType,
  },
});
