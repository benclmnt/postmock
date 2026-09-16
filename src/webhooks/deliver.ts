import { randomUUID } from "node:crypto";
import type { Runtime } from "../runtime.ts";
import type { Header, WebhookAttempt, WebhookRecordType } from "../state/types.ts";

/** Where one event goes: a `/webhooks` row or a server hook URL. */
export interface Target {
  serverId: number;
  /** null for a server hook URL. */
  webhookId: number | null;
  url: string;
  httpAuth: { Username: string; Password: string } | null;
  headers: Header[];
}

type Outcome = WebhookAttempt["outcome"];
type Verdict = "success" | "retry" | "stop";

/** How a receiver's answer is read, and when a failed event is sent again. */
export interface RetryPolicy {
  /** Minutes before each retry, in order. */
  delaysMin: readonly number[];
  timeoutMs: number;
  /** Send `X-PM-Retries-Remaining`. */
  retriesHeader: boolean;
  classify(outcome: Outcome): Verdict;
}

/**
 * Outbound events (docs/05 §3.4, §3.5): 2xx succeeds; 408, 429, 5xx and a network error retry;
 * other codes drop the event. The outbound timeout is not documented (Q5); postmock uses the
 * documented inbound 2 minutes (INFERRED).
 */
export const OUTBOUND: RetryPolicy = {
  delaysMin: [1, 5, 10, 10, 10, 15],
  timeoutMs: 120_000,
  retriesHeader: true,
  classify: (outcome) => {
    if ("error" in outcome) return "retry";
    const { status } = outcome;
    if (status >= 200 && status < 300) return "success";
    return status === 408 || status === 429 || status >= 500 ? "retry" : "stop";
  },
};

/**
 * Inbound (docs/05 §3.6): only 200 succeeds and only 403 stops. A 204 retries: the doc says
 * "non-200" (conflict R2, Q6). Whether inbound requests carry `X-PM-Retries-Remaining` is Q8;
 * postmock leaves it out.
 */
export const INBOUND: RetryPolicy = {
  delaysMin: [1, 5, 10, 10, 10, 15, 30, 60, 120, 360],
  timeoutMs: 120_000,
  retriesHeader: false,
  classify: (outcome) => {
    if ("error" in outcome) return "retry";
    if (outcome.status === 200) return "success";
    return outcome.status === 403 ? "stop" : "retry";
  },
};

export type AttemptResult = WebhookAttempt["result"];

export interface WebhookEvent {
  target: Target;
  recordType: WebhookRecordType;
  payload: object;
  policy: RetryPolicy;
  /** Runs after each attempt is logged. */
  onResult?: (result: AttemptResult) => void;
}

const MAX_REDIRECTS = 10;

/**
 * Sends one event and awaits the first attempt. A retry goes on the clock and runs on a later
 * `clock/advance` or when real time reaches it. Every attempt resends the same body bytes under the
 * same trace ID (docs/05 §6).
 */
export function deliver(runtime: Runtime, event: WebhookEvent): Promise<void> {
  return attempt(runtime, event, JSON.stringify(event.payload), randomUUID(), 1);
}

async function attempt(
  runtime: Runtime,
  event: WebhookEvent,
  body: string,
  traceId: string,
  n: number,
): Promise<void> {
  const { target, policy } = event;
  const remaining = policy.delaysMin.length - (n - 1);
  const { url, headers } = request(target, traceId, policy.retriesHeader ? remaining : null);
  const at = runtime.clock.now();
  const outcome = await post(url, headers, body, policy.timeoutMs);
  const verdict = policy.classify(outcome);
  const result: AttemptResult = verdict === "retry" && remaining === 0 ? "exhausted" : verdict;
  const delayMs = result === "retry" ? (policy.delaysMin[n - 1] as number) * 60_000 : null;
  runtime.store.state.webhookAttempts.push({
    id: runtime.store.nextId("webhookAttempt"),
    serverId: target.serverId,
    webhookId: target.webhookId,
    recordType: event.recordType,
    url: target.url,
    traceId,
    headers: [...headers].map(([Name, Value]) => ({ Name, Value })),
    body,
    attempt: n,
    at,
    outcome,
    result,
    nextAttemptAt: delayMs === null ? null : new Date(at.getTime() + delayMs),
  });
  // Retry delays count from the attempt's start, so the schedule does not drift by request time.
  if (delayMs !== null) {
    const wait = Math.max(0, at.getTime() + delayMs - runtime.clock.now().getTime());
    runtime.clock.schedule(wait, () => attempt(runtime, event, body, traceId, n + 1));
  }
  event.onResult?.(result);
}

/**
 * URL userinfo and `HttpAuth` become `Authorization: Basic`; the userinfo leaves the request URL
 * (docs/05 §3.2, Q18). With both, `HttpAuth` wins (INFERRED, Q3). The query string stays.
 */
function request(target: Target, traceId: string, retriesRemaining: number | null) {
  const url = new URL(target.url);
  const userinfo =
    url.username === "" && url.password === ""
      ? null
      : { Username: decodeURIComponent(url.username), Password: decodeURIComponent(url.password) };
  url.username = "";
  url.password = "";
  const auth = target.httpAuth ?? userinfo;
  const headers = new Headers();
  for (const header of target.headers) headers.append(header.Name, header.Value);
  headers.set("Content-Type", "application/json");
  headers.set("X-PM-Webhook-Trace-Id", traceId);
  if (retriesRemaining !== null) headers.set("X-PM-Retries-Remaining", String(retriesRemaining));
  if (auth !== null) {
    const token = Buffer.from(`${auth.Username}:${auth.Password}`).toString("base64");
    headers.set("Authorization", `Basic ${token}`);
  }
  return { url, headers };
}

/** POSTs and follows up to 10 redirects; the final answer decides (docs/05 §3.3). */
async function post(url: URL, headers: Headers, body: string, timeoutMs: number): Promise<Outcome> {
  let current = url;
  for (let hop = 0; ; hop++) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel();
    } catch (error) {
      const cause = (error as Error & { cause?: Error }).cause;
      return { error: cause?.message ?? (error as Error).message };
    }
    const location = response.headers.get("Location");
    if (response.status < 300 || response.status >= 400 || location === null) {
      return { status: response.status };
    }
    if (hop === MAX_REDIRECTS) return { error: `more than ${MAX_REDIRECTS} redirects` };
    current = new URL(location, current);
  }
}
