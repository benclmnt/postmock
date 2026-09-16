# postmock

A mock Postmark server in TypeScript, for testing code that sends email through Postmark.
Real, unmodified clients talk to it: every official Postmark SDK, and plain SMTP clients.
Tests then read what was sent, seed suppressions and bounces, inject faults, and trigger webhooks.

> Not affiliated with or endorsed by Postmark or ActiveCampaign. "Postmark" is their trademark.

## Status

W0 to W3 are built: REST and account APIs, SMTP, webhooks, the control API, a conformance runner for every official SDK, the npm package, the Docker image and CI.
[`docs/11`](docs/11-build-plan.md) is the build plan; [`ARCHITECTURE.md`](ARCHITECTURE.md) marks what is built.
The docs record Postmark's behavior from its public docs, its Swagger specs, and the official SDKs.
Nothing is CAPTURED from real Postmark yet; [`docs/10`](docs/10-live-capture-plan.md) is a later fidelity pass.

## Run

| Way | Command |
| --- | --- |
| npm package (not published yet; `npm pack` builds it) | `npx @benclmnt/postmock --seed conformance` |
| From a checkout | `pnpm install`, then `pnpm start --seed conformance` |
| Docker image | `docker build -t postmock .`, then `docker run --rm -p 8080:8080 -p 8025:8025 -p 2525:2525 postmock --seed conformance` |
| Compose, with the Postmark host names | `docker compose up` (see option B) |

Startup prints one `name=url` per listener:

```text
postmock api=http://127.0.0.1:8080 control=http://127.0.0.1:8025 smtp=smtp://127.0.0.1:53648 seed=conformance
```

Every setting is an env key and a flag (`postmock --help`):

