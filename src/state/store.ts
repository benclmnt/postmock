import type {
  Account,
  Bounce,
  BulkRequest,
  ClickEvent,
  DataRemoval,
  Domain,
  Fault,
  InboundMessage,
  InboundRule,
  MessageStream,
  OpenEvent,
  OutboundMessage,
  SenderSignature,
  Server,
  SmtpToken,
  Suppression,
  Template,
  Webhook,
  WebhookAttempt,
} from "./types.ts";

export type IdKind =
  | "server"
  | "bounce"
  | "template"
  | "webhook"
  | "webhookAttempt"
  | "inboundRule"
  | "domain"
  | "sender"
  | "dataRemoval";

export interface State {
  account: Account;
  servers: Map<number, Server>;
  /** Key: `streamKey(serverId, streamId)`. */
  streams: Map<string, MessageStream>;
  /** Key: MessageID. */
  outbound: Map<string, OutboundMessage>;
  /** Key: MessageID. */
  inbound: Map<string, InboundMessage>;
  bounces: Map<number, Bounce>;
  /** Key: `suppressionKey(serverId, streamId, email)`. */
  suppressions: Map<string, Suppression>;
  opens: OpenEvent[];
  clicks: ClickEvent[];
  templates: Map<number, Template>;
  bulkRequests: Map<string, BulkRequest>;
  webhooks: Map<number, Webhook>;
  webhookAttempts: WebhookAttempt[];
  inboundRules: Map<number, InboundRule>;
  domains: Map<number, Domain>;
  senders: Map<number, SenderSignature>;
  dataRemovals: Map<number, DataRemoval>;
  /** Key: access key. */
  smtpTokens: Map<string, SmtpToken>;
  faults: Fault[];
  usedIds: Record<IdKind, Set<number>>;
  /** Highest used ID per kind. */
  maxIds: Record<IdKind, number>;
}

function emptyState(): State {
  return {
    account: {
      tokens: [],
      approval: "approved",
      bulkApiEnabled: true,
      dataRemovalsEnabled: true,
      messageStreamsApiEnabled: true,
      customUnsubscribeEnabled: false,
      serverDeletionEnabled: false,
    },
    servers: new Map(),
    streams: new Map(),
    outbound: new Map(),
    inbound: new Map(),
    bounces: new Map(),
    suppressions: new Map(),
    opens: [],
    clicks: [],
    templates: new Map(),
    bulkRequests: new Map(),
    webhooks: new Map(),
    webhookAttempts: [],
    inboundRules: new Map(),
    domains: new Map(),
    senders: new Map(),
    dataRemovals: new Map(),
    smtpTokens: new Map(),
    faults: [],
    usedIds: {
      server: new Set(),
      bounce: new Set(),
      template: new Set(),
      webhook: new Set(),
      webhookAttempt: new Set(),
      inboundRule: new Set(),
      domain: new Set(),
      sender: new Set(),
      dataRemoval: new Set(),
    },
    maxIds: {
      server: 0,
      bounce: 0,
      template: 0,
      webhook: 0,
      webhookAttempt: 0,
      inboundRule: 0,
      domain: 0,
      sender: 0,
      dataRemoval: 0,
    },
  };
}

/** The whole in-memory account. `reset()` swaps in an empty state; hold the Store, not the state. */
export class Store {
  state: State = emptyState();
  private seedDepth = 0;

  reset(): void {
    this.state = emptyState();
  }

  /**
   * Runs a seed. Inside it `nextId` throws: a seed part claims fixed IDs from its track's range
   * (docs/11 §5), so its IDs do not depend on the parts other tracks add.
   */
  async seeding<T>(apply: () => Promise<T>): Promise<T> {
    this.seedDepth += 1;
    try {
      return await apply();
    } finally {
      this.seedDepth -= 1;
    }
  }

  /** The next ID of a kind, above every ID used so far (docs/04 Mock must: bounce IDs increase). */
  nextId(kind: IdKind): number {
    if (this.seedDepth > 0) throw new Error(`${kind} needs a fixed ID while seeding (store.useId)`);
    return this.claim(kind, this.state.maxIds[kind] + 1);
  }

  /** Claims a fixed ID. */
  useId(kind: IdKind, id: number): number {
    if (!Number.isInteger(id) || id < 1 || this.state.usedIds[kind].has(id)) {
      throw new Error(`${kind} ID ${id} is taken or invalid`);
    }
    return this.claim(kind, id);
  }

  private claim(kind: IdKind, id: number): number {
    this.state.usedIds[kind].add(id);
    this.state.maxIds[kind] = Math.max(this.state.maxIds[kind], id);
    return id;
  }
}

export const streamKey = (serverId: number, streamId: string): string => `${serverId}/${streamId}`;

// Addresses compare without case (docs/04 Mock must, INFERRED).
export const suppressionKey = (serverId: number, streamId: string, email: string): string =>
  `${serverId}/${streamId}/${email.toLowerCase()}`;
