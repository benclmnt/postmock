// Shared pieces of the SDK runners: the suite copy, a seeded postmock behind a counting front, a
// trap for traffic that escapes the route, child processes, and the results file.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { type RunningPostmock, startPostmock } from "../src/server.ts";
import { type ResultsFile, type TestResult, totals } from "./results.ts";
import { currentStamp, sdkCommit } from "./stamp.ts";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const sdkDir = (sdk: string) => `${repoRoot}sdk/${sdk}`;
export const runnerDir = (sdk: string) => `${repoRoot}conformance/${sdk}`;
export const workDir = (sdk: string) => `${runnerDir(sdk)}/.work`;

/** `conformance/<sdk>/testing_keys.json`: the values the suite reads. */
export const readKeys = (sdk: string): Record<string, string> =>
  JSON.parse(readFileSync(`${runnerDir(sdk)}/testing_keys.json`, "utf8"));

/**
 * Copies `sdk/<sdk>` to `.work/suite/` with rsync. `sdk/` stays untouched. `keep` names paths the
 * install writes (dependencies, build output), so a rerun does not delete them.
 */
export function copySuite(sdk: string, keep: readonly string[] = []): string {
  const suite = `${workDir(sdk)}/suite`;
  mkdirSync(suite, { recursive: true });
  execFileSync("rsync", [
    "-a",
    "--delete",
    "--exclude=/.git",
    ...keep.map((p) => `--exclude=/${p}`),
    `${sdkDir(sdk)}/`,
    `${suite}/`,
  ]);
  return suite;
}

/**
 * Runs `install` only when the inputs changed since the last successful install.
 * `inputs` are file contents and flags that decide the install (lock files, tool versions).
 */
export function installOnce(
  dir: string,
  inputs: readonly (string | Buffer)[],
  install: () => void,
) {
  const hash = createHash("sha256");
  for (const input of inputs) hash.update(input).update("\0");
  const stamp = hash.digest("hex");
  const stampFile = `${dir}/.postmock-install`;
  if (existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) return;
  install();
  writeFileSync(stampFile, stamp);
}

/** Generates the test CA and the server certificate for the Postmark host names (`tools/test-ca.sh`). */
export function testCa(sdk: string): { dir: string; ca: string; cert: string; key: string } {
  const dir = `${workDir(sdk)}/ca`;
  rmSync(dir, { recursive: true, force: true });
  execFileSync(`${repoRoot}tools/test-ca.sh`, [dir]);
  return { dir, ca: `${dir}/ca.pem`, cert: `${dir}/cert.pem`, key: `${dir}/key.pem` };
}

export interface ExecResult {
  code: number;
  output: string;
}

/**
 * Runs a command, streams its output, and resolves with the exit code and the combined output.
 * A non-zero exit resolves: a failing suite exits non-zero, and its report carries the outcome.
 */
export function exec(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean; timeoutMs?: number } = {},
): Promise<ExecResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  const collect = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
    chunks.push(chunk);
    if (!options.quiet) stream.write(chunk);
  };
  child.stdout.on("data", collect(process.stdout));
  child.stderr.on("data", collect(process.stderr));
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf8");
      resolve({ code: code ?? (signal === "SIGKILL" ? 137 : 1), output });
    });
  });
}

/** `exec` for a setup step: a non-zero exit is a harness failure. */
export async function mustExec(
  command: string,
  args: readonly string[],
  options: Parameters<typeof exec>[2] = {},
): Promise<string> {
  const result = await exec(command, args, options);
  if (result.code !== 0) {
    const tail = options.quiet ? `\n${result.output.split("\n").slice(-40).join("\n")}` : "";
    throw new Error(`${command} ${args.join(" ")} exited ${result.code}${tail}`);
  }
  return result.output;
}

function listen(server: http.Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port));
  });
}

