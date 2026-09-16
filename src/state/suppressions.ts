import { type State, suppressionKey } from "./store.ts";
import type { Suppression } from "./types.ts";

/** The suppression row of an address on one stream; addresses compare without case. */
export const findSuppression = (
  state: State,
  serverId: number,
  streamId: string,
  email: string,
): Suppression | undefined => state.suppressions.get(suppressionKey(serverId, streamId, email));

/**
 * The addresses of `emails` that a send on the stream must refuse with ErrorCode 406, in input
 * order. Only the send stream's list counts (docs/04 §3.3; Q3).
 */
export const suppressedAddresses = (
  state: State,
  serverId: number,
  streamId: string,
  emails: readonly string[],
): string[] =>
  emails.filter((email) => findSuppression(state, serverId, streamId, email) !== undefined);
