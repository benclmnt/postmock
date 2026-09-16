import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  copySuite,
  exec,
  installOnce,
  mustExec,
  PROBE_HOST,
  readKeys,
  runnerDir,
  stamp,
  startSandbox,
} from "../harness.ts";
import type { ResultsFile, TestResult } from "../results.ts";

// Runs the postmark-mcp smoke tests, unmodified, against postmock (docs/08 §5.2).
// Setup follows the README and the file headers: `.env` from the keys, `smoke-test.mjs` as a copy of
// the example, and `smoke-test-mutating.mjs` with SENDER and RECIPIENT set, as its step 2 asks.
// Each smoke test prints one `PASS  <name>` or `FAIL  <name>  — <detail>` line per check.

const SDK = "postmark-mcp";
const SMOKE_TESTS = [
  { example: "smoke-test.example.mjs", copy: "smoke-test.mjs" },
  { example: "smoke-test-mutating.example.mjs", copy: "smoke-test-mutating.mjs" },
];
const CHECK = /^(PASS|FAIL) {2}(.*?)(?: {2}— (.*))?$/;
const SUMMARY = /^\d+\/\d+ passed$/m;

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, ["node_modules", ".postmock-install"]);
  installOnce(suite, [readFileSync(`${suite}/package-lock.json`)], () => {
    rmSync(`${suite}/node_modules`, { recursive: true, force: true });
  });
  await mustExec("npm", ["ci", "--no-audit", "--no-fund"], { cwd: suite, quiet: true });

  const keys = readKeys(SDK);
  writeFileSync(
    `${suite}/.env`,
    Object.entries(keys)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  copyFileSync(`${suite}/smoke-test.example.mjs`, `${suite}/smoke-test.mjs`);
  const mutating = readFileSync(`${suite}/smoke-test-mutating.example.mjs`, "utf8")
    .replace('const SENDER = "you@example.com";', `const SENDER = "${keys.DEFAULT_SENDER_EMAIL}";`)
    .replace(
      'const RECIPIENT = "another-you@example.com";',
      'const RECIPIENT = "recipient@example.com";',
    );
  if (mutating.includes('"you@example.com";')) {
    throw new Error("smoke-test-mutating.example.mjs changed its SENDER placeholder");
  }
  writeFileSync(`${suite}/smoke-test-mutating.mjs`, mutating);

  const sandbox = await startSandbox();
  try {
    const env = {
      ...process.env,
      POSTMOCK_API_URL: sandbox.httpUrl,
      NODE_OPTIONS: `--import=${runnerDir(SDK)}/fetch-shim.mjs`,
    };
    await sandbox.assertGuarded(/postmock fetch shim: refusing/, () =>
      exec("node", ["-e", `await fetch("https://${PROBE_HOST}/")`, "--input-type=module"], {
        env,
        quiet: true,
      }),
    );

    const tests: TestResult[] = [];
    for (const { example, copy } of SMOKE_TESTS) {
      const run = await exec("node", [copy], { cwd: suite, env, quiet: true, timeoutMs: 300_000 });
      const seen = new Map<string, number>();
      for (const line of run.output.split("\n")) {
        const match = CHECK.exec(line);
        if (!match) continue;
        const [, verdict, name = "", detail] = match;
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        const id = `${example} > ${name}${count > 1 ? ` (${count})` : ""}`;
        // The mutating test logs a cleanup step it could not reach as a PASS named "skipped".
        if (/skipped/.test(name)) tests.push({ id, state: "skip" });
        else if (verdict === "PASS") tests.push({ id, state: "pass" });
        else tests.push({ id, state: "fail", error: detail ?? "" });
      }
      // A crash stops the checks after it; the script never prints its summary.
      const finished = SUMMARY.test(run.output);
      tests.push({
        id: `${example} > finishes`,
        ...(finished
          ? { state: "pass" as const }
          : { state: "fail" as const, error: run.output.trim().split("\n").slice(-1)[0] ?? "" }),
      });
    }
    sandbox.assertRouted();
    return results(tests);
  } finally {
    await sandbox.close();
  }
}
