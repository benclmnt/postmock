import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFORMANCE } from "../seeds/lib/conformance.ts";
import type { Plugin } from "./plugins.ts";
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
    const { listeners } = await start();
    const apiUrl = listeners.api as string;
    const res = await getServer(apiUrl);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ID: CONFORMANCE.serverId,
      Name: CONFORMANCE.serverName,
    });
  });

  it("fault `reset` drops the connection", async () => {
    const { listeners } = await start();
    const [apiUrl, controlUrl] = [listeners.api as string, listeners.control as string];
    await fault(controlUrl, "reset");
    await expect(getServer(apiUrl)).rejects.toThrow();
    expect((await getServer(apiUrl)).status).toBe(200);
  });

  it("fault `timeout` never answers", async () => {
    const { listeners } = await start();
    const [apiUrl, controlUrl] = [listeners.api as string, listeners.control as string];
    await fault(controlUrl, "timeout");
    await expect(getServer(apiUrl, AbortSignal.timeout(200))).rejects.toThrow();
  });
});

describe("plugins", () => {
  it("installs on the runtime, starts its listener, and closes it on shutdown", async () => {
    const events: string[] = [];
    const plugin: Plugin = {
      install: (runtime) => {
        runtime.events.on("sent", () => {});
        events.push("install");
      },
      start: async () => {
        events.push("start");
        return {
          name: "smtp",
          url: "smtp://127.0.0.1:2525",
          close: async () => void events.push("close"),
        };
      },
    };
    running = await startPostmock({
      host: "127.0.0.1",
      apiPort: 0,
      controlPort: 0,
      seed: "empty",
      plugins: [plugin],
    });
    expect(running.listeners).toMatchObject({ smtp: "smtp://127.0.0.1:2525" });
    await running.close();
    running = undefined;
    expect(events).toEqual(["install", "start", "close"]);
  });

  it("serves GET /server over https as api.postmarkapp.com to a client that trusts the test CA", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postmock-https-"));
    execFileSync(new URL("../tools/test-ca.sh", import.meta.url).pathname, [dir], {
      stdio: "ignore",
    });
    const pem = (name: string) => readFileSync(join(dir, name), "utf8");
    running = await startPostmock({
      host: "127.0.0.1",
      apiPort: 0,
      controlPort: 0,
      https: { port: 0, key: pem("key.pem"), cert: pem("cert.pem") },
      seed: "conformance",
    });
    const url = new URL(running.listeners.https as string);
    expect(url.protocol).toBe("https:");
    const status = await new Promise<number | undefined>((resolve, reject) => {
      https
        .get(
          {
            host: url.hostname,
            port: url.port,
            path: "/server",
            servername: "api.postmarkapp.com",
            ca: pem("ca.pem"),
            headers: { "X-Postmark-Server-Token": CONFORMANCE.serverToken },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        )
        .on("error", reject);
    });
    expect(status).toBe(200);
  });
});
