import { describe, expect, it, vi } from "vitest";
import { errorBody } from "../errors.ts";
import type { SubmitResult } from "../pipeline/submit.ts";
import { createRuntime } from "../runtime.ts";
import { createServer } from "../state/servers.ts";
import { suppressionKey } from "../state/store.ts";
import type { OutboundMessage } from "../state/types.ts";

const submit = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock("../pipeline/submit.ts", () => ({
  submitOutbound: async () => submit.result,
}));
const { receive } = await import("./receive.ts");

// The W0 stub never answers partiallySuppressed; this pins how SMTP turns it into bounces.
describe("receive with some recipients suppressed", () => {
  it("delivers the message and bounces only the suppressed recipients, with its MessageID", async () => {
    const runtime = createRuntime([]);
    const server = createServer(runtime.store, runtime.clock.now());
    const now = runtime.clock.now();
    runtime.store.state.suppressions.set(
      suppressionKey(server.ID, "outbound", "gone@example.com"),
      {
        ServerID: server.ID,
        MessageStream: "outbound",
        EmailAddress: "gone@example.com",
        SuppressionReason: "HardBounce",
        Origin: "Recipient",
        CreatedAt: now,
      },
    );
    const message = {
      MessageID: "b7bc2f4a-e38e-4336-af7d-e6c392c2f817",
      ServerID: server.ID,
      MessageStream: "outbound",
      To: [
        { Email: "ok@example.com", Name: null },
        { Email: "Gone@example.com", Name: null },
      ],
      Cc: [],
      Bcc: [],
      Tag: null,
      rawSource: "",
    } as unknown as OutboundMessage;
    const error = errorBody(406, {
      message: "You tried to send to recipient(s) that have been marked as inactive.",
    });
    submit.result = { outcome: "partiallySuppressed", message, error } satisfies SubmitResult;
    const raw = "From: a@example.com\r\nTo: ok@example.com, Gone@example.com\r\n\r\nHi\r\n";

    const id = await receive(runtime, { server, tokenStream: null }, Buffer.from(raw), [
      "ok@example.com",
      "Gone@example.com",
    ]);

    expect(id).toBe(message.MessageID);
    expect(message.rawSource).toContain(`X-PM-Message-Id: ${message.MessageID}`);
    expect([...runtime.store.state.bounces.values()]).toMatchObject([
      { Email: "Gone@example.com", MessageID: message.MessageID, Type: "SMTPApiError" },
    ]);
  });
});
