# Testing

Status: the unit suite and a conformance runner for every official SDK suite are built.

Two questions get answered here:

1. Does each module keep its rules? The vitest unit suite.
2. Does each official SDK work unmodified against postmock? Its own live integration suite (`conformance/`).

## Prerequisites

| Need | How |
| --- | --- |
| Toolchain | `nix develop` (`flake.nix`: Node 24, pnpm, .NET 8, PHP 8.3 + Composer, JDK 17 + Maven, Ruby 3.3, Python 3.12 + Poetry, OpenSSL) |
| Dependencies | `pnpm install` |
| SDK sources, for conformance and doc cites | `tools/fetch-sources.sh` → `sdk/` |
| Postmark docs, for doc cites only | `tools/fetch-refs.sh` → `refs/` |

## Run the mock

```bash
POSTMOCK_SEED=conformance pnpm start
# postmock api=http://127.0.0.1:8080 control=http://127.0.0.1:8025 seed=conformance
curl -s localhost:8080/server -H 'X-Postmark-Server-Token: postmock-server-token'
curl -s -X POST localhost:8025/control/reset
```

Env: `POSTMOCK_HOST`, `POSTMOCK_API_PORT`, `POSTMOCK_CONTROL_PORT`, `POSTMOCK_SEED`, `POSTMOCK_HTTPS_PORT`, `POSTMOCK_HTTPS_TLS_KEY`, `POSTMOCK_HTTPS_TLS_CERT`, `POSTMOCK_SMTP_PORTS`, `POSTMOCK_SMTP_TLS_KEY`, `POSTMOCK_SMTP_TLS_CERT`. Each is also a flag: `pnpm start --seed conformance` (`ARCHITECTURE.md` "Listeners").

## The gates

| Command | Checks | When |
| --- | --- | --- |
| `nix develop -c pnpm check` | `biome check .`, `tsc --noEmit`, `vitest run` | Every commit |
| `nix develop .#node -c tools/pack-smoke.sh` | `npm pack`, install the tarball outside the repo; `dist/` holds a module for every source module; `npm exec postmock`: `GET /server` answers 200, SMTP accepts a nodemailer send | A change to the build, `package.json` or discovery |
| `pnpm conformance <sdk>` | Runs that SDK suite against a fresh postmock; writes `conformance/results/<sdk>.json` | Before merge, for the suites the track touches |
| `pnpm conformance all` | Every runner | Integration (W2) |
| `pnpm conformance:check [sdk]` | The results file comes from the current postmock source, and every baseline test passes in it; no argument checks every runner | Before merge; no regression |

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request.
It needs no secret. Actions are pinned by commit SHA; images by digest. A newer push cancels the running workflow of its ref.

| Job | Runs |
| --- | --- |
| `check` | In the small `nix develop .#node` shell: `pnpm check`, then `tools/pack-smoke.sh` |
| `compose` | `docker compose run --rm --build example-node`: `examples/node/default-hosts.ts` on the internal network, no base-URL option (`docs/01` §3.3 option B); `docker compose -f examples/compose/compose.yaml config -q` |
| `runners` | Lists every `conformance/<sdk>/run.ts` for the matrix |
| `conformance` (one per SDK) | `tools/fetch-sources.sh <sdk>`, `nix develop -c pnpm conformance <sdk>`, `pnpm conformance:check <sdk>`; uploads `conformance/results/<sdk>.json` |
| `compat-table` | After every `conformance` job passes: downloads the results, runs `pnpm compat-table`, and fails when `README.md` changes. Commit the new table when a suite changes its counts. |

The container runners (php, java, cli) run on the Linux runner's Docker Engine: see the `host-gateway` trap below.
Each job downloads its nix shell; there is no nix store cache yet.

## Conformance files

