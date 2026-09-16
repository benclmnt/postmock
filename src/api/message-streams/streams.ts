import { apiError } from "../../errors.ts";
import type { State } from "../../state/store.ts";
import { streamKey } from "../../state/store.ts";
import type { MessageStream } from "../../state/types.ts";
import { formatTimestamp } from "../../time.ts";

/** Archived streams are deleted 45 days after archiving (refs/api_message-streams-api.md:48). */
export const PURGE_DELAY_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * A purged stream stays in the store so unarchive can answer 1232; every other call treats it as
 * absent (INFERRED).
 */
export const isPurged = (stream: MessageStream, now: Date): boolean =>
  stream.ExpectedPurgeDate !== null && now.getTime() >= stream.ExpectedPurgeDate.getTime();

/** A stream of the server that is not purged, or 422 / 1226. Stream IDs match with case kept (INFERRED). */
export function liveStream(state: State, serverId: number, id: string, now: Date): MessageStream {
  const stream = state.streams.get(streamKey(serverId, id));
  if (stream === undefined || isPurged(stream, now)) throw apiError(1226, { family: "streams" });
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
