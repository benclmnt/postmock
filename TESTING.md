# Testing

Status: the unit suite and the postmark.js conformance runner are built.
The runners for the other SDKs are design (T8, `docs/11` §3.2).

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

Env: `POSTMOCK_HOST`, `POSTMOCK_API_PORT`, `POSTMOCK_CONTROL_PORT`, `POSTMOCK_SEED` (`ARCHITECTURE.md` "Listeners").

## The gates

| Command | Checks | When |
| --- | --- | --- |
| `nix develop -c pnpm check` | `biome check .`, `tsc --noEmit`, `vitest run` | Every commit |
| `pnpm conformance <sdk>` | Runs that SDK suite against a fresh postmock; writes `conformance/results/<sdk>.json` | Before merge, for the suites the track touches |
| `pnpm conformance all` | Every runner | Integration (W2) |
| `pnpm conformance:check` | The results file comes from the current postmock source, and every baseline test passes in it | Before merge; no regression |

## Conformance files

| File | Content | Committed |
| --- | --- | --- |
| `conformance/run.ts` | Finds each `conformance/<sdk>/run.ts` and writes its results | yes |
| `conformance/<sdk>/run.ts` | Prepares the suite, starts postmock with the `conformance` seed, runs the suite, maps each test to pass, fail or skip | yes |
| `conformance/<sdk>/testing_keys.json` | Tokens and addresses the suite reads; they match `seeds/lib/conformance.ts` (a unit test checks) | yes |
| `conformance/<sdk>/skips/<test file>.md` | Tests of that file allowed to fail, each with a reason and a source | yes |
| `conformance/<sdk>/baseline/<test file>.json` | `{"passing": [full titles]}`: tests of that file that must keep passing. One file per test file, so tracks never co-edit one. | yes |
| `conformance/results/<sdk>.json` | `{sdk, sdkCommit, postmock: {commit, dirty, sourceHash}, finishedAt, totals, tests: [{id, state, error?}]}` | no (git-ignored) |
| `conformance/<sdk>/.work/` | The suite copy and its install | no (git-ignored) |

A test id is `<file> > <full title>`, e.g. `test/integration/Server.test.ts > Server getServer`.
The results list every test in the suite, also the tests a failed hook stopped (`error: "not run: …"`).

Ratchet rules:
- `conformance:check` fails when a results file is stale: its `sourceHash` (commit plus uncommitted changes, baseline files excluded) differs from the current source. Run the suite again.
- It fails when a baseline test fails, skips or is missing. It prints tests that pass but are not in the baseline.
- Add newly passing tests to the baseline file of their test file. Only add; never remove a test to make the check pass.
- A test that cannot pass against any mock (real delivery, DNS, external timing) goes to `skips/<test file>.md` with the reason (`docs/11` §3.3).

### postmark.js

- The runner copies `sdk/postmark.js` to `.work/` with rsync and runs `npm ci` plus `typescript@4.7.4` there, as the suite's CI does. `sdk/` stays untouched.
- `mocha -r ts-node/register -r fetch-shim.cjs` runs `test/integration/**/*.test.ts`. The shim sends every `api.postmarkapp.com` request to postmock and throws for any other host.
- The suite reads its tokens from env vars (`testing_keys.json`).
- The runner drops the suite's `--retries 1`. postmock is deterministic, so a test that passes only on a retry shows a postmock bug.
- Current result: 80 tests; `Server getServer` passes; the rest wait for tracks.

### Add a runner (T8)

1. Create `conformance/<sdk>/run.ts` that exports `run(): Promise<ResultsFile>` (`conformance/results.ts`).
2. Add `testing_keys.json`. Add `baseline/<test file>.json` and `skips/<test file>.md` when a test first passes or needs a skip.
3. Stamp the results with `currentStamp()` (`conformance/stamp.ts`).
4. Keep the suite unmodified. Put shims, keys and host routing in the runner folder.

## Traps

| Trap | Fix |
| --- | --- |
| Node 24 strips TypeScript types by itself. It then loads the postmark.js suite before ts-node sees it, and warns `MODULE_TYPELESS_PACKAGE_JSON`. | The runner sets `NODE_OPTIONS=--no-experimental-strip-types` for mocha. |
| `npm ci` inside `sdk/` modifies third-party sources. | Install only in `conformance/<sdk>/.work/`. |
| A failed `before all` hook stops the tests after it; mocha's report does not list them. | The runner lists tests with `mocha --dry-run` first and marks the unreported ones as failures with the hook error. |
| `flake.nix` that git does not track is invisible to `nix develop` in a git repo. | `git add flake.nix` before the first `nix develop`. The first run downloads every toolchain and takes minutes. |
| `defineRoute` registers into a module-level table. A duplicate method and path throws at import. | Vitest isolates modules per test file, so a test file can register test-only routes. |
| `conformance:check` says `stale` after you edit a source file. | Run `pnpm conformance <sdk>` again. Editing only baseline files keeps results fresh. |
| A file in `src/api/<group>/`, `src/control/endpoints/` or `seeds/conformance/` loads without any import. A stray file there registers routes too. | Keep only real route, endpoint and seed-part files there; tests end in `.test.ts`. |
| A handler that returns a raw `Date` gets a 500 (`unformatted Date at key …`). | Format dates with `src/time.ts` in the API group. |
| A fault stays active until its `times` run out. A later test in the same process sees it. | Call `POST /control/reset` between tests. |
