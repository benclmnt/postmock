import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startPostmock } from "../../src/server.ts";
import { type ResultsFile, type TestResult, totals } from "../results.ts";
import { currentStamp, sdkCommit } from "../stamp.ts";

// Runs the postmark.js live integration suite, unmodified, against postmock (docs/08 §5.2).
// A copy under `.work/` holds the install, so `sdk/` stays untouched.

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const sdkDir = path("../../sdk/postmark.js");
const workDir = path(".work");
const keys = JSON.parse(readFileSync(path("testing_keys.json"), "utf8")) as Record<string, string>;
const SUITE = "test/integration/**/*.test.ts";

interface MochaTest {
  fullTitle: string;
  file: string;
  err: { message?: string } | Record<string, never>;
}
interface MochaReport {
  tests: MochaTest[];
  passes: MochaTest[];
  pending: MochaTest[];
  failures: MochaTest[];
}

function prepare(): void {
  execFileSync("rsync", [
    "-a",
    "--delete",
    "--exclude=/.git",
    "--exclude=/node_modules",
    "--exclude=/.postmock-install",
    "--exclude=/.env",
    `${sdkDir}/`,
    `${workDir}/`,
  ]);
  // The versions the suite's CI installs (sdk/postmark.js/.circleci/config.yml:43-50).
  const lock = readFileSync(`${workDir}/package-lock.json`);
  const stamp = createHash("sha256").update(lock).update("typescript@4.7.4").digest("hex");
  const stampFile = `${workDir}/.postmock-install`;
  if (!existsSync(stampFile) || readFileSync(stampFile, "utf8") !== stamp) {
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: workDir, stdio: "inherit" });
    execFileSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", "typescript@4.7.4"], {
      cwd: workDir,
      stdio: "inherit",
    });
    writeFileSync(stampFile, stamp);
  }
}

function mocha(args: string[], env: NodeJS.ProcessEnv, output: string): Promise<MochaReport> {
  const child = spawn(
    `${workDir}/node_modules/.bin/mocha`,
    [
      "--timeout",
      "30000",
      "-r",
      "ts-node/register",
      "-r",
      path("fetch-shim.cjs"),
      "--reporter",
      "json",
      "--reporter-option",
      `output=${output}`,
      ...args,
      SUITE,
    ],
    { cwd: workDir, env, stdio: "inherit" },
  );
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    // Mocha exits non-zero when a test fails; the report carries the outcome.
    child.on("exit", () => {
      if (!existsSync(output)) return reject(new Error(`mocha wrote no report to ${output}`));
      resolve(JSON.parse(readFileSync(output, "utf8")) as MochaReport);
    });
  });
}

const idOf = (t: MochaTest) => `${t.file.slice(workDir.length + 1)} > ${t.fullTitle}`;
const firstLine = (t: MochaTest) =>
  ("message" in t.err ? (t.err.message ?? "") : "").split("\n")[0];

export async function run(): Promise<ResultsFile> {
  const commit = sdkCommit("postmark.js");
  const postmock = currentStamp("postmark.js");
  prepare();
  const mock = await startPostmock({
    host: "127.0.0.1",
    apiPort: 0,
    controlPort: 0,
    seed: "conformance",
  });
  try {
    const env = {
      ...process.env,
      ...keys,
      POSTMOCK_API_URL: mock.listeners.api,
      // ts-node compiles the suite, as in its CI; Node's own type stripping would load it instead.
      NODE_OPTIONS: "--no-experimental-strip-types",
    };
    const listed = await mocha(["--dry-run"], env, `${workDir}/.postmock-list.json`);
    const report = await mocha([], env, `${workDir}/.postmock-report.json`);

    const passed = new Set(report.passes.map(idOf));
    const pending = new Set(report.pending.map(idOf));
    const failures = new Map(report.failures.map((t) => [idOf(t), t]));
    // A failed hook stops the tests after it; they are failures with the hook's error.
    const hookFailure = (file: string) =>
      report.failures.find((f) => f.file === file && f.fullTitle.includes('" hook'));

    const tests: TestResult[] = listed.tests.map((t) => {
      const id = idOf(t);
      if (passed.has(id)) return { id, state: "pass" };
      if (pending.has(id)) return { id, state: "skip" };
      const failure = failures.get(id) ?? hookFailure(t.file);
      const error = failure
        ? `${failure === failures.get(id) ? "" : "not run: "}${firstLine(failure)}`
        : "not run";
      return { id, state: "fail", error };
    });
    return {
      sdk: "postmark.js",
      sdkCommit: commit,
      postmock,
      finishedAt: new Date().toISOString(),
      totals: totals(tests),
      tests,
    };
  } finally {
    await mock.close();
  }
}