| File | Content | Committed |
| --- | --- | --- |
| `conformance/run.ts` | Finds each `conformance/<sdk>/run.ts` and writes its results | yes |
| `conformance/<sdk>/run.ts` | Prepares the suite, starts postmock with the `conformance` seed, runs the suite, maps each test to pass, fail or skip | yes |
| `conformance/<sdk>/testing_keys.json` | Tokens and addresses the suite reads; they match `seeds/lib/conformance.ts` (a unit test checks) | yes |
| `conformance/<sdk>/skips/<test file>.json` | `{"skipped": [{title, reason, source}]}`: tests of that file that cannot pass. The runner reports them as `skip`, whatever their outcome. A listed test the suite lacks fails the runner after the suite, and it writes no results. | yes |
| `conformance/<sdk>/baseline/<test file>.json` | `{"passing": [full titles]}`: tests of that file that must keep passing. One file per test file, so tracks never co-edit one. | yes |
| `conformance/results/<sdk>.json` | `{sdk, sdkCommit, postmock: {commit, sourceHash}, finishedAt, totals, tests: [{id, state, error?}]}` | no (git-ignored) |
| `conformance/<sdk>/.work/` | The suite copy and its install | no (git-ignored) |

A test id is `<file> > <full title>`, e.g. `test/integration/Server.test.ts > Server getServer`.
The results list every test in the suite, also the tests a failed hook stopped (`error: "not run: …"`).

Ratchet rules:
- `conformance:check` fails when a results file is stale: its `sdkCommit` differs from `sdk/<sdk>`, or its `sourceHash` differs. The hash covers the content of `src/`, `seeds/`, `conformance/*.ts`, `tools/test-ca.sh`, the runner folder without `baseline/` (skips decide skip states, so a skip edit needs a new run), `package.json`, `pnpm-lock.yaml`, `flake.nix` and `flake.lock`. A commit of the tested files or a docs edit keeps results fresh.
- It fails when a test is in both a baseline file and a skip file.
- It fails when a baseline test fails, skips or is missing. It prints tests that pass but are not in the baseline.
- Add newly passing tests to the baseline file of their test file. Only add; never remove a test to make the check pass.
- A test that cannot pass against any mock (real delivery, DNS, external timing) goes to `skips/<test file>.json` with the reason (`docs/11` §3.3).

### postmark.js

- The runner copies `sdk/postmark.js` to `.work/` with rsync and runs `npm ci` plus `typescript@4.7.4` there, as the suite's CI does. `sdk/` stays untouched.
- `mocha -r ts-node/register -r fetch-shim.cjs` runs `test/integration/**/*.test.ts`. The shim sends every `api.postmarkapp.com` request to postmock and throws for any other host.
- The suite reads its tokens from env vars (`testing_keys.json`).
- The runner drops the suite's `--retries 1`. postmock is deterministic, so a test that passes only on a retry shows a postmock bug.

### Routing proof

No suite may reach real Postmark. Every runner except postmark.js starts postmock through `startSandbox` (`conformance/harness.ts`) and proves its route:

| Check | Fails when |
| --- | --- |
| Counting front | No request reached postmock during the suite run (`no request reached postmock`). |
| Trap proxy | Any request reached the trap: it left the route. The runner passes the trap as `HTTP(S)_PROXY` to proxy-aware clients (.NET, httpx). |
| Guard probe | Before the suite, a probe in the suite's runtime and routing requests a target that cannot be Postmark (`postmock-probe.invalid`, or `1.1.1.1` in a container). Where a proxy guards the route, the probe goes through the SDK's own client. It must fail through the guard: the trap records it, or the output shows the shim refusal or an unreachable network (`Network is unreachable`, `ENETUNREACH`). |
| Gateway check | A container route fails at once when the gateway cannot open a TCP connection to the sandbox front. |

### Runners

| SDK | Suite command | Route | Guard |
| --- | --- | --- | --- |
| postmark.js | `mocha` on `test/integration` | fetch shim (`mocha -r`) | shim throws for other hosts |
| postmark-dotnet | `dotnet test src/Postmark.Tests` (the CI command), serial (`xUnit.ParallelizeTestCollections=false`) | `BASE_URL` | trap proxy |
| postmark-php | `vendor/bin/phpunit` (all tests) in `php:8.3-cli` | container; gateway alias `postmock` on port 80; `BASE_URL=http://postmock` | internal network |
| postmark-java | `mvn -o test -DforkCount=1 -DreuseForks=false` (the CI command) in `maven:3.9-eclipse-temurin-17` | container; gateway alias `api.postmarkapp.com` on 80 and 443; test CA in a PKCS12 truststore through `JAVA_TOOL_OPTIONS` | internal network |
| postmark-gem | `rspec spec/integration` | `rspec --require` shim sets host, port and `secure: false` on `Postmark::HttpClient` | shim refuses every other `TCPSocket` |
| postmark-rails | `rspec spec/integration`, with `json < 3` | same shim | same |
| postmark-cli | `mocha --config .mocharc.integration.json --retries 0` in `node:20-alpine` | container; gateway alias `api.postmarkapp.com`; `NODE_EXTRA_CA_CERTS` | internal network |
| postmark-mcp | `node smoke-test.mjs`, `node smoke-test-mutating.mjs` | fetch shim (`NODE_OPTIONS=--import`), carried into the spawned MCP server | shim throws for other hosts |
| postmark-python | `run_example.py <example>` for every file in `examples/` | the wrapper sets `_base_url` on both client classes and swaps the placeholder tokens | trap proxy |

