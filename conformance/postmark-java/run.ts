import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { IMAGES, PUBLIC_IP, runContainer, withContainerSandbox } from "../docker.ts";
import {
  completeResults,
  copySuite,
  mustExec,
  readKeys,
  result,
  runnerDir,
  stamp,
  testCa,
  workDir,
} from "../harness.ts";
import { parseJUnit } from "../reports.ts";
import type { ResultsFile } from "../results.ts";

// Runs the postmark-java JUnit suite, unmodified, against postmock (docs/08 §5.2).
// The client hard-codes api.postmarkapp.com (Postmark.java:21), so the route is DNS plus TLS
// (docs/01 §3.3 option B, docs/09 D4): the suite runs in a container on an internal network where
// the gateway answers as api.postmarkapp.com, and the JVM trusts the test CA.

const SDK = "postmark-java";
const STORE_PASSWORD = "postmock";
const MAVEN = ["-B", "-Dmaven.repo.local=/m2", "-Dgpg.skip", "-Dmaven.javadoc.skip"];
// The maven image copies its settings to MAVEN_CONFIG; the container user cannot write /root.
const MAVEN_ENV = { MAVEN_CONFIG: "/tmp/.m2" };
// Surefire's default includes (maven-surefire-plugin 2.22.2).
const TEST_CLASS = /^(Test\w*|\w*Test|\w*Tests|\w*TestCase)\.java$/;

/**
 * Test ids from the sources: `@Test` methods in the classes surefire's default includes match.
 * JUnit 5 reports each by method name. The suite has no nested, parameterized or repeated tests.
 */
function listTests(suite: string): string[] {
  const root = `${suite}/src/test/java`;
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => TEST_CLASS.test(f.split("/").pop() ?? ""))
    .flatMap((f) => {
      const className = (f.split("/").pop() ?? "").slice(0, -".java".length);
      const source = readFileSync(`${root}/${f}`, "utf8");
      return [...source.matchAll(/@Test\b[\s\S]*?\bvoid\s+(\w+)\s*\(/g)].map(
        (m) => `src/test/java/${f} > ${className}.${m[1]}`,
      );
    });
}

const fileOf = (qualified: string) => `src/test/java/${qualified.replaceAll(".", "/")}.java`;

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, ["target"]);
  const m2 = `${workDir(SDK)}/m2`;
  mkdirSync(m2, { recursive: true });
  const mounts = { [suite]: "/suite", [m2]: "/m2", [runnerDir(SDK)]: "/runner" };

  // Online, before the sandbox: compile and resolve every plugin, including the surefire JUnit 5
  // provider, which Maven fetches only when a test runs. PostmarkTest only builds clients.
  const resolve = await runContainer(
    {
      image: IMAGES.maven,
      mounts,
      workdir: "/suite",
      env: MAVEN_ENV,
      command: ["mvn", ...MAVEN, "test", "-Dtest=unit.PostmarkTest"],
      quiet: true,
    },
    "bridge",
  );
  if (resolve.code !== 0) throw new Error(`maven resolve failed:\n${resolve.output.slice(-4000)}`);

  const ca = testCa(SDK);
  await mustExec(
    "keytool",
    [
      "-importcert",
      "-noprompt",
      "-alias",
      "postmock",
      "-file",
      ca.ca,
      "-keystore",
      `${ca.dir}/truststore.p12`,
      "-storetype",
      "PKCS12",
      "-storepass",
      STORE_PASSWORD,
    ],
    { quiet: true },
  );
  const reports = `${suite}/target/surefire-reports`;
  rmSync(reports, { recursive: true, force: true });

  const tls = { cert: ca.cert, key: ca.key };
  return withContainerSandbox(
    { sdk: SDK, aliases: ["api.postmarkapp.com"], tls },
    async ({ sandbox, run }) => {
      const container = {
        image: IMAGES.maven,
        mounts: { ...mounts, [ca.dir]: "/ca" },
        workdir: "/suite",
        env: {
          ...readKeys(SDK),
          ...MAVEN_ENV,
          // Surefire forks the test JVM; JAVA_TOOL_OPTIONS reaches it without a pom change.
          JAVA_TOOL_OPTIONS: `-Djavax.net.ssl.trustStore=/ca/truststore.p12 -Djavax.net.ssl.trustStorePassword=${STORE_PASSWORD} -Djavax.net.ssl.trustStoreType=PKCS12`,
        },
      };
      await sandbox.assertGuarded(/Network is unreachable/, () =>
        run({
          ...container,
          command: ["java", "/runner/Probe.java", `https://${PUBLIC_IP}/`],
          quiet: true,
        }),
      );
      // The suite's CI command (sdk/postmark-java/.circleci/config.yml:121), offline.
      const suiteRun = await run({
        ...container,
        command: ["mvn", ...MAVEN, "-o", "test", "-DforkCount=1", "-DreuseForks=false"],
        quiet: true,
      });
      if (!existsSync(reports)) {
        throw new Error(`the suite wrote no surefire reports:\n${suiteRun.output.slice(-4000)}`);
      }
      sandbox.assertRouted();

      const ran = readdirSync(reports)
        .filter((f) => f.startsWith("TEST-") && f.endsWith(".xml"))
        .flatMap((f) => parseJUnit(readFileSync(`${reports}/${f}`, "utf8")))
        .map((c) => {
          const qualified = c.attrs.classname ?? "";
          const className = qualified.split(".").pop() ?? "";
          return result(
            `${fileOf(qualified)} > ${className}.${c.attrs.name ?? ""}`,
            c.state,
            c.error,
          );
        });
      // A crashed fork or a failed class setup leaves tests without a report.
      const tests = completeResults(listTests(suite), ran, () => "surefire reported no result");
      return results(tests);
    },
  );
}
