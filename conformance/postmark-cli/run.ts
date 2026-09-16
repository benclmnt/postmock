import { readFileSync, rmSync } from "node:fs";
import { IMAGES, PUBLIC_IP, withContainerSandbox } from "../docker.ts";
import { copySuite, mustExec, readKeys, stamp, testCa } from "../harness.ts";
import { type MochaReport, mochaResults } from "../mocha.ts";
import type { ResultsFile } from "../results.ts";

// Runs the postmark-cli integration suite, unmodified, against postmock (docs/08 §5.2).
// The CLI talks only https to the default host, and the test helpers ignore any host option
// (sdk/postmark-cli/test/integration/shared.ts:40-57). So the route is DNS plus TLS (docs/01 §3.3
// option B): the suite runs in a container on an internal network where the gateway answers as
// api.postmarkapp.com, and Node trusts the test CA through NODE_EXTRA_CA_CERTS.
// The image is the newest Node in the suite's CI matrix (sdk/postmark-cli/.circleci/config.yml:18-20).

const SDK = "postmark-cli";

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, ["node_modules"]);
  await mustExec("npm", ["ci", "--no-audit", "--no-fund"], { cwd: suite, quiet: true });
  await mustExec("npm", ["run", "build"], { cwd: suite, quiet: true });

  const ca = testCa(SDK);
  const tls = { cert: ca.cert, key: ca.key };
  return withContainerSandbox(
    { sdk: SDK, aliases: ["api.postmarkapp.com"], tls },
    async ({ sandbox, run }) => {
      const container = {
        image: IMAGES.node20,
        mounts: { [suite]: "/suite", [ca.dir]: "/ca" },
        workdir: "/suite",
        env: { ...readKeys(SDK), NODE_EXTRA_CA_CERTS: "/ca/ca.pem" },
        quiet: true,
      };
      await sandbox.assertGuarded(/ENETUNREACH/, () =>
        run({
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
        const mochaRun = await run({
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
          throw new Error(`mocha wrote no report:\n${mochaRun.output.slice(-4000)}`);
        }
      };
      const listed = await mocha(["--dry-run"], ".postmock-list.json");
      const report = await mocha([], ".postmock-report.json");
      sandbox.assertRouted();
      return results(mochaResults(listed, report, "/suite"));
    },
  );
}
