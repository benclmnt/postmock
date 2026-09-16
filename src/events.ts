import type {
  Bounce,
  ClickEvent,
  InboundMessage,
  OpenEvent,
  OutboundMessage,
  SubscriptionChange,
} from "./state/types.ts";

/** Domain events (docs/11 §2). Webhooks, stats and message events subscribe to them. */
export interface EventMap {
  /** A message was accepted for delivery. */
  sent: { message: OutboundMessage };
  delivered: { message: OutboundMessage; recipient: string; deliveredAt: Date; details: string };
  bounced: { bounce: Bounce };
  opened: { open: OpenEvent };
  clicked: { click: ClickEvent };
  spamComplaint: { bounce: Bounce };
  subscriptionChange: { change: SubscriptionChange };
  inboundReceived: { message: InboundMessage };
  /** An SMTP message failed validation after DATA (docs/07 §1.4). */
  smtpApiError: { bounce: Bounce };
}

export type EventName = keyof EventMap;
type Listener<K extends EventName> = (payload: EventMap[K]) => void | Promise<void>;

/**
 * `emit` awaits each listener in subscription order, so a request or control call that emits returns
 * after every listener finished. A listener that needs later work (a webhook retry) schedules it on
 * the clock. A listener that throws fails the emitter (AGENTS.md rule 5).
 */
export class EventBus {
  private listeners: { [K in EventName]?: Set<Listener<K>> } = {};

  on<K extends EventName>(name: K, listener: Listener<K>): () => void {
    const set: Set<Listener<K>> = this.listeners[name] ?? new Set();
    this.listeners[name] = set as (typeof this.listeners)[K];
    set.add(listener);
    return () => set.delete(listener);
  }

  async emit<K extends EventName>(name: K, payload: EventMap[K]): Promise<void> {
    for (const listener of [...(this.listeners[name] ?? [])]) {
      await (listener as Listener<K>)(payload);
    }
  }
}
