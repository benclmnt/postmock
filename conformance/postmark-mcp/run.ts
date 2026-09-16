import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { CONFORMANCE } from "../../seeds/lib/conformance.ts";
import {
  copySuite,
  exec,
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
const SPAWN_PROBE = `
import spawn from "cross-spawn";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
const child = spawn("node", ["-e", 'fetch("https://${PROBE_HOST}/")'], {
  env: getDefaultEnvironment(),
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
`;
const CHECK = /^(PASS|FAIL) {2}(.*?)(?: {2}— (.*))?$/;
const SUMMARY = /^\d+\/\d+ passed$/m;

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, ["node_modules"]);
  await mustExec("npm", ["ci", "--no-audit", "--no-fund"], { cwd: suite, quiet: true });

  const keys = readKeys(SDK);
  writeFileSync(
    `${suite}/.env`,
    Object.entries(keys)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  copyFileSync(`${suite}/smoke-test.example.mjs`, `${suite}/smoke-test.mjs`);
  const placeholders = {
    'const SENDER = "you@example.com";': `const SENDER = "${CONFORMANCE.senderEmail}";`,
    'const RECIPIENT = "another-you@example.com";': `const RECIPIENT = "${CONFORMANCE.recipientEmail}";`,
  };
  let mutating = readFileSync(`${suite}/smoke-test-mutating.example.mjs`, "utf8");
  for (const [placeholder, value] of Object.entries(placeholders)) {
    if (!mutating.includes(placeholder)) {
      throw new Error(`smoke-test-mutating.example.mjs no longer contains ${placeholder}`);
    }
    mutating = mutating.replace(placeholder, value);
  }
  writeFileSync(`${suite}/smoke-test-mutating.mjs`, mutating);

  const sandbox = await startSandbox();
  try {
    const env = {
      ...process.env,
      POSTMOCK_API_URL: sandbox.httpUrl,
      NODE_OPTIONS: `--import=${JSON.stringify(`${runnerDir(SDK)}/fetch-shim.mjs`)}`,
    };
    // Every fetch happens in the MCP server the smoke tests spawn, so the probe spawns a child the
    // way the MCP stdio transport does: cross-spawn with the filtered default environment.
    const transport = `${suite}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js`;
    if (!readFileSync(transport, "utf8").includes("from 'cross-spawn'")) {
      throw new Error(
        `${transport} no longer spawns with cross-spawn; update the probe and the shim`,
      );
    }
    await sandbox.assertGuarded(/postmock fetch shim: refusing/, () =>
      exec("node", ["--input-type=module", "-e", SPAWN_PROBE], { cwd: suite, env, quiet: true }),
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
        if (verdict === "PASS" && /skipped/.test(name)) tests.push({ id, state: "skip" });
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
