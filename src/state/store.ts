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
  lastIds: Record<IdKind, number>;
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
    lastIds: {
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

  reset(): void {
    this.state = emptyState();
  }

  /** Integer IDs increase from 1 per kind (docs/04 Mock must: bounce IDs increase). */
  nextId(kind: IdKind): number {
    this.state.lastIds[kind] += 1;
    return this.state.lastIds[kind];
  }
}

export const streamKey = (serverId: number, streamId: string): string => `${serverId}/${streamId}`;

// Addresses compare without case (docs/04 Mock must, INFERRED).
export const suppressionKey = (serverId: number, streamId: string, email: string): string =>
  `${serverId}/${streamId}/${email.toLowerCase()}`;
