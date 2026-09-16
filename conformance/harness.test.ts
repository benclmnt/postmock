import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { type Sandbox, startSandbox } from "./harness.ts";

const connect = (proxy: string, target: string) =>
  new Promise<number>((resolve, reject) => {
    const url = new URL(proxy);
    http
      .request({ host: url.hostname, port: url.port, method: "CONNECT", path: target })
      .on("connect", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode ?? 0);
      })
      .on("error", reject)
      .end();
  });

describe("sandbox routing proof", () => {
  let sandbox: Sandbox;
  afterEach(() => sandbox.close());

  it("counts requests that reach postmock through the front", async () => {
    sandbox = await startSandbox();
    expect(() => sandbox.assertRouted()).toThrow(/no request reached postmock/);
    const res = await fetch(`${sandbox.httpUrl}/server`, {
      headers: { "X-Postmark-Server-Token": "postmock-server-token" },
    });
    expect(res.status).toBe(200);
    expect(sandbox.requests()).toBe(1);
    expect(() => sandbox.assertRouted()).not.toThrow();
  });

  it("fails the run when a request reaches the trap", async () => {
    sandbox = await startSandbox();
    await fetch(`${sandbox.httpUrl}/server`);
    expect(await connect(sandbox.trapUrl, "api.postmarkapp.com:443")).toBe(403);
    expect(() => sandbox.assertRouted()).toThrow(/CONNECT api.postmarkapp.com:443/);
  });

  it("accepts a probe only when it fails through the guard", async () => {
    sandbox = await startSandbox();
    const failed = { code: 1, output: "postmock route: refusing" };
    await expect(
      sandbox.assertGuarded(/refusing/, async () => ({ ...failed, code: 0 })),
    ).rejects.toThrow(/succeeded/);
    await expect(
      sandbox.assertGuarded(/refusing/, async () => ({
        ...failed,
        output: "getaddrinfo ENOTFOUND",
      })),
    ).rejects.toThrow(/without/);
    await expect(sandbox.assertGuarded("trap", async () => failed)).rejects.toThrow(/trap did not/);
    await expect(sandbox.assertGuarded(/refusing/, async () => failed)).resolves.toBeUndefined();
  });

  it("forgets the probe's own trap hit once the probe passed", async () => {
    sandbox = await startSandbox();
    await sandbox.assertGuarded("trap", async () => {
      await connect(sandbox.trapUrl, "postmock-probe.invalid:443");
      return { code: 1, output: "" };
    });
    await fetch(`${sandbox.httpUrl}/server`);
    expect(() => sandbox.assertRouted()).not.toThrow();
  });
});