const closeServer = (server: http.Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

/** A host name that never resolves (RFC 6761): the target of a routing probe. */
export const PROBE_HOST = "postmock-probe.invalid";

/** A running postmock seen through a counting front, plus the trap. */
export interface Sandbox {
  mock: RunningPostmock;
  /** `http://127.0.0.1:<port>`: plain http front of the REST listener. */
  httpUrl: string;
  httpPort: number;
  /** TLS front with the test certificate for `api.postmarkapp.com`, when `tls` was given. */
  httpsPort?: number;
  /** `http://127.0.0.1:<port>`: an HTTP proxy that refuses and records every request. */
  trapUrl: string;
  /** REST requests the fronts forwarded to postmock. */
  requests(): number;
  /** Requests that reached the trap: traffic that left the route. */
  trapped(): string[];
  /** Env that sends every non-loopback http(s) request of a proxy-aware client to the trap. */
  trapEnv(): Record<string, string>;
  /** Fails when no request reached postmock or any request reached the trap. */
  assertRouted(): void;
  /**
   * Runs a probe that requests a URL outside the route with the suite's runtime and routing.
   * The probe must fail because of the guard, not by chance: `"trap"` requires the trap to record
   * it; a RegExp must match the probe output (a shim refusal, or an unreachable network).
   * Probe a target that cannot be Postmark (`PROBE_HOST`, a public IP), so a broken guard sends
   * nothing to Postmark.
   */
  assertGuarded(evidence: "trap" | RegExp, probe: () => Promise<ExecResult>): Promise<void>;
  close(): Promise<void>;
}

/**
 * Starts postmock with the `conformance` seed on ephemeral ports, a counting front, and the trap.
 * Everything binds 127.0.0.1; Docker Desktop containers reach it as `host.docker.internal`.
 */
export async function startSandbox(
  options: { tls?: { cert: string; key: string } } = {},
): Promise<Sandbox> {
  const host = "127.0.0.1";
  const mock = await startPostmock({ host, apiPort: 0, controlPort: 0, seed: "conformance" });
  const apiListener = mock.listeners.api;
  if (apiListener === undefined) throw new Error("postmock started without an api listener");
  const api = new URL(apiListener);
  let requests = 0;
  const trapped: string[] = [];

  const forward: http.RequestListener = (req, res) => {
    requests++;
    const upstream = http.request(
      {
        host: api.hostname,
        port: api.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", (error) => res.destroy(error));
    req.pipe(upstream);
  };
  const front = http.createServer(forward);
  const httpPort = await listen(front, host);
  const servers: http.Server[] = [front];

  let httpsPort: number | undefined;
  if (options.tls) {
    const secure = https.createServer(
      { cert: readFileSync(options.tls.cert), key: readFileSync(options.tls.key) },
      forward,
    );
    httpsPort = await listen(secure, host);
    servers.push(secure);
  }

  const trap = http.createServer((req, res) => {
    trapped.push(`${req.method} ${req.url}`);
    res.writeHead(403).end("postmock trap: this request left the conformance route\n");
  });
  trap.on("connect", (req, socket) => {
    trapped.push(`CONNECT ${req.url}`);
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  const trapPort = await listen(trap, host);
  servers.push(trap);
  const trapUrl = `http://${host}:${trapPort}`;

  const sandbox: Sandbox = {
    mock,
    httpUrl: `http://${host}:${httpPort}`,
    httpPort,
    ...(httpsPort === undefined ? {} : { httpsPort }),
    trapUrl,
    requests: () => requests,
    trapped: () => [...trapped],
    trapEnv: () => ({
      HTTP_PROXY: trapUrl,
      HTTPS_PROXY: trapUrl,
      http_proxy: trapUrl,
      https_proxy: trapUrl,
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    }),
    assertRouted() {
      if (trapped.length > 0) {
        throw new Error(`requests left the conformance route: ${trapped.join(", ")}`);
      }
      if (requests === 0) throw new Error("no request reached postmock: the route is broken");
    },
    async assertGuarded(evidence, probe) {
      const before = { requests, trapped: trapped.length };
      const result = await probe();
      const fail = (why: string) => {
        throw new Error(`routing guard: ${why}; probe output:\n${result.output}`);
      };
      if (result.code === 0) fail("the unrouted probe succeeded");
      if (requests !== before.requests) fail("the unrouted probe reached postmock");
      if (evidence === "trap" && trapped.length === before.trapped) {
        fail("the trap did not see the unrouted probe");
      }
      if (evidence instanceof RegExp && !evidence.test(result.output)) {
        fail(`the probe failed without ${evidence}`);
      }
      trapped.splice(before.trapped);
    },
    async close() {
      await Promise.all(servers.map(closeServer));
      await mock.close();
    },
  };
  return sandbox;
}

/** Stamps the results. Call `stamp` before the run, so an edit during the run makes them stale. */
export function stamp(sdk: string): (tests: TestResult[]) => ResultsFile {
  const commit = sdkCommit(sdk);
  const postmock = currentStamp(sdk);
  return (tests) => ({
    sdk,
    sdkCommit: commit,
    postmock,
    finishedAt: new Date().toISOString(),
    totals: totals(tests),
    tests,
  });
}

/** First line of a failure message, for triage. */
export const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";
