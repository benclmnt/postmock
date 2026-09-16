import { copyFileSync, readFileSync, rmSync } from "node:fs";
import {
  completeResults,
  copySuite,
  exec,
  mustExec,
  PROBE_HOST,
  result,
  runnerDir,
  stamp,
  startSandbox,
} from "../harness.ts";
import { parseTrx } from "../reports.ts";
import type { ResultsFile } from "../results.ts";

// Runs the postmark-dotnet xUnit suite, unmodified, against postmock (docs/08 §5.2).
// Route: BASE_URL (sdk/postmark-dotnet/src/Postmark.Tests/ClientBaseFixture.cs:84). Guard: .NET
// HttpClient sends every non-loopback request to the trap proxy.

const SDK = "postmark-dotnet";
const PROJECT = "src/Postmark.Tests";
const TEST_NAMESPACE = "Postmark.Tests.";
const BUILD = ["--configuration", "release", "-p:TargetFramework=net8.0"];

/** `Postmark.Tests.ClientBounceTests.Client_CanGetBounces` → `<file> > ClientBounceTests.Client_CanGetBounces`. */
function idOf(testName: string): string {
  const title = testName.startsWith(TEST_NAMESPACE)
    ? testName.slice(TEST_NAMESPACE.length)
    : testName;
  return `${PROJECT}/${title.split(".")[0]}.cs > ${title}`;
}

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, [
    "src/Postmark/bin",
    "src/Postmark/obj",
    `${PROJECT}/bin`,
    `${PROJECT}/obj`,
  ]);
  // The fixture looks for testing_keys.json in every folder above the test assembly
  // (ClientBaseFixture.cs:43-63).
  for (const file of ["testing_keys.json", "Directory.Build.props"]) {
    copyFileSync(`${runnerDir(SDK)}/${file}`, `${suite}/${file}`);
  }
  const dotnetEnv = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1" };
  await mustExec("dotnet", ["build", PROJECT, ...BUILD], {
    cwd: suite,
    env: dotnetEnv,
    quiet: true,
  });
  const listing = await mustExec(
    "dotnet",
    ["test", PROJECT, "--no-build", ...BUILD, "--list-tests"],
    {
      cwd: suite,
      env: dotnetEnv,
      quiet: true,
    },
  );
  const header = listing.indexOf("The following Tests are available:");
  const listed = listing
    .slice(header)
    .split("\n")
    .filter((line) => line.startsWith("    "))
    .map((line) => idOf(line.trim()));
  if (header === -1 || listed.length === 0) {
    throw new Error(`dotnet test --list-tests found no test:\n${listing.slice(-4000)}`);
  }

  const sandbox = await startSandbox();
  try {
    const env = { ...dotnetEnv, ...sandbox.trapEnv(), BASE_URL: sandbox.httpUrl };
    const clientDll = `${suite}/${PROJECT}/bin/release/net8.0/Postmark.dll`;
    await sandbox.assertGuarded("trap", () =>
      exec("dotnet", ["fsi", `${runnerDir(SDK)}/probe.fsx`, clientDll, `https://${PROBE_HOST}`], {
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

    const report = readFileSync(trx, "utf8");
    const outcome = /<ResultSummary outcome="([^"]*)"/.exec(report)?.[1] ?? "missing";
    const ran = parseTrx(report).map((c) => result(idOf(c.attrs.testName ?? ""), c.state, c.error));
    return results(completeResults(listed, ran, () => `the test run ended as ${outcome}`));
  } finally {
    await sandbox.close();
  }
}
