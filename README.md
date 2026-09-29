# postmock

[![npm](https://img.shields.io/npm/v/@benclmnt/postmock)](https://www.npmjs.com/package/@benclmnt/postmock)
[![CI](https://github.com/benclmnt/postmock/actions/workflows/ci.yml/badge.svg)](https://github.com/benclmnt/postmock/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A local mock of the [Postmark](https://postmarkapp.com) email API, for testing code that sends email through Postmark.

Your application uses its real, unmodified Postmark client: any official SDK, or a plain SMTP client.
Your tests then read what was sent, seed suppressions and bounces, inject faults, and trigger webhooks.

> Not affiliated with or endorsed by Postmark or ActiveCampaign. "Postmark" is their trademark.

## Why postmock

Postmark has no local test server.
Its sandbox mode is hosted: it cannot inject faults or fire events on demand, and sends count toward your plan.
Other open-source mocks answer `POST /email` only, with no errors, suppressions, webhooks or SMTP.

postmock covers the surface of every official SDK:

- **Server API**: send (single, batch, templates, bulk), bounces, suppressions, message streams, messages, stats, templates, webhooks, inbound rules.
- **Account API**: servers, domains, sender signatures, data removals.
- **SMTP**, with optional STARTTLS.
- **Webhooks**: every record type, with retries.
- **Postmark's errors**: the same HTTP status, `ErrorCode` and message that Postmark returns.

Each official SDK's own live integration suite runs unmodified against postmock in CI. See [SDK compatibility](#sdk-compatibility).

## Quick start

Requires Node.js 24 or later.

```bash
npx @benclmnt/postmock --seed conformance
```

postmock prints one `name=url` per listener:

```text
postmock api=http://127.0.0.1:8080 smtp=smtp://127.0.0.1:53648 control=http://127.0.0.1:8025 seed=conformance
```

Send an email with the `conformance` seed's server token:

```bash
curl http://127.0.0.1:8080/email \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "X-Postmark-Server-Token: postmock-server-token" \
  -d '{"From": "sender@example.com", "To": "user@example.org", "Subject": "Hello", "TextBody": "Hi"}'
```

Read it back from the control API:

```bash
curl "http://127.0.0.1:8025/control/messages?to=user@example.org"
```

## Installation

| Method | Command |
| --- | --- |
| npm | `npx @benclmnt/postmock --seed conformance` |
| Docker | `docker build -t postmock .`, then `docker run --rm -p 127.0.0.1:8080:8080 -p 127.0.0.1:8025:8025 -p 127.0.0.1:2525:2525 postmock --seed conformance` |
| Docker Compose | See [Option B](#option-b-dns-and-a-test-ca-with-docker-compose) |
| In process, from a Node test | `startPostmock({ host: "127.0.0.1", apiPort: 0, controlPort: 0, seed: "server", clock: "real", now: () => Date.now() })`. `now` sets postmock's time source, so a test's fake clock moves postmock's clock too |
| From source | `pnpm install`, then `pnpm start --seed conformance` |

## Release a new npm version

From a clean, up-to-date `main` checkout, run:

```bash
pnpm release:pr [patch|minor|major]
```

The default is `patch`. The script runs the checks, bumps `package.json`, creates a release branch, pushes it, and opens a pull request.

> [!WARNING]
> The control API and SMTP have no real authentication. Publish their ports on `127.0.0.1` only.

## Configuration

Each setting is a flag and an environment variable. A flag wins over the environment. Run `postmock --help` for the list.

| Flag | Environment variable | Default | Effect |
| --- | --- | --- | --- |
| `--host` | `POSTMOCK_HOST` | `127.0.0.1` (image: `0.0.0.0`) | Bind address of every listener |
| `--api-port` | `POSTMOCK_API_PORT` | `8080` | REST API over plain HTTP |
| `--control-port` | `POSTMOCK_CONTROL_PORT` | `8025` | Control API |
| `--seed` | `POSTMOCK_SEED` | `empty` | Initial state: `empty`, `server` or `conformance` ([seeds](CONTROL-API.md#seeds)) |
| `--clock` | `POSTMOCK_CLOCK` | `real` | `manual`: time moves only on `POST /control/clock/advance` |
| `--https-port`, `--https-tls-key`, `--https-tls-cert` | `POSTMOCK_HTTPS_PORT`, `POSTMOCK_HTTPS_TLS_KEY`, `POSTMOCK_HTTPS_TLS_CERT` | off | REST API over TLS; PEM files; set all three or none |
| `--smtp-ports` | `POSTMOCK_SMTP_PORTS` | `0` (image: `2525`) | Comma-separated list; each port serves the same SMTP endpoint |
| `--smtp-tls-key`, `--smtp-tls-cert` | `POSTMOCK_SMTP_TLS_KEY`, `POSTMOCK_SMTP_TLS_CERT` | off | PEM files; with both, SMTP offers STARTTLS |
| `--webhooks-allow-hosts` | `POSTMOCK_WEBHOOKS_ALLOW_HOSTS` | none | Webhook targets other than loopback; `*` for all |

Port `0` picks a free port.
An invalid value stops startup: an unknown flag, an empty value, a port that is not a decimal number, or a missing PEM file.

The `conformance` seed has these tokens:

| Token | Value |
| --- | --- |
| Account token | `postmock-account-token` |
| Server token (server 10) | `postmock-server-token` |

## Connect your application

Your application reaches postmock with no code change.
Use a token that only postmock knows, such as `postmock-server-token`.
If a request goes to real Postmark by mistake, it gets 401 and sends nothing.

### Option A: base-URL option

Set the client's host option to postmock's REST listener, here `127.0.0.1:8080` over plain HTTP.

| Client | Option |
| --- | --- |
| postmark.js | `new ServerClient(token, { requestHost: "127.0.0.1:8080", useHttps: false })` |
| postmark-cli | `--request-host 127.0.0.1:8443` on `templates pull`, `templates push`, `email template`, `email raw` and `servers list`. The CLI always uses HTTPS: start postmock with `--https-port 8443` and a certificate from `tools/test-ca.sh`, and set `NODE_EXTRA_CA_CERTS` to its `ca.pem`. |
| postmark-python | `ServerClient(token, base_url="http://127.0.0.1:8080")` |
| postmark-dotnet | `new PostmarkClient(token, "http://127.0.0.1:8080")` |
| postmark-php | `PostmarkClientBase::$BASE_URL = "http://127.0.0.1:8080"` |
| postmark-gem, postmark-rails | `host: "127.0.0.1", port: 8080, secure: false` (Rails: `config.action_mailer.postmark_settings`) |
| postmark-java | `Postmark.getApiClient(token, false, "127.0.0.1:8080")` |
| postmark-mcp | Not supported: use option B |

### Option B: DNS and a test CA, with Docker Compose

Use this option when the client has no host option, or when you do not want to change your application's configuration.

[`compose.yaml`](compose.yaml) runs postmock on the internal network `sandbox` under the names `api.postmarkapp.com`, `smtp.postmarkapp.com` and `smtp-broadcasts.postmarkapp.com`.
postmock serves REST over TLS on port 443, and SMTP with STARTTLS on ports 25, 587 and 2525.

The `ca` service ([`tools/compose-ca.sh`](tools/compose-ca.sh)) writes a test CA and a server certificate into two volumes:

| Volume | Content | Mounted by |
| --- | --- | --- |
| `ca` | `ca.pem` only | Clients |
| `tls` | `cert.pem`, `key.pem` | postmock only |

The service deletes the CA key after it signs the certificate, so nobody can sign another certificate with this CA.
The volumes keep the CA across runs.
When the certificate is missing, invalid or expires within a day, the service makes a new one. Then restart postmock with `docker compose restart postmock`.

Run the example application:

```bash
docker compose run --rm --build example-node
docker compose --profile example down -v
```

[`examples/node/default-hosts.ts`](examples/node/default-hosts.ts) sends with postmark.js and nodemailer. Neither names postmock.

To test your own application, include postmock's `compose.yaml` from your Compose file (Compose 2.20 or later).
[`examples/compose/compose.yaml`](examples/compose/compose.yaml) is a complete example:

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
| Trust the CA | Node.js: `NODE_EXTRA_CA_CERTS=/ca/ca.pem`; Java: import `ca.pem` into a trust store; others: the runtime's trust store |
| Read sent messages | `http://postmock:8025/control/messages` |
| Receive webhooks | `POSTMOCK_WEBHOOKS_ALLOW_HOSTS: app` in the override file ([example](examples/compose/postmock.override.yaml)) |

Put postmock settings in the override file. A service in your file cannot redefine an included service.

> [!IMPORTANT]
> Attach your application to the `sandbox` network only.
> With a second network, `api.postmarkapp.com` resolves to real Postmark whenever postmock is down.

postmock uses DNS, not a hosts file, because nodemailer queries DNS before it reads the hosts file.

### SMTP

| Setting | Value |
| --- | --- |
| Host | postmock's host, or `smtp.postmarkapp.com` with option B |
| Port | The `smtp` URL in the startup line; `25`, `587` or `2525` with option B |
| User and password | A server token for both, or an SMTP token from `POST /control/smtp/tokens` |
| TLS | STARTTLS when `POSTMOCK_SMTP_TLS_KEY` and `POSTMOCK_SMTP_TLS_CERT` are set |
| Message stream | Header `X-PM-Message-Stream` |

[`examples/node/smtp-send.ts`](examples/node/smtp-send.ts) sends with nodemailer through option A.

## Sender addresses

As on Postmark, the `From` address of a send must be on a DKIM-verified domain or be a confirmed sender signature.
Otherwise the REST API returns HTTP 422 with `ErrorCode` 400.
SMTP accepts every message and records the problem as a bounce, as Postmark does.
The `POSTMARK_API_TEST` token skips this check.

| Need | How |
| --- | --- |
| Send from `example.com` | The `conformance` seed verifies `example.com` and `your-verified-domain.com` |
| Send from another domain | `POST /domains` with the account token, then `POST /control/domains/<ID>/verify` with `{"dkim": true}` |
| Send from one address | `POST /senders` with the account token, then `POST /control/senders/<ID>/confirm` |

## Control API

Tests drive postmock through the control API on its own port.

| Area | What you can do |
| --- | --- |
| State | Reset, apply a seed |
| Clock | Read, advance; `--clock manual` stops real time |
| Faults | Add latency, return a Postmark error, time out or reset a connection; on REST and SMTP |
| Sent mail | List messages by recipient, tag or channel |
| Requests | List the REST requests postmock received, by route |
| Events | Bounce, spam complaint, unsubscribe, delivery, open, click |
| Inbound | Deliver mail to an inbound address |
| Webhooks | Read the delivery log |
| Account | Verify domains, confirm sender signatures, create SMTP tokens |

Each call produces a state that a real Postmark client or a real Postmark event could produce.
See [`CONTROL-API.md`](CONTROL-API.md) for the full reference.

## SDK compatibility

Each official SDK's own live integration suite runs unmodified against postmock.
CI runs every suite and fails when a result differs from this table.
A skipped test cannot pass against any mock. For example, it needs real delivery, real DNS, or a placeholder ID from a real account.

<!-- compat-table:start -->
| SDK | SDK commit | Pass | Fail | Skip | Baseline |
| --- | --- | --- | --- | --- | --- |
| postmark-cli | c88a59d | 31/31 | 0 | 0 | 31 |
| postmark-dotnet | b4249c5 | 103/111 | 0 | 8 | 103 |
| postmark-gem | a50ff39 | 41/41 | 0 | 0 | 41 |
| postmark-java | c6c5eb6 | 100/100 | 0 | 0 | 100 |
| postmark-mcp | 63ef055 | 50/50 | 0 | 0 | 50 |
| postmark-php | ad4b80e | 87/87 | 0 | 0 | 87 |
| postmark-python | 620d659 | 72/174 | 0 | 102 | 72 |
| postmark-rails | f9e4acc | 7/7 | 0 | 0 | 7 |
| postmark.js | f955212 | 79/80 | 0 | 1 | 79 |
<!-- compat-table:end -->

## Contributing

Issues and pull requests are welcome.

```bash
pnpm install
pnpm check                          # lint, type check, unit tests
tools/fetch-sources.sh postmark.js  # clone an official SDK into sdk/
pnpm conformance postmark.js        # run its integration suite against postmock
```

| Document | Content |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Listeners, modules, request flow, known pitfalls |
| [`CONTROL-API.md`](CONTROL-API.md) | Control API reference and seeds |
| [`TESTING.md`](TESTING.md) | Test gates and conformance runners |
| [`docs/`](docs) | Postmark's behavior, with sources |

[`flake.nix`](flake.nix) provides a Nix dev shell with every toolchain that the SDK suites need.

## License

[MIT](LICENSE)
