// The Ruby runners (postmark-gem, postmark-rails): bundle the suite, preload a route shim with
// `rspec --require`, and read RSpec's JSON report.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  copySuite,
  exec,
  firstLine,
  mustExec,
  PROBE_HOST,
  readKeys,
  stamp,
  startSandbox,
  workDir,
} from "./harness.ts";
import type { ResultsFile, TestResult } from "./results.ts";

// Postmark::HttpClient takes the host, port and TLS flag as options (postmark-gem
// lib/postmark/http_client.rb:15-29). The shim forces them to postmock and refuses every other
// TCP connection, so nothing reaches the network.
const SHIM = `require 'net/http'
require 'uri'
require 'postmark'

module PostmockRoute
  TARGET = URI(ENV.fetch('POSTMOCK_API_URL'))

  module HttpClient
    def initialize(api_token, options = {})
      super(api_token, options.merge(:host => TARGET.host, :port => TARGET.port, :secure => false))
    end
  end

  # Net::HTTP opens its socket with TCPSocket.open. The postmark-gem spec helper loads FakeWeb, which
  # aliases Net::HTTP#connect, so the guard sits below Net::HTTP. IO.open does not dispatch to a
  # Ruby-level new, so both are guarded.
  module RefuseOtherHosts
    def self.check(host, port)
      return if host == TARGET.host && port.to_i == TARGET.port
      raise "postmock route: refusing a connection to #{host}:#{port}"
    end

    def open(host, port, *rest, &block)
      RefuseOtherHosts.check(host, port)
      super
    end

    def new(host, port, *rest)
      RefuseOtherHosts.check(host, port)
      super
    end
  end
end

Postmark::HttpClient.prepend(PostmockRoute::HttpClient)
TCPSocket.singleton_class.prepend(PostmockRoute::RefuseOtherHosts)
`;

interface RspecReport {
  examples: Array<{
    full_description: string;
    file_path: string;
    status: "passed" | "failed" | "pending";
    exception?: { class: string; message: string };
  }>;
}

/**
 * `pins` are gem requirements added next to the suite's own Gemfile, for gems the Gemfile leaves
 * open and whose newest release breaks the suite. A wrapper Gemfile in `.work/` evaluates the
 * suite Gemfile and adds them.
 */
export async function runRspec(
  sdk: string,
  specs: readonly string[],
  pins: Readonly<Record<string, string>> = {},
): Promise<ResultsFile> {
  const results = stamp(sdk);
  const work = workDir(sdk);
  const suite = copySuite(sdk);
  const shim = `${work}/mock_host.rb`;
  writeFileSync(shim, SHIM);
  const gemfile = `${work}/Gemfile`;
  writeFileSync(
    gemfile,
    [
      'eval_gemfile File.expand_path("suite/Gemfile", __dir__)',
      ...Object.entries(pins).map(([gem, requirement]) => `gem "${gem}", "${requirement}"`),
      "",
    ].join("\n"),
  );
  // Gems and the lock file go outside the suite copy, so rsync never deletes them.
  const env = {
    ...process.env,
    ...readKeys(sdk),
    BUNDLE_GEMFILE: gemfile,
    BUNDLE_PATH: `${work}/bundle`,
    BUNDLE_APP_CONFIG: `${work}/bundle-config`,
  };
  await mustExec("bundle", ["install"], { cwd: suite, env, quiet: true });

  const sandbox = await startSandbox();
  try {
    const routed = { ...env, POSTMOCK_API_URL: sandbox.httpUrl };
    await sandbox.assertGuarded(/postmock route: refusing/, () =>
      exec(
        "bundle",
        ["exec", "ruby", "-r", shim, "-e", `Net::HTTP.get(URI("https://${PROBE_HOST}/"))`],
        { cwd: suite, env: routed, quiet: true },
      ),
    );
    const report = `${work}/rspec.json`;
    rmSync(report, { force: true });
    const suiteRun = await exec(
      "bundle",
      ["exec", "rspec", "--require", shim, "--format", "json", "--out", report, ...specs],
      { cwd: suite, env: routed, quiet: true },
    );
    if (!existsSync(report) || readFileSync(report, "utf8") === "") {
      throw new Error(`rspec wrote no report:\n${suiteRun.output.slice(0, 4000)}`);
    }
    sandbox.assertRouted();

    const { examples } = JSON.parse(readFileSync(report, "utf8")) as RspecReport;
    const tests: TestResult[] = examples.map((e) => {
      const id = `${e.file_path.replace(/^\.\//, "")} > ${e.full_description}`;
      if (e.status === "passed") return { id, state: "pass" };
      if (e.status === "pending") return { id, state: "skip" };
      const error = e.exception ? `${e.exception.class}: ${e.exception.message}` : "failed";
      return { id, state: "fail", error: firstLine(error) };
    });
    return results(tests.sort((a, b) => a.id.localeCompare(b.id)));
  } finally {
    await sandbox.close();
  }
}