Notes per runner:
- Installs run on the host from `nix develop` (`dotnet build`, `composer install`, `bundle install`, `npm ci`, `poetry install`), except Maven, which resolves in the same image on the default network before the offline run. Every run installs again; the package caches make it quick.
- Container images are pinned by digest (`conformance/docker.ts`). Containers run as the host user with `HOME=/tmp`, so files they write to the suite copy stay removable. Networks and containers carry the label `postmock-conformance`. On exit, SIGINT and SIGTERM the runner removes every container on its network, then the network. A SIGKILL leaves them: remove them with the label.
- The images and every package registry need network access on the first run. The suite run itself needs none.
- Composer (php), and bundler without a lock file (gem, rails), resolve dependencies at run time. The stamp does not cover what they resolve.
- The results list every test: a runner lists the tests first (`mocha --dry-run`, `dotnet test --list-tests`, `phpunit --list-tests-xml`, `rspec --dry-run`) and fails a listed test that the run never reported with `not run: <why>`. java lists the `@Test` methods from the sources. mcp and python have no listing: see their notes.
- postmark-dotnet: the fixture finds `testing_keys.json` in a folder above the test assembly, so the runner copies it into the suite root.
- postmark-php: `PostmarkClientBounceTest` sleeps 180 s once sending works; allow it.
- postmark-java: the maven run needs `unit.PostmarkTest` online first. Surefire fetches its JUnit 5 provider only when a test runs.
- postmark-mcp: the runner writes `.env` from `testing_keys.json`, copies `smoke-test.example.mjs`, and sets `SENDER` and `RECIPIENT` in the mutating copy, as the file headers ask. Each `PASS`/`FAIL` line is a test; `<file> > finishes` fails when the script stops before its summary. A check named `skipped` is a skip.
- postmark-python: the SDK has no live suite (`docs/08` §5.1). A test is `examples/<path>.py > exits 0`. The examples run in file order on one postmock, async before sync, so an example sees what an earlier one created. The async `get_webhook.py` reads webhook ID 1, which the async `create_webhook.py` creates just before it on a seed without webhooks. An example whose placeholder ID, name or date no account holds is a skip (`docs/08` §5.2a).
- Every runner that runs mocha drops the suite's `--retries`.

### Add a runner

1. Create `conformance/<sdk>/run.ts` that exports `run(): Promise<ResultsFile>` (`conformance/results.ts`). Name the folder like its `sdk/` folder.
2. Use `conformance/harness.ts`: `stamp(sdk)` before the run, `copySuite` into `.work/suite`, `startSandbox`, `assertGuarded` before the suite, `assertRouted` after it, and `completeResults` over a test listing. Use `withContainerSandbox` (`conformance/docker.ts`) when the client hard-codes the host or port.
3. Add `testing_keys.json` (`conformance/keys.test.ts` checks its tokens against the seed). Add `baseline/<test file>.json` and `skips/<test file>.json` when a test first passes or needs a skip.
4. Keep the suite unmodified. Put shims, keys and host routing in the runner folder.

## Traps

