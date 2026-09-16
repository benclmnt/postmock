import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { PUBLIC_IP, runOnline, startDockerSandbox } from "../docker.ts";
import {
  copySuite,
  firstLine,
  mustExec,
  readKeys,
  runnerDir,
  stamp,
  startSandbox,
  testCa,
  workDir,
} from "../harness.ts";
import { parseJUnit } from "../reports.ts";
import type { ResultsFile, TestResult } from "../results.ts";

// Runs the postmark-java JUnit suite, unmodified, against postmock (docs/08 §5.2).
// The client hard-codes api.postmarkapp.com (Postmark.java:21), so the route is DNS plus TLS
// (docs/01 §3.3 option B, docs/09 D4): the suite runs in a container on an internal network where
// the gateway answers as api.postmarkapp.com, and the JVM trusts the test CA.

const SDK = "postmark-java";
const IMAGE = "maven:3.9-eclipse-temurin-17";
const STORE_PASSWORD = "postmock";
const MAVEN = ["-B", "-Dmaven.repo.local=/m2", "-Dgpg.skip", "-Dmaven.javadoc.skip"];

export async function run(): Promise<ResultsFile> {
  const results = stamp(SDK);
  const suite = copySuite(SDK, ["target"]);
  const m2 = `${workDir(SDK)}/m2`;
  mkdirSync(m2, { recursive: true });
  const mounts = { [suite]: "/suite", [m2]: "/m2", [runnerDir(SDK)]: "/runner" };

  // Online, before the sandbox: compile and resolve every plugin, including the surefire JUnit 5
  // provider, which Maven fetches only when a test runs. PostmarkTest only builds clients.
  const resolve = await runOnline({
    image: IMAGE,
    mounts,
    workdir: "/suite",
    command: ["mvn", ...MAVEN, "test", "-Dtest=unit.PostmarkTest"],
    quiet: true,
  });
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
  rmSync(`${suite}/target/surefire-reports`, { recursive: true, force: true });

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
      mounts: { ...mounts, [ca.dir]: "/ca" },
      workdir: "/suite",
      env: {
        ...readKeys(SDK),
        // Surefire forks the test JVM; JAVA_TOOL_OPTIONS reaches it without a pom change.
        JAVA_TOOL_OPTIONS: `-Djavax.net.ssl.trustStore=/ca/truststore.p12 -Djavax.net.ssl.trustStorePassword=${STORE_PASSWORD} -Djavax.net.ssl.trustStoreType=PKCS12`,
      },
    };
    await sandbox.assertGuarded(/Network is unreachable/, () =>
      docker.run({
        ...container,
        command: ["java", "/runner/Probe.java", `https://${PUBLIC_IP}/`],
        quiet: true,
      }),
    );
    // The suite's CI command (sdk/postmark-java/.circleci/config.yml:121), offline.
    const suiteRun = await docker.run({
      ...container,
      command: ["mvn", ...MAVEN, "-o", "test", "-DforkCount=1", "-DreuseForks=false"],
      quiet: true,
    });
    const reports = `${suite}/target/surefire-reports`;
    if (!existsSync(reports)) {
      throw new Error(`the suite wrote no surefire reports:\n${suiteRun.output.slice(-4000)}`);
    }
    sandbox.assertRouted();

    const tests: TestResult[] = readdirSync(reports)
      .filter((f) => f.startsWith("TEST-") && f.endsWith(".xml"))
      .flatMap((f) => parseJUnit(readFileSync(`${reports}/${f}`, "utf8")))
      .map((c) => {
        const qualified = c.attrs.classname ?? "";
        const className = qualified.split(".").pop() ?? "";
        const file = `src/test/java/${qualified.replaceAll(".", "/")}.java`;
        return {
          id: `${file} > ${className}.${c.attrs.name ?? ""}`,
          state: c.state,
          ...(c.error === undefined ? {} : { error: firstLine(c.error) }),
        };
      });
    return results(tests.sort((a, b) => a.id.localeCompare(b.id)));
  } finally {
    await docker.close();
    await sandbox.close();
  }
}
