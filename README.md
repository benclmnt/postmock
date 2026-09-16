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
| Docker image | `docker build -t postmock .`, then `docker run --rm -p 127.0.0.1:8080:8080 -p 127.0.0.1:8025:8025 -p 127.0.0.1:2525:2525 postmock --seed conformance` |
| Compose, with the Postmark host names | Option B below |

The control API and SMTP have no real authentication: publish their ports on `127.0.0.1` only.

Startup prints one `name=url` per listener:

```text
postmock api=http://127.0.0.1:8080 control=http://127.0.0.1:8025 smtp=smtp://127.0.0.1:53648 seed=conformance
```

Every setting is an env key and a flag (`postmock --help`). A flag wins over the env:

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
A bad value stops startup: an unknown flag, an empty value, a port that is not a decimal number, or a PEM file that does not exist.

## Reach postmock from a client

A client reaches postmock with no code change ([`docs/01`](docs/01-client-reachability.md) §3.3).
Use a token that only postmock knows, such as the `conformance` seed token `postmock-server-token`.
A misrouted request then gets 401 from real Postmark and sends nothing.

### Option A: base-URL option

Set the client's own host option to postmock's REST listener, here `127.0.0.1:8080` over plain http.

| SDK | Option |
| --- | --- |
| postmark.js | `new ServerClient(token, { requestHost: "127.0.0.1:8080", useHttps: false })` |
| postmark-cli | `--request-host 127.0.0.1:8443` on `templates pull`, `templates push`, `email template`, `email raw` and `servers list`. The CLI keeps https: start postmock with `--https-port 8443` and a certificate from `tools/test-ca.sh`, and set `NODE_EXTRA_CA_CERTS` to its `ca.pem`. |
| postmark-python | `ServerClient(token, base_url="http://127.0.0.1:8080")` |
| postmark-dotnet | `new PostmarkClient(token, "http://127.0.0.1:8080")` |
| postmark-php | `PostmarkClientBase::$BASE_URL = "http://127.0.0.1:8080"` |
| postmark-gem, postmark-rails | `host: "127.0.0.1", port: 8080, secure: false` (rails: `config.action_mailer.postmark_settings`) |
| postmark-java | `Postmark.getApiClient(token, false, "127.0.0.1:8080")`: host and port, then the scheme from the `false` |
| postmark-mcp | none: use option B |

Cites and per-SDK transport details: [`docs/01`](docs/01-client-reachability.md) §2.1, [`docs/08`](docs/08-sdk-client-matrix.md).

### Option B: DNS and a test CA, with Compose

[`compose.yaml`](compose.yaml) runs postmock on the internal network `sandbox` under the names `api.postmarkapp.com`, `smtp.postmarkapp.com` and `smtp-broadcasts.postmarkapp.com`.
postmock serves REST over TLS on 443 and SMTP with STARTTLS on 25, 587 and 2525.

| Volume | Content | Mounted by |
| --- | --- | --- |
| `ca` | `ca.pem` only | clients |
| `tls` | `cert.pem`, `key.pem` | postmock only |

The `ca` service ([`tools/compose-ca.sh`](tools/compose-ca.sh)) writes both with [`tools/test-ca.sh`](tools/test-ca.sh).
It deletes the CA key after signing.
Name constraints limit the CA to `postmarkapp.com`, `localhost` and `127.0.0.1`.
The volumes keep the CA across runs; a missing file, or a certificate that expires within a day, makes a new one.

Run the example application:

```bash
docker compose run --rm --build example-node
docker compose --profile example down -v
```

[`examples/node/default-hosts.ts`](examples/node/default-hosts.ts) sends with postmark.js and nodemailer, and neither names postmock.

To test your own application, include this `compose.yaml` from your Compose file (Compose 2.20 or later).
[`examples/compose/compose.yaml`](examples/compose/compose.yaml) is a complete file:

```yaml
include:
  - path:
      - path/to/postmock/compose.yaml
      - postmock.override.yaml   # your settings for the postmock service
services:
  app:
    build: .
    depends_on:
      postmock: { condition: service_healthy }
    environment:
      NODE_EXTRA_CA_CERTS: /ca/ca.pem
      POSTMARK_SERVER_TOKEN: postmock-server-token
    volumes: [ca:/ca:ro]
    networks: [sandbox]
```

| Need | Setting |
| --- | --- |
| Trust the CA | Node: `NODE_EXTRA_CA_CERTS=/ca/ca.pem`; Java: import `ca.pem` into a trust store; others: the runtime's trust store |
| Read what was sent | `http://postmock:8025/control/messages` |
| Receive webhooks | `POSTMOCK_WEBHOOKS_ALLOW_HOSTS: app` in the override file ([`examples/compose/postmock.override.yaml`](examples/compose/postmock.override.yaml)) |

A service of your file cannot redefine an included service, so postmock settings go in the override file.

No route out holds only while the application joins `sandbox` and no other network.
With a second network, `api.postmarkapp.com` resolves to real Postmark whenever postmock is down.
Use a token that only postmock knows in every case: a misrouted request then gets 401 and sends nothing.

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
`pnpm compat-table` writes this table from `conformance/results/*.json`.
`not run` means the suite has no results yet: postmark-cli, postmark-java and postmark-php run in Docker containers and have not run for this table.
CI runs every suite and fails when this table differs from its results ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

<!-- compat-table:start -->
| SDK | SDK commit | Pass | Fail | Skip | Baseline |
| --- | --- | --- | --- | --- | --- |
| postmark-cli | c88a59d | not run | | | 17 |
| postmark-dotnet | b4249c5 | 103/111 | 0 | 8 | 103 |
| postmark-gem | a50ff39 | 41/41 | 0 | 0 | 41 |
| postmark-java | c6c5eb6 | not run | | | 83 |
| postmark-mcp | 63ef055 | 50/50 | 0 | 0 | 50 |
| postmark-php | ad4b80e | not run | | | 44 |
| postmark-python | 620d659 | 72/174 | 0 | 102 | 72 |
| postmark-rails | f9e4acc | 7/7 | 0 | 0 | 7 |
| postmark.js | f955212 | 79/80 | 0 | 1 | 79 |
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
| `examples/compose/` | An application's Compose file that includes postmock's |
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
| `tools/compose-ca.sh` | Keeps a valid test CA in the Compose volumes |
| `tools/pack-smoke.sh` | Installs the packed npm package outside the repo and checks REST and SMTP |
| `tools/compat-table.ts` | Writes the SDK compatibility table into this README |

`sdk/` and `refs/` are git-ignored: they hold third-party code and Postmark's copyrighted docs.
Run both scripts before you follow a citation.

## License

MIT.
