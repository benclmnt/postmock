import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { IMAGES, PUBLIC_IP, runContainer, withContainerSandbox } from "../docker.ts";
import { completeResults, copySuite, mustExec, result, runnerDir, stamp } from "../harness.ts";
import { parseJUnit } from "../reports.ts";
import type { ResultsFile } from "../results.ts";

// Runs the postmark-php PHPUnit suite, unmodified, against postmock (docs/08 §5.2).
// Route: BASE_URL. A URI test compares only scheme and host (PostmarkClientEmailTest.php:260-263),
// so the mock must answer on port 80: the suite runs in a container on an internal network where
// `postmock` is the gateway. Nothing else resolves there.
// PostmarkClientBounceTest sleeps 180 s once sending works (PostmarkClientBounceTest.php:55).

const SDK = "postmark-php";
const REPORT = "build/unit_report.xml"; // phpunit.xml.dist <logging>
const LIST = "build/postmock-list.xml";

/** `Postmark\Tests\PostmarkClientBounceTest` + `testX` → `tests/PostmarkClientBounceTest.php > PostmarkClientBounceTest::testX`. */
function idOf(fullClass: string, test: string): string {
  const className = fullClass.split("\\").pop() ?? "";
  return `tests/${className}.php > ${className}::${test}`;
}

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, ["vendor"]);
  // TestingKeys.php:28 reads the keys file from the suite root.
  copyFileSync(`${runnerDir(SDK)}/testing_keys.json`, `${suite}/testing_keys.json`);
  // Composer resolves from packagist on the host; the container only runs the installed suite.
  await mustExec("composer", ["install", "--no-interaction", "--no-progress"], {
    cwd: suite,
    quiet: true,
  });
  rmSync(`${suite}/build`, { recursive: true, force: true });
  // phpunit creates the JUnit report folder, but not the folder of the listing.
  mkdirSync(`${suite}/build`);
  const container = { image: IMAGES.php, mounts: { [suite]: "/suite" }, workdir: "/suite" };
  // The listing includes tests whose class hook fails; the JUnit report leaves those out.
  const listing = await runContainer(
    { ...container, command: ["vendor/bin/phpunit", "--list-tests-xml", LIST], quiet: true },
    "none",
  );
  if (listing.code !== 0) throw new Error(`phpunit --list-tests-xml failed:\n${listing.output}`);
  const listed = [
    ...readFileSync(`${suite}/${LIST}`, "utf8").matchAll(/<testCaseMethod id="([^"]*)::([^"]*)"/g),
  ].map((m) => idOf(m[1] ?? "", m[2] ?? ""));

  return withContainerSandbox({ sdk: SDK, aliases: ["postmock"] }, async ({ sandbox, run }) => {
    const env = { BASE_URL: "http://postmock" };
    await sandbox.assertGuarded(/Network is unreachable/, () =>
      run({
        ...container,
        env,
        command: [
          "php",
          "-r",
          `exit(file_get_contents("https://${PUBLIC_IP}/") === false ? 1 : 0);`,
        ],
        quiet: true,
      }),
    );
    const suiteRun = await run({ ...container, env, command: ["vendor/bin/phpunit"], quiet: true });
    sandbox.assertRouted();

    const ran = parseJUnit(readFileSync(`${suite}/${REPORT}`, "utf8")).map((c) => {
      const fullClass = c.attrs.class ?? "";
      // PHPUnit starts the failure text with `<class>::<test>`; the cause is on the next line.
      const cause = c.error
        ?.split("\n")
        .find((line) => line.trim() !== "" && !line.startsWith(`${fullClass}::`));
      return result(idOf(fullClass, c.attrs.name ?? ""), c.state, cause ?? c.error);
    });
    // A failed setUpBeforeClass shows in the text output as `N) <class>` and the error below it.
    const classError = (id: string) => {
      const className = id.split(" > ")[1]?.split("::")[0] ?? "";
      const lines = suiteRun.output.split("\n");
      const at = lines.findIndex((line) => new RegExp(`^\\d+\\) .*\\\\${className}$`).test(line));
      return at === -1 ? "PHPUnit reported no result" : (lines[at + 1] ?? "").trim();
    };
    return results(completeResults(listed, ran, classError));
  });
}
