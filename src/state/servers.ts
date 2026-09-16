export const TEST_TOKEN = "POSTMARK_API_TEST";

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
    Color: "purple",
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
  const held = new Map(
    [...store.state.servers.values()].flatMap((other) =>
      other.ApiTokens.map((t) => [t.toLowerCase(), { token: t, server: other.ID }] as const),
    ),
  );
  for (const token of tokens) {
    refuseTestToken(token);
    const holder = held.get(token.toLowerCase());
    if (holder !== undefined) {
      throw new Error(`server ${holder.server} already holds token ${holder.token}`);
    }
    if (tokens.filter((t) => t.toLowerCase() === token.toLowerCase()).length > 1) {
      throw new Error(`token ${token} appears twice`);
    }
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

// Auth treats POSTMARK_API_TEST as the test token before any lookup (docs/02 §3.3).
function refuseTestToken(token: string): void {
  if (token.toLowerCase() === TEST_TOKEN.toLowerCase()) {
    throw new Error(`${TEST_TOKEN} is the test token, not a stored token`);
  }
}

/** Adds an account token. Tokens compare without case (docs/02 §3.1). */
export function addAccountToken(store: Store, token: string): void {
  refuseTestToken(token);
  if (store.state.account.tokens.some((t) => t.toLowerCase() === token.toLowerCase())) {
    throw new Error(`account token ${token} exists`);
  }
  store.state.account.tokens.push(token);
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
  server: newServer(0, [TEST_TOKEN], { Name: TEST_TOKEN, InboundHash: "" }),
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
