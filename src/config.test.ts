import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFlags, configFromEnv } from "./config.ts";

describe("applyFlags", () => {
  it("writes each flag into its env key; a flag wins over the env", () => {
    const env: NodeJS.ProcessEnv = { POSTMOCK_API_PORT: "9000", POSTMOCK_SEED: "empty" };
    expect(applyFlags(["--api-port", "9001", "--smtp-ports", "2525"], env)).toBe("run");
    expect(env).toEqual({
      POSTMOCK_API_PORT: "9001",
      POSTMOCK_SEED: "empty",
      POSTMOCK_SMTP_PORTS: "2525",
    });
  });

  it("returns help for --help", () => {
    expect(applyFlags(["--help"], {})).toBe("help");
  });

  it.each([
    [["--bogus", "1"], {}],
    [["conformance"], {}],
    [["--seed", ""], {}],
    [[], { POSTMOCK_SMTP_TLS_KEY: "" }],
  ])("refuses %j with env %j", (argv, env) => {
    expect(() => applyFlags(argv, env)).toThrow();
  });
});

describe("configFromEnv", () => {
  it("defaults to loopback, 8080, 8025 and the empty seed, without https", () => {
    expect(configFromEnv({})).toEqual({
      host: "127.0.0.1",
      apiPort: 8080,
      controlPort: 8025,
      seed: "empty",
    });
  });

  it.each([
    [{ POSTMOCK_API_PORT: "0x50" }],
    [{ POSTMOCK_API_PORT: " 80" }],
    [{ POSTMOCK_CONTROL_PORT: "1e3" }],
    [{ POSTMOCK_API_PORT: "70000" }],
    [{ POSTMOCK_HOST: "" }],
    [{ POSTMOCK_HTTPS_PORT: "443" }],
  ])("refuses %j", (env) => {
    expect(() => configFromEnv(env)).toThrow();
  });

  it("names the env key of a missing PEM file", () => {
    const dir = mkdtempSync(join(tmpdir(), "postmock-config-"));
    const cert = join(dir, "cert.pem");
    writeFileSync(cert, "not read yet");
    expect(() =>
      configFromEnv({
        POSTMOCK_HTTPS_PORT: "0",
        POSTMOCK_HTTPS_TLS_KEY: join(dir, "missing.pem"),
        POSTMOCK_HTTPS_TLS_CERT: cert,
      }),
    ).toThrow(/^POSTMOCK_HTTPS_TLS_KEY: no file at /);
  });
});
