import { afterEach, describe, expect, it } from "vitest";
import { CONFORMANCE } from "../seeds/lib/conformance.ts";
import { type RunningPostmock, startPostmock } from "./server.ts";

let running: RunningPostmock | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const start = async () => {
  running = await startPostmock({
    host: "127.0.0.1",
    apiPort: 0,
    controlPort: 0,
    seed: "conformance",
  });
  return running;
};

const fault = (controlUrl: string, reply: unknown) =>
  fetch(`${controlUrl}/control/faults`, {
    method: "POST",
    body: JSON.stringify({ match: { method: "GET", path: "/server" }, reply }),
  });

const getServer = (apiUrl: string, signal?: AbortSignal) =>
  fetch(`${apiUrl}/server`, {
    headers: { "X-Postmark-Server-Token": CONFORMANCE.serverToken },
    ...(signal && { signal }),
  });

describe("startPostmock", () => {
  it("serves GET /server end to end over http", async () => {
    const { apiUrl } = await start();
    const res = await getServer(apiUrl);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ID: 1, Name: CONFORMANCE.serverName });
  });

  it("fault `reset` drops the connection", async () => {
    const { apiUrl, controlUrl } = await start();
    await fault(controlUrl, "reset");
    await expect(getServer(apiUrl)).rejects.toThrow();
    expect((await getServer(apiUrl)).status).toBe(200);
  });

  it("fault `timeout` never answers", async () => {
    const { apiUrl, controlUrl } = await start();
    await fault(controlUrl, "timeout");
    await expect(getServer(apiUrl, AbortSignal.timeout(200))).rejects.toThrow();
  });
});
