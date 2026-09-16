import { readdirSync } from "node:fs";
import {
  copySuite,
  exec,
  mustExec,
  PROBE_HOST,
  readKeys,
  result,
  runnerDir,
  stamp,
  startSandbox,
} from "../harness.ts";
import type { ResultsFile, TestResult } from "../results.ts";

// Runs every postmark-python example against postmock (docs/08 §5.1: the SDK has no live suite).
// `run_example.py` routes the clients and swaps placeholder tokens; the example files stay
// unmodified. An example passes when it exits 0. Examples keep their placeholder IDs (`0`), so a
// pass means the call path works, not that the example found data.
// Guard: httpx honors the proxy env, so any request that skips the base URL reaches the trap.

const SDK = "postmark-python";
const EXAMPLE_TIMEOUT_MS = 60_000;
// The SDK's own client with a base URL outside the route: its HTTP stack must honor the trap.
const SDK_PROBE = `
import postmark
with postmark.sync.ServerClient("postmock-server-token", retries=0, base_url="https://${PROBE_HOST}") as client:
    client.server.get()
`;
// The exception line of a Python traceback: `module.Error: message`.
const EXCEPTION_LINE = /^[A-Za-z_][\w.]*(Error|Exception)\b.*$/gm;

const examples = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".py"))
    .map((f) => `examples/${f}`)
    .sort();

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, [".venv"]);
  const poetryEnv = { ...process.env, POETRY_VIRTUALENVS_IN_PROJECT: "true" };
  // The Python the flake pins (docs/11 B4); poetry otherwise takes any Python on PATH.
  await mustExec("poetry", ["env", "use", "python3.12"], {
    cwd: suite,
    env: poetryEnv,
    quiet: true,
  });
  // The django extra covers examples/django (pyproject.toml:34).
  await mustExec("poetry", ["install", "--no-interaction", "--all-extras"], {
    cwd: suite,
    env: poetryEnv,
    quiet: true,
  });
  const python = `${suite}/.venv/bin/python`;

  const sandbox = await startSandbox();
  try {
    const env = {
      ...process.env,
      ...readKeys(SDK),
      ...sandbox.trapEnv(),
      POSTMOCK_API_URL: sandbox.httpUrl,
    };
    await sandbox.assertGuarded("trap", () =>
      exec(python, ["-c", SDK_PROBE], {
        cwd: suite,
        env,
        quiet: true,
      }),
    );

    const tests: TestResult[] = [];
    for (const example of examples(`${suite}/examples`)) {
      const run = await exec(python, [`${runnerDir(SDK)}/run_example.py`, example], {
        cwd: suite,
        env,
        quiet: true,
        timeoutMs: EXAMPLE_TIMEOUT_MS,
      });
      const id = `${example} > exits 0`;
      if (run.code === 0) {
        tests.push(result(id, "pass"));
        continue;
      }
      const exceptions = run.output.match(EXCEPTION_LINE) ?? [];
      const lines = run.output.trim().split("\n");
      tests.push(result(id, "fail", exceptions.at(-1) ?? lines.at(-1) ?? ""));
    }
    sandbox.assertRouted();
    return results(tests);
  } finally {
    await sandbox.close();
  }
}
