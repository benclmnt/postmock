import { newHex, newToken } from "./ids.ts";
import { type State, type Store, streamKey } from "./store.ts";
import type { MessageStream, MessageStreamType, Server } from "./types.ts";

// A new server has these three streams (docs/04 §4.3; Q7 for the broadcast id).
const DEFAULT_STREAMS: ReadonlyArray<[id: string, name: string, type: MessageStreamType]> = [
  ["outbound", "Default Transactional Stream", "Transactional"],
  ["inbound", "Default Inbound Stream", "Inbound"],
  ["broadcast", "Default Broadcast Stream", "Broadcasts"],
];

export type ServerSettings = Partial<Omit<Server, "ServerLink" | "InboundAddress">>;

function newServer(id: number, tokens: string[], settings: ServerSettings): Server {
  const hash = settings.InboundHash ?? newHex(16);
  return {
    Name: `Server ${id}`,
    ApiTokens: tokens,
    Color: "Purple",
    SmtpApiActivated: true,
    RawEmailEnabled: false,
    DeliveryType: "Live",
    InboundHookUrl: "",
    BounceHookUrl: "",
    OpenHookUrl: "",
    DeliveryHookUrl: "",
    ClickHookUrl: "",
    PostFirstOpenOnly: false,
    InboundDomain: "",
    InboundSpamThreshold: 0,
    TrackOpens: false,
    TrackLinks: "None",
    IncludeBounceContentInHook: false,
    EnableSmtpApiErrorHooks: false,
    ...settings,
    ID: id,
    InboundHash: hash,
    ServerLink: `https://postmarkapp.com/servers/${id}/streams`,
    InboundAddress: `${hash}@inbound.postmarkapp.com`,
  };
}

const defaultStreams = (serverId: number, now: Date): MessageStream[] =>
  DEFAULT_STREAMS.map(([id, name, type]) => ({
    ID: id,
    ServerID: serverId,
    Name: name,
    Description: null,
    MessageStreamType: type,
    CreatedAt: now,
    UpdatedAt: null,
    ArchivedAt: null,
    ExpectedPurgeDate: null,
    SubscriptionManagementConfiguration: {
      UnsubscribeHandlingType: type === "Broadcasts" ? "Postmark" : "None",
    },
  }));

/**
 * Creates a server with one API token and the default streams. `settings.ID` claims a fixed ID.
 * A token that another server already holds throws: auth could not tell the two apart.
 */
export function createServer(store: Store, now: Date, settings: ServerSettings = {}): Server {
  const tokens = settings.ApiTokens ?? [newToken()];
  for (const other of store.state.servers.values()) {
    const taken = other.ApiTokens.find((t) =>
      tokens.some((u) => u.toLowerCase() === t.toLowerCase()),
    );
    if (taken !== undefined) throw new Error(`server ${other.ID} already holds token ${taken}`);
  }
  const id =
    settings.ID === undefined ? store.nextId("server") : store.useId("server", settings.ID);
  const server = newServer(id, tokens, settings);
  store.state.servers.set(id, server);
  for (const stream of defaultStreams(id, now)) {
    store.state.streams.set(streamKey(id, stream.ID), stream);
  }
  return server;
}

/**
 * What `POSTMARK_API_TEST` sends against: a new server with default settings and the default
 * streams, stored nowhere. It validates like a live server and delivers nothing (docs/03 §4).
 * That it sees only the default streams and settings is INFERRED.
 */
export interface TestTokenContext {
  kind: "test";
  server: Server;
  streams: MessageStream[];
}

export const testTokenContext = (now: Date): TestTokenContext => ({
  kind: "test",
  server: newServer(0, ["POSTMARK_API_TEST"], { Name: "POSTMARK_API_TEST", InboundHash: "" }),
  streams: defaultStreams(0, now),
});

/** A stream of the server the request authenticated as, stored or test-token. */
export function findStream(
  state: State,
  auth: { kind: "server"; server: Server } | TestTokenContext,
  streamId: string,
): MessageStream | undefined {
  return auth.kind === "test"
    ? auth.streams.find((s) => s.ID === streamId)
    : state.streams.get(streamKey(auth.server.ID, streamId));
}
