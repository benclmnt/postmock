// The Ruby runners (postmark-gem, postmark-rails): bundle the suite, preload a route shim with
// `rspec --require`, and read RSpec's JSON report.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  copySuite,
  exec,
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
const SHIM = String.raw`require 'net/http'
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

# Writes one tab-separated line per example: status, file, full description, first error line.
# RSpec's JSON formatter calls ActiveSupport's to_json when rails is loaded, which fails on json 3.
if defined?(RSpec::Core::Formatters)
  class PostmockFormatter
    RSpec::Core::Formatters.register self, :example_passed, :example_failed, :example_pending, :close

    def initialize(output)
      @output = output
    end

    def example_passed(notification)
      write('passed', notification.example, '')
    end

    def example_pending(notification)
      write('pending', notification.example, '')
    end

    def example_failed(notification)
      exception = notification.example.execution_result.exception
      write('failed', notification.example, "#{exception.class}: #{exception.message.lines.first}")
    end

    # Marks a complete report: a crash in RSpec leaves this line out.
    def close(_notification)
      @output.puts('done')
    end

    private

    def write(status, example, error)
      fields = [status, example.metadata[:file_path], example.full_description, error]
      @output.puts(fields.map { |f| f.to_s.strip.tr("\t\n", '  ') }.join("\t"))
    end
  end
end

Postmark::HttpClient.prepend(PostmockRoute::HttpClient)
TCPSocket.singleton_class.prepend(PostmockRoute::RefuseOtherHosts)
`;

/** `gemfileEnv`: the knobs a suite's Gemfile reads, which decide the bundle. */
export async function runRspec(
  sdk: string,
  specs: readonly string[],
  gemfileEnv: Readonly<Record<string, string>> = {},
): Promise<ResultsFile> {
  const results = stamp(sdk);
  const work = workDir(sdk);
  const suite = copySuite(sdk, ["Gemfile.lock"]);
  const shim = `${work}/mock_host.rb`;
  writeFileSync(shim, SHIM);
  // Gems go outside the suite copy, so rsync never deletes them.
  const env = {
    ...process.env,
    ...readKeys(sdk),
    ...gemfileEnv,
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
    const report = `${work}/rspec.tsv`;
    rmSync(report, { force: true });
    const suiteRun = await exec(
      "bundle",
      [
        "exec",
        "rspec",
        "--require",
        shim,
        "--format",
        "PostmockFormatter",
        "--out",
        report,
        ...specs,
      ],
      { cwd: suite, env: routed, quiet: true },
    );
    const lines = readFileSync(report, "utf8")
      .split("\n")
      .filter((line) => line !== "");
    if (lines.pop() !== "done") {
      throw new Error(`rspec did not finish its report:\n${suiteRun.output.slice(0, 4000)}`);
    }
    sandbox.assertRouted();

    const tests: TestResult[] = lines.map((line) => {
      const [status, file, description, error] = line.split("\t");
      const id = `${(file ?? "").replace(/^\.\//, "")} > ${description}`;
      if (status === "passed") return { id, state: "pass" };
      if (status === "pending") return { id, state: "skip" };
      return { id, state: "fail", error: error ?? "" };
    });
    return results(tests.sort((a, b) => a.id.localeCompare(b.id)));
  } finally {
    await sandbox.close();
  }
}
