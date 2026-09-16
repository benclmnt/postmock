import { CONFORMANCE } from "../../seeds/lib/conformance.ts";
import { createControlApp } from "../control/app.ts";
import { applySeed } from "../control/seed.ts";
import { createApiApp } from "../http/app.ts";
import { createRuntime } from "../runtime.ts";
import { newMessageId } from "../state/ids.ts";
import type { OutboundMessage } from "../state/types.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read response bodies without a schema.
type Loose = any;

/** Test support: the conformance seed with API and control clients for server 1. */
export async function recipientsKit() {
  const runtime = createRuntime();
  await applySeed(runtime, "conformance");
  const api = createApiApp(runtime);
  const control = createControlApp(runtime, "conformance");
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    token: string = CONFORMANCE.serverToken,
  ) => {
    const res = await api.request(path, {
      method,
      headers: { "X-Postmark-Server-Token": token, "X-Postmark-Account-Token": token },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as Loose };
  };
  const controlPost = async (path: string, body: unknown) => {
    const res = await control.request(path, { method: "POST", body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Loose };
  };
  /** A delivered message stored as the send pipeline stores it. */
  const deliver = (to: string, stream = "outbound"): OutboundMessage => {
    const message: OutboundMessage = {
      MessageID: newMessageId(),
      ServerID: CONFORMANCE.serverId,
      MessageStream: stream,
      From: CONFORMANCE.senderEmail,
      To: [{ Email: to, Name: null }],
      Cc: [],
      Bcc: [],
      ReplyTo: null,
      Subject: "Hi",
      HtmlBody: null,
      TextBody: "Hi",
      Tag: "welcome",
      Headers: [],
      Attachments: [],
      Metadata: { a: "1" },
      TrackOpens: false,
      TrackLinks: "None",
      Status: "Sent",
      Sandboxed: false,
      ReceivedAt: runtime.clock.now(),
      MessageEvents: [],
      channel: "rest",
      request: {},
      rawSource: "",
      bulkRequestId: null,
      templateId: null,
    };
    runtime.store.state.outbound.set(message.MessageID, message);
    return message;
  };
  return { runtime, call, controlPost, deliver };
}
