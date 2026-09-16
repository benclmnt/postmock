# postmock

A mock Postmark server in TypeScript, for testing code that sends email through Postmark.
Real, unmodified clients talk to it: every official Postmark SDK, and plain SMTP clients.
Tests then read what was sent, seed suppressions and bounces, inject faults, and trigger webhooks.

> Not affiliated with or endorsed by Postmark or ActiveCampaign. "Postmark" is their trademark.

## Status

Research complete; server not built yet. `docs/11` is the build plan.
The docs record Postmark's behavior from its public docs, its Swagger specs, and the official SDKs.
Nothing is CAPTURED from real Postmark yet; `docs/10` is a later fidelity pass.

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

`sdk/` and `refs/` are git-ignored: they hold third-party code and Postmark's copyrighted docs.
Run both scripts before you follow a citation.

## License

MIT.
