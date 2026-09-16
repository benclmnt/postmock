import { newHex, newToken } from "./ids.ts";
import { type Store, streamKey } from "./store.ts";
import type { MessageStream, MessageStreamType, Server } from "./types.ts";

// A new server has these three streams (docs/04 §4.3; Q7 for the broadcast id).
const DEFAULT_STREAMS: ReadonlyArray<[id: string, name: string, type: MessageStreamType]> = [
  ["outbound", "Default Transactional Stream", "Transactional"],
  ["inbound", "Default Inbound Stream", "Inbound"],
  ["broadcast", "Default Broadcast Stream", "Broadcasts"],
];

export type ServerSettings = Partial<Omit<Server, "ServerLink" | "InboundAddress">>;

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
  const hash = settings.InboundHash ?? newHex(16);
  const server: Server = {
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
  store.state.servers.set(id, server);
  for (const [streamId, name, type] of DEFAULT_STREAMS) {
    const stream: MessageStream = {
      ID: streamId,
      ServerID: id,
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
    };
    store.state.streams.set(streamKey(id, streamId), stream);
  }
  return server;
}
