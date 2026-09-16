import { copyFileSync, readFileSync, rmSync } from "node:fs";
import {
  copySuite,
  exec,
  firstLine,
  mustExec,
  PROBE_HOST,
  runnerDir,
  stamp,
  startSandbox,
} from "../harness.ts";
import { parseTrx } from "../reports.ts";
import type { ResultsFile, TestResult } from "../results.ts";

// Runs the postmark-dotnet xUnit suite, unmodified, against postmock (docs/08 §5.2).
// Route: BASE_URL (sdk/postmark-dotnet/src/Postmark.Tests/ClientBaseFixture.cs:84). Guard: .NET
// HttpClient sends every non-loopback request to the trap proxy.

const SDK = "postmark-dotnet";
const PROJECT = "src/Postmark.Tests";
const TEST_NAMESPACE = "Postmark.Tests.";
const BUILD = ["--configuration", "release", "-p:TargetFramework=net8.0"];

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, [
    "src/Postmark/bin",
    "src/Postmark/obj",
    `${PROJECT}/bin`,
    `${PROJECT}/obj`,
  ]);
  // The fixture looks for testing_keys.json in every folder above the test assembly (ClientBaseFixture.cs:43-63).
  for (const file of ["testing_keys.json", "Directory.Build.props"]) {
    copyFileSync(`${runnerDir(SDK)}/${file}`, `${suite}/${file}`);
  }
  const dotnetEnv = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1" };
  await mustExec("dotnet", ["build", PROJECT, ...BUILD], {
    cwd: suite,
    env: dotnetEnv,
    quiet: true,
  });

  const sandbox = await startSandbox();
  try {
    const env = { ...dotnetEnv, ...sandbox.trapEnv(), BASE_URL: sandbox.httpUrl };
    await sandbox.assertGuarded("trap", () =>
      exec("dotnet", ["fsi", `${runnerDir(SDK)}/probe.fsx`, `https://${PROBE_HOST}/`], {
        env,
        quiet: true,
      }),
    );
    const trx = `${suite}/postmock-results.trx`;
    rmSync(trx, { force: true });
    await exec(
      "dotnet",
      [
        "test",
        PROJECT,
        "--no-build",
        ...BUILD,
        "--logger",
        `trx;LogFileName=${trx}`,
        // Some tests count templates and streams on the shared server; parallel classes race them
        // (docs/08 §5.3).
        "--",
        "xUnit.ParallelizeTestCollections=false",
      ],
      { cwd: suite, env, quiet: true },
    );
    sandbox.assertRouted();

    const tests: TestResult[] = parseTrx(readFileSync(trx, "utf8")).map((c) => {
      const name = c.attrs.testName ?? "";
      const title = name.startsWith(TEST_NAMESPACE) ? name.slice(TEST_NAMESPACE.length) : name;
      const file = `${PROJECT}/${title.split(".")[0]}.cs`;
      return {
        id: `${file} > ${title}`,
        state: c.state,
        ...(c.error === undefined ? {} : { error: firstLine(c.error) }),
      };
    });
    return results(tests.sort((a, b) => a.id.localeCompare(b.id)));
  } finally {
    await sandbox.close();
  }
}