| Flag | Env | Default | Effect |
| --- | --- | --- | --- |
| `--host` | `POSTMOCK_HOST` | `127.0.0.1` (image: `0.0.0.0`) | Bind address of every listener |
| `--api-port` | `POSTMOCK_API_PORT` | `8080` | REST over plain http |
| `--control-port` | `POSTMOCK_CONTROL_PORT` | `8025` | Control API |
| `--seed` | `POSTMOCK_SEED` | `empty` | Seed applied at start: `empty`, `conformance` ([`CONTROL-API.md`](CONTROL-API.md#seeds)) |
| `--https-port`, `--https-tls-key`, `--https-tls-cert` | `POSTMOCK_HTTPS_PORT`, `POSTMOCK_HTTPS_TLS_KEY`, `POSTMOCK_HTTPS_TLS_CERT` | off | REST over TLS; PEM files; all three or none |
| `--smtp-ports` | `POSTMOCK_SMTP_PORTS` | `0`, a free port (image: `2525`) | Comma list; every port serves the same SMTP endpoint |
| `--smtp-tls-key`, `--smtp-tls-cert` | `POSTMOCK_SMTP_TLS_KEY`, `POSTMOCK_SMTP_TLS_CERT` | off | PEM files; with both, SMTP offers STARTTLS |
| `--webhooks-allow-hosts` | `POSTMOCK_WEBHOOKS_ALLOW_HOSTS` | none | Webhook targets other than loopback; `*` for all |

Port `0` picks a free port.
A bad value stops startup.

## Reach postmock from a client

A client reaches postmock with no code change ([`docs/01`](docs/01-client-reachability.md) §3.3).
Use a token that only postmock knows, such as the `conformance` seed token `postmock-server-token`.
A misrouted request then gets 401 from real Postmark and sends nothing.

### Option A: base-URL option

Set the client's own host option to postmock's REST listener, `http://127.0.0.1:8080`.

| SDK | Option |
| --- | --- |
| postmark.js | `new ServerClient(token, { requestHost: "127.0.0.1:8080", useHttps: false })` |
| postmark-cli | `--request-host` on template commands |
| postmark-python | `base_url=` |
| postmark-dotnet | `apiBaseUri` constructor argument |
| postmark-php | `PostmarkClientBase::$BASE_URL` |
| postmark-gem, postmark-rails | `:host`, `:port`, `:secure` |
| postmark-java | `Postmark.getApiClient(token, secure, customApiUrl)` |
| postmark-mcp | none: use option B |

Cites and per-SDK transport details: [`docs/01`](docs/01-client-reachability.md) §2.1, [`docs/08`](docs/08-sdk-client-matrix.md).

### Option B: DNS and a test CA, with Compose

[`compose.yaml`](compose.yaml) runs postmock on an internal network under the names `api.postmarkapp.com`, `smtp.postmarkapp.com` and `smtp-broadcasts.postmarkapp.com`.
The `ca` service writes a throwaway CA and a certificate for these names with [`tools/test-ca.sh`](tools/test-ca.sh) into the `ca` volume.
postmock serves REST over TLS on 443 and SMTP with STARTTLS on 25, 587 and 2525.
The network has no route out, so a client on it cannot reach real Postmark.

To test an application, add it as a service in a Compose file of your own:

| Step | Setting |
| --- | --- |
| Join the network | `networks: [sandbox]` |
| Trust the CA | Node: `NODE_EXTRA_CA_CERTS=/ca/ca.pem`; Java: import `ca.pem` into a trust store; others: the runtime's trust store |
| Mount the CA | `volumes: [ca:/ca:ro]` |
| Wait for postmock | `depends_on: { postmock: { condition: service_healthy } }` |
| Read what was sent | `http://postmock:8025/control/messages` |
| Receive webhooks | Set `POSTMOCK_WEBHOOKS_ALLOW_HOSTS` on postmock to the service name |

[`examples/node/default-hosts.ts`](examples/node/default-hosts.ts) is such an application.
It sends with postmark.js and nodemailer, and neither names postmock:

```bash
docker compose run --rm --build example-node
docker compose --profile example down -v
```

A volume keeps its CA across runs; `down -v` removes it.
Why DNS and not a hosts file: nodemailer queries DNS before it reads the hosts file ([`docs/01`](docs/01-client-reachability.md) §2.2).

### SMTP

| Setting | Value |
| --- | --- |
| Host | postmock's host, or `smtp.postmarkapp.com` with option B |
| Port | The `smtp` URL in the startup line; `25`, `587` or `2525` with option B |
| User and password | A server API token for both, or an SMTP token from `POST /control/smtp/tokens` |
| TLS | STARTTLS when `POSTMOCK_SMTP_TLS_KEY` and `POSTMOCK_SMTP_TLS_CERT` are set |
| Stream | Header `X-PM-Message-Stream` |

[`examples/node/smtp-send.ts`](examples/node/smtp-send.ts) sends with nodemailer through option A.
Details: [`docs/07`](docs/07-smtp-sandbox-limits.md).

## Control API

Tests drive postmock through the control API on its own port: reset, seeds, the clock, faults, sent messages, bounces, opens, clicks, inbound mail and webhook attempts.
Every call maps to something that can happen on real Postmark.
Reference: [`CONTROL-API.md`](CONTROL-API.md).

## SDK compatibility

Each official SDK's own live integration suite runs unmodified against postmock ([`TESTING.md`](TESTING.md)).
`pnpm compat-table` writes this table from `conformance/results/*.json`; `not run` means no local results.
CI runs every suite on each push ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

<!-- compat-table:start -->
| SDK | SDK commit | postmock commit | Pass | Fail | Skip | Baseline |
| --- | --- | --- | --- | --- | --- | --- |
| postmark-cli | c88a59d | not run | | | | 17 |
| postmark-dotnet | b4249c5 | 54a4672 | 103/111 | 0 | 8 | 103 |
| postmark-gem | a50ff39 | 70318d4 | 41/41 | 0 | 0 | 41 |
| postmark-java | c6c5eb6 | not run | | | | 83 |
| postmark-mcp | 63ef055 | 70318d4 | 50/50 | 0 | 0 | 50 |
| postmark-php | ad4b80e | not run | | | | 44 |
| postmark-python | 620d659 | 70318d4 | 72/174 | 0 | 102 | 72 |
| postmark-rails | f9e4acc | 70318d4 | 7/7 | 0 | 0 | 7 |
| postmark.js | f955212 | 70318d4 | 79/80 | 0 | 1 | 79 |
<!-- compat-table:end -->

## Why

Postmark has no local test server.
Its sandbox mode is hosted: it cannot inject faults or fire events on demand, and sends count toward the plan.
Existing open-source mocks answer `POST /email` only, with no errors, suppressions, webhooks or SMTP (`docs/09`).

## Scope

| Surface | Doc |
| --- | --- |
| Transport, tokens, error envelope, ErrorCodes | `docs/02` |
| Sending: single, batch, templates, bulk | `docs/03` |
| Bounces, suppressions, message streams, data removals | `docs/04` |
| Webhooks: config API, every RecordType, retries, inbound | `docs/05` |
| Messages, stats, templates, server, servers, domains, sender signatures | `docs/06` |
| SMTP, sandbox mode, limits | `docs/07` |

## Top traps

| Trap | Doc |
| --- | --- |
| The 406 `Message` must match an SDK regex, or clients get an empty inactive-recipient list | `docs/03` |
| postmark.js has no proxy support and a default host; apps that never set a host need DNS + a test CA | `docs/01` |
| SMTP accepts every message; problems become `SMTPApiError` bounces, not SMTP rejects | `docs/07` |
| Every success is HTTP 200 with JSON; several SDKs treat 201/204 as errors | `docs/08` |
| SDKs disagree on path case, query key case and boolean encoding; the server must accept all of them | `docs/08` |

## Layout

| Path | Content |
| --- | --- |
| `AGENTS.md` | Rules for working in this repo (`CLAUDE.md` links to it) |
| `ARCHITECTURE.md` | Listeners, modules, request flow, shared contracts, traps |
| `CONTROL-API.md` | Test-facing control API: principle, shape, endpoints, seeds |
| `TESTING.md` | Gates, conformance runners, results and baseline, test traps |
| `flake.nix` | Dev shell with every toolchain the SDK suites need |
| `Dockerfile`, `compose.yaml` | The image, and the option B sandbox |
| `.github/workflows/` | CI |
| `examples/node/` | Applications that send through Postmark with no postmock code |
| `src/` | The server (`ARCHITECTURE.md` "Modules") |
| `seeds/` | Named seeds: `empty`, `conformance` |
| `conformance/` | One runner per SDK suite, baselines, skip lists |
| `docs/01-client-reachability.md` | How clients pick the host; routing an unmodified app to the mock; client parsing of server text; surface tiers |
| `docs/02-transport-auth-errors.md` | Hosts, headers, tokens, `POSTMARK_API_TEST`, error envelope, ErrorCode table, SDK error mapping, JSON and paging rules |
| `docs/03-sending.md` | `/email`, batch, templates, bulk; validation and ErrorCodes; sandbox; tracking after accept |
| `docs/04-bounces-suppressions-streams.md` | Bounce API, suppressions, message streams, data removals, and the state machine between them |
| `docs/05-webhooks.md` | Webhook config API, every RecordType payload, retries, inbound |
| `docs/06-messages-stats-templates-server.md` | Messages, opens/clicks, stats, templates, server/servers/domains/signatures |
| `docs/07-smtp-sandbox-limits.md` | SMTP and `X-PM-*` headers, sandbox mode, bounce-testing addresses, limits |
| `docs/08-sdk-client-matrix.md` | How each official SDK sends and parses; endpoint coverage; spec bugs; conformance plan |
| `docs/09-implementation-options.md` | TypeScript design, routing options, control API, phases, decisions |
| `docs/10-live-capture-plan.md` | Open questions and a safe capture harness design (deferred) |
| `docs/11-build-plan.md` | Waves, parallel tracks, conformance runners, definition of done |
| `tools/fetch-sources.sh` | Clones the official SDKs into `sdk/` at the commits the docs cite |
| `tools/fetch-refs.sh` | Downloads Postmark's docs and Swagger specs into `refs/` |
| `tools/test-ca.sh` | Writes a test CA and a certificate for the Postmark host names |
| `tools/pack-smoke.sh` | Installs the packed npm package outside the repo and checks REST and SMTP |
| `tools/compat-table.ts` | Writes the SDK compatibility table into this README |

`sdk/` and `refs/` are git-ignored: they hold third-party code and Postmark's copyrighted docs.
Run both scripts before you follow a citation.

## License

MIT.