| Trap | Fix |
| --- | --- |
| A webhook test against a receiver on a public host gets no request: the emitter reaches only loopback hosts. | Bind the receiver to `127.0.0.1` (`src/webhooks/test-receiver.ts`), or set `POSTMOCK_WEBHOOKS_ALLOW_HOSTS` for the host. |
| A clock test on real time flakes: `advance` computes its target from `now()`, so a task falls due early by the real ms elapsed. | Pass `createRuntime(plugins, new Clock(() => fixedMs))` and assert due times to the millisecond. |
| The dotnet server edit test leaves `InboundSpamThreshold` 10 on the shared conformance server (its reset passes a literal 10, `ClientServerInformationTests.cs:93`). A later test that reads the threshold sees 10, not 0. | Reset postmock between suites, or expect 10 after that test. |
| Node 24 strips TypeScript types by itself. It then loads the postmark.js suite before ts-node sees it, and warns `MODULE_TYPELESS_PACKAGE_JSON`. | The runner sets `NODE_OPTIONS=--no-experimental-strip-types` for mocha. |
| `npm ci` inside `sdk/` modifies third-party sources. | Install only in `conformance/<sdk>/.work/`. |
| A failed `before all` hook stops the tests after it; mocha's report does not list them. | The runner lists tests with `mocha --dry-run` first and marks the unreported ones as failures with the hook error. |
| `flake.nix` that git does not track is invisible to `nix develop` in a git repo. | `git add flake.nix` before the first `nix develop`. The first run downloads every toolchain and takes minutes. |
| `defineRoute` registers into a module-level table. A duplicate method and path throws at import. | Vitest isolates modules per test file, so a test file can register test-only routes. |
| `conformance:check` says `stale` after you edit a stamped file or check out another SDK commit. | Run `pnpm conformance <sdk>` again. Baseline and docs edits keep results fresh; a skip edit does not. |
| A seed part that calls `createServer` without `ID` throws `needs a fixed ID while seeding`. | Pass a fixed ID from the track's range (`docs/11` §5). |
| `clock.reset()` throws during an advance. | Await `clock.idle()` first; `POST /control/reset` does. |
| A file in `src/api/<group>/`, `src/control/endpoints/`, `src/plugins/` or `seeds/conformance/` loads without any import. A stray file there registers too. A group folder without `routes.ts` throws. | Keep only real route, endpoint, plugin and seed-part files there; tests end in `.test.ts`; names starting with `.` are skipped. |
| The installed package finds no route, plugin or seed: discovery reads files with the extension of `src/discover.ts` itself, and `dist/` holds only `.js`. | Build with `pnpm build` (`tsconfig.build.json`); never copy `.ts` files into `dist/`. |
| A handler that returns a raw `Date` gets a 500 (`unformatted Date at key …`). | Format dates with `src/time.ts` in the API group. |
| A fault stays active until its `times` run out. A later test in the same process sees it. | Call `POST /control/reset` between tests. |
| The postmark-dotnet test project targets `netcoreapp3.1`, but `xunit.runner.visualstudio` 2.8.2 ships only `net462` and `net6.0` builds. vstest finds no test, or asks for an x64 host on arm64. `DOTNET_ROLL_FORWARD=Major` does not help. | `conformance/postmark-dotnet/Directory.Build.props` restores the test project for `net8.0`; the runner builds with `-p:TargetFramework=net8.0`. The library keeps `netstandard2.0`. |
| A guard in `Net::HTTP#connect` never runs in postmark-gem: its spec helper loads FakeWeb, which aliases `connect`. A probe then reached the real host. | Guard `TCPSocket.open` and `TCPSocket.new`. `IO.open` does not dispatch to a Ruby-level `new`, so guard both. Probe `postmock-probe.invalid`, never a Postmark host. |
| postmark-rails resolves json 3, which breaks ActiveSupport 7.2 and 8.1: encoding passes `quirks_mode`, decoding passes a second argument to `JSON.parse`. Every delivery raises `ArgumentError`, and RSpec's JSON formatter crashes. | `runRspec` pins `json < 3` in a wrapper Gemfile (`.work/Gemfile`) that evaluates the suite Gemfile. |
| The MCP stdio transport starts the server with a filtered env, so `NODE_OPTIONS` and the fetch shim do not reach it. | The shim wraps `child_process.spawn` and adds `NODE_OPTIONS` and `POSTMOCK_API_URL` back. |
| A container on the internal network reaches the sandbox through `host.docker.internal`. Docker Desktop and OrbStack forward that to host loopback; Docker Engine on Linux maps `host-gateway` to the default bridge gateway, which a `127.0.0.1` listener does not serve. | `withContainerSandbox` binds the sandbox fronts to the bridge gateway when that address belongs to the host (Docker Engine on Linux), else to `127.0.0.1`. postmock and the trap stay on `127.0.0.1`. A daemon with another `host-gateway-ip` stops at the gateway check. |
| PHPUnit JUnit `<error>` text starts with `<class>::<test>`. | The php runner takes the first other line. |
