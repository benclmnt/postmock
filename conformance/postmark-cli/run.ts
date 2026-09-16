import { readFileSync, rmSync } from "node:fs";
import { PUBLIC_IP, startDockerSandbox } from "../docker.ts";
import {
  copySuite,
  installOnce,
  mustExec,
  readKeys,
  stamp,
  startSandbox,
  testCa,
} from "../harness.ts";
import { type MochaReport, mochaResults } from "../mocha.ts";
import type { ResultsFile } from "../results.ts";

// Runs the postmark-cli integration suite, unmodified, against postmock (docs/08 §5.2).
// The CLI talks only https to the default host, and the test helpers ignore any host option
// (sdk/postmark-cli/test/integration/shared.ts:40-57). So the route is DNS plus TLS (docs/01 §3.3
// option B): the suite runs in a container on an internal network where the gateway answers as
// api.postmarkapp.com, and Node trusts the test CA through NODE_EXTRA_CA_CERTS.

const SDK = "postmark-cli";
// The newest Node in the suite's CI matrix (sdk/postmark-cli/.circleci/config.yml:18-20).
const IMAGE = "node:20-alpine";

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, ["node_modules", ".postmock-install"]);
  installOnce(suite, [readFileSync(`${suite}/package-lock.json`)], () => {
    rmSync(`${suite}/node_modules`, { recursive: true, force: true });
  });
  await mustExec("npm", ["ci", "--no-audit", "--no-fund"], { cwd: suite, quiet: true });
  await mustExec("npm", ["run", "build"], { cwd: suite, quiet: true });

  const ca = testCa(SDK);
  const sandbox = await startSandbox({ tls: { cert: ca.cert, key: ca.key } });
  const docker = await startDockerSandbox(sandbox, SDK, ["api.postmarkapp.com"]).catch(
    async (error) => {
      await sandbox.close();
      throw error;
    },
  );
  try {
    const container = {
      image: IMAGE,
      mounts: { [suite]: "/suite", [ca.dir]: "/ca" },
      workdir: "/suite",
      env: { ...readKeys(SDK), NODE_EXTRA_CA_CERTS: "/ca/ca.pem" },
      quiet: true,
    };
    await sandbox.assertGuarded(/ENETUNREACH/, () =>
      docker.run({
        ...container,
        command: [
          "node",
          "-e",
          `fetch("https://${PUBLIC_IP}/").catch((e) => { console.error(e.cause?.code); process.exit(1); })`,
        ],
      }),
    );
    const mocha = async (args: readonly string[], output: string): Promise<MochaReport> => {
      rmSync(`${suite}/${output}`, { force: true });
      const run = await docker.run({
        ...container,
        command: [
          "node_modules/.bin/mocha",
          "--config",
          ".mocharc.integration.json",
          // postmock is deterministic: a test that passes only on a retry shows a postmock bug.
          "--retries",
          "0",
          "--reporter",
          "json",
          "--reporter-option",
          `output=${output}`,
          ...args,
        ],
      });
      try {
        return JSON.parse(readFileSync(`${suite}/${output}`, "utf8")) as MochaReport;
      } catch {
        throw new Error(`mocha wrote no report:\n${run.output.slice(-4000)}`);
      }
    };
    const listed = await mocha(["--dry-run"], ".postmock-list.json");
    const report = await mocha([], ".postmock-report.json");
    sandbox.assertRouted();
    return results(mochaResults(listed, report, "/suite"));
  } finally {
    await docker.close();
    await sandbox.close();
  }
}
