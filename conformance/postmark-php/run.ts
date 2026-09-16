import { copyFileSync, readFileSync, rmSync } from "node:fs";
import { PUBLIC_IP, startDockerSandbox } from "../docker.ts";
import {
  copySuite,
  firstLine,
  installOnce,
  mustExec,
  runnerDir,
  stamp,
  startSandbox,
} from "../harness.ts";
import { parseJUnit } from "../reports.ts";
import type { ResultsFile, TestResult } from "../results.ts";

// Runs the postmark-php PHPUnit suite, unmodified, against postmock (docs/08 §5.2).
// Route: BASE_URL. A URI test compares only scheme and host (PostmarkClientEmailTest.php:260-263),
// so the mock must answer on port 80: the suite runs in a container on an internal network where
// `postmock` is the gateway. Nothing else resolves there.
// PostmarkClientBounceTest sleeps 180 s and PostmarkAdminClientDataRemovalTest 10 s; a run takes
// over three minutes.

const SDK = "postmark-php";
const IMAGE = "php:8.3-cli";
const REPORT = "build/unit_report.xml"; // phpunit.xml.dist <logging>

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, ["vendor", "composer.lock", ".postmock-install"]);
  // TestingKeys.php:28 reads the keys file from the suite root.
  copyFileSync(`${runnerDir(SDK)}/testing_keys.json`, `${suite}/testing_keys.json`);
  installOnce(suite, [readFileSync(`${suite}/composer.json`)], () => {
    rmSync(`${suite}/composer.lock`, { force: true });
  });
  // Composer resolves from packagist on the host; the container only runs the installed suite.
  await mustExec("composer", ["install", "--no-interaction", "--no-progress"], {
    cwd: suite,
    quiet: true,
  });
  rmSync(`${suite}/${REPORT}`, { force: true });

  const sandbox = await startSandbox();
  const docker = await startDockerSandbox(sandbox, SDK, ["postmock"]).catch(async (error) => {
    await sandbox.close();
    throw error;
  });
  try {
    const container = {
      image: IMAGE,
      mounts: { [suite]: "/suite" },
      workdir: "/suite",
      env: { BASE_URL: "http://postmock" },
    };
    await sandbox.assertGuarded(/Network is unreachable/, () =>
      docker.run({
        ...container,
        command: [
          "php",
          "-r",
          `exit(file_get_contents("https://${PUBLIC_IP}/") === false ? 1 : 0);`,
        ],
        quiet: true,
      }),
    );
    await docker.run({ ...container, command: ["vendor/bin/phpunit"], quiet: true });
    sandbox.assertRouted();

    const tests: TestResult[] = parseJUnit(readFileSync(`${suite}/${REPORT}`, "utf8")).map((c) => {
      const file = (c.attrs.file ?? "").replace(/^\/suite\//, "");
      const fullClass = c.attrs.class ?? "";
      const className = fullClass.split("\\").pop() ?? "";
      // PHPUnit starts the failure text with `<class>::<test>`; the cause is on the next line.
      const cause = c.error
        ?.split("\n")
        .find((l) => l.trim() !== "" && !l.startsWith(`${fullClass}::`));
      return {
        id: `${file} > ${className}::${c.attrs.name ?? ""}`,
        state: c.state,
        ...(c.error === undefined ? {} : { error: firstLine(cause ?? c.error) }),
      };
    });
    return results(tests.sort((a, b) => a.id.localeCompare(b.id)));
  } finally {
    await docker.close();
    await sandbox.close();
  }
}
