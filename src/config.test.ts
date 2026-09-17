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
    [["--bogus", "1"], {}, /Unknown option '--bogus'/],
    [["conformance"], {}, /Unexpected argument 'conformance'/],
    [["--seed", ""], {}, /^POSTMOCK_SEED is empty/],
    [[], { POSTMOCK_SMTP_TLS_KEY: "" }, /^POSTMOCK_SMTP_TLS_KEY is empty/],
  ])("refuses %j with env %j", (argv, env, message) => {
    expect(() => applyFlags(argv, env)).toThrow(message);
  });
});

describe("configFromEnv", () => {
  it("defaults to loopback, 8080, 8025, the empty seed and a real clock, without https", () => {
    expect(configFromEnv({})).toEqual({
      host: "127.0.0.1",
      apiPort: 8080,
      controlPort: 8025,
      seed: "empty",
      clock: "real",
    });
  });

  it.each([
    [{ POSTMOCK_API_PORT: "0x50" }, /POSTMOCK_API_PORT[\s\S]*a decimal port/],
    [{ POSTMOCK_API_PORT: " 80" }, /POSTMOCK_API_PORT[\s\S]*a decimal port/],
    [{ POSTMOCK_CONTROL_PORT: "1e3" }, /POSTMOCK_CONTROL_PORT[\s\S]*a decimal port/],
    [{ POSTMOCK_API_PORT: "70000" }, /POSTMOCK_API_PORT[\s\S]*65535/],
    [{ POSTMOCK_HOST: "" }, /too_small[\s\S]*POSTMOCK_HOST/],
    [{ POSTMOCK_CLOCK: "fast" }, /POSTMOCK_CLOCK/],
    [
      { POSTMOCK_HTTPS_PORT: "443" },
      /^set POSTMOCK_HTTPS_PORT, POSTMOCK_HTTPS_TLS_KEY and POSTMOCK_HTTPS_TLS_CERT, or none$/,
    ],
  ])("refuses %j", (env, message) => {
    expect(() => configFromEnv(env)).toThrow(message);
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
