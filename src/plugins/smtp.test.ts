import { afterEach, describe, expect, it, vi } from "vitest";
import { type RunningPostmock, startPostmock } from "../server.ts";
import smtp, { smtpEnv } from "./smtp.ts";

describe("smtp plugin env", () => {
  it("defaults to one free port and no TLS", () => {
    expect(smtpEnv.parse({})).toEqual({ POSTMOCK_SMTP_PORTS: [0] });
  });

  it("reads a port list", () => {
    expect(smtpEnv.parse({ POSTMOCK_SMTP_PORTS: "25,587,2525" }).POSTMOCK_SMTP_PORTS).toEqual([
      25, 587, 2525,
    ]);
  });

  it.each([
    [{ POSTMOCK_SMTP_PORTS: "" }],
    [{ POSTMOCK_SMTP_PORTS: "25, 587" }],
    [{ POSTMOCK_SMTP_PORTS: "70000" }],
    [{ POSTMOCK_SMTP_PORTS: "0,2525" }],
    [{ POSTMOCK_SMTP_TLS_KEY: "key.pem" }],
  ])("refuses %j", (env) => {
    expect(smtpEnv.safeParse(env).success).toBe(false);
  });
});

describe("smtp plugin", () => {
  let running: RunningPostmock | undefined;
  afterEach(async () => {
    await running?.close();
    vi.unstubAllEnvs();
  });

  it("starts the listener with postmock and names it in the listeners", async () => {
    vi.stubEnv("POSTMOCK_SMTP_PORTS", "0");
    running = await startPostmock({
      host: "127.0.0.1",
      apiPort: 0,
      controlPort: 0,
      seed: "empty",
      clock: "real",
      plugins: [smtp],
    });
    expect(running.listeners.smtp).toMatch(/^smtp:\/\/127\.0\.0\.1:\d+$/);
  });
});
