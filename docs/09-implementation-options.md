# 09 — Implementation options (TypeScript)

Status: proposal. Nothing here is built. Open decisions and their defaults are in §8.

## 1. Constraints

| # | Constraint | Source |
| --- | --- | --- |
| K1 | The mock is a server. Clients stay unmodified. | `AGENTS.md` rules 1, 3 |
| K2 | Scope is every official SDK's surface: server-token API, account-token API, SMTP, outbound webhooks. | `AGENTS.md` rule 2; `docs/08` endpoint coverage matrix |
| K3 | TypeScript. | `AGENTS.md` rule 1 |
| K4 | No fallbacks. Return the error Postmark would return, or crash. A wrong answer is worse than a crash. | `AGENTS.md` rule 5 |
| K5 | A client reaches the mock through its base-URL option, or through DNS plus a trusted test CA. | `AGENTS.md` rule 3; `docs/01` §3 "Routing an unmodified application to the mock" |

## 2. Prior art

| Candidate | What it does | Verdict |
| --- | --- | --- |
| `maximAtanasov/postmark-mock` (GitHub, no license) | Answers `POST /email` only, plain http on 8085 | Not usable: no errors, no state, no SMTP, no license |
| `dgates82/dgates-mock-servers` (MIT; `postmark-mock/`, Express, commit `010b3a8f`) | Answers `POST /email` only. Lists and clears sent messages (`GET`/`DELETE /api/messages`). Accepts any token (`postmark-mock/server.js:11-14`). | Not usable as a base: one endpoint, no error semantics, no auth. Shows the demand for a no-account mock. |
| Mailpit (Go) | SMTP catcher with a UI, its own REST API and webhooks | No Postmark REST API or Postmark error semantics. Could catch SMTP only. Skip. |
| Postmark sandbox server (hosted) | Real Postmark behavior; never delivers (DOC `refs/user-guide_sandbox-mode_server-sandbox-mode.md:4`) | Needs an account and network. No fault injection. No on-demand opens, clicks, spam complaints (DOC `refs/support_article_1239-how-to-test-bounces.md:90`). Sends count toward the monthly plan (DOC `refs/support_article_1239-how-to-test-bounces.md:92`; `refs/user-guide_sandbox-mode_server-sandbox-mode.md:6`). It is the capture target (`docs/10`), not a test double. |
| Codegen from `refs/openapi/*.yml` | Types for every endpoint | Swagger 2.0 needs many fixes and misses fields that SDKs send (`docs/08` spec quality section). See D6. |

No open-source Postmark server covers the SDK surface. This project is a clean-room implementation from `docs/01`–`08`.

## 3. Proposed shape

One Node 24 process, one in-memory state, four listeners.

| Listener | Port (default) | Serves | Library (INFERRED choice) | Why |
| --- | --- | --- | --- | --- |
| REST | 443 (TLS) and 80 | Server-token and account-token API | `hono` + `@hono/node-server` | Small, typed routing; runs on Node, Bun and Deno |
| SMTP | 587 (STARTTLS offered, not required), 2525, 25 | Postmark SMTP | `smtp-server` + `mailparser` | Mature SMTP server and MIME parser from the nodemailer project; STARTTLS and AUTH built in |
| Control API | 8025 (http) | Test-facing API (§5) | same `hono` app, separate port | One router stack |
| Webhook emitter | outbound | Every webhook RecordType and inbound | global `fetch` | No dependency |

Request validation uses `zod`: one schema gives the runtime check and the TypeScript type.

### 3.1 Modules

| Module | Holds | Docs |
| --- | --- | --- |
| `state/` | account, servers + tokens, streams, messages (outbound + inbound), suppressions, bounces, opens, clicks, templates, webhooks, inbound rules, domains, signatures, data removals, webhook attempts, virtual clock | `docs/04`, `docs/06` |
| `rest/auth` | server and account token lookup; `POSTMARK_API_TEST`; 401/10 | `docs/02` authentication section |
| `rest/errors` | one `postmarkError(code)` table: ErrorCode → HTTP status + exact `Message` | `docs/02` error code table; `docs/03` |
| `rest/sending` | `POST /email`, `/email/batch`, `/email/withTemplate`, `/email/batchWithTemplates`, `/email/bulk`: validate, check suppressions (406), store message | `docs/03` |
| `rest/bounces` | bounce list, get, dump, activate, delivery stats | `docs/04` |
| `rest/suppressions` | dump, create, delete per stream | `docs/04` |
| `rest/streams` | message streams CRUD, archive, unarchive | `docs/04` |
| `rest/messages` | outbound + inbound search, details, dump; opens, clicks; paging cap → 422; inbound bypass, retry | `docs/06` |
| `rest/stats` | outbound overview and every stats sub-path | `docs/06` |
| `rest/templates` | templates CRUD, validate; Mustachio renderer | `docs/06`; DOC `refs/support_article_1077-template-syntax.md` |
| `rest/server` | `GET`/`PUT /server` | `docs/06` |
| `rest/webhooks` | webhooks config CRUD per stream | `docs/05` |
| `rest/inbound-rules` | inbound rule triggers CRUD | `docs/05`; DOC `refs/api_inbound-rules-triggers-api.md` |
| `account/` | servers, domains, sender signatures, data removals, template push | `docs/06`; `docs/08` account-token paths |
| `webhooks/emitter` | payload builders for every RecordType; retry schedule on the virtual clock; attempt log | `docs/05` |
| `inbound/` | parse incoming mail into the Inbound payload; apply inbound rules; post to the inbound hook | `docs/05` |
| `smtp/` | EHLO/STARTTLS/AUTH with server token; parse MIME; `X-PM-*` headers; store message; suppressed or invalid → `SMTPApiError` bounce, never an SMTP reject | `docs/07` |
| `control/` | §5 | — |

### 3.2 Wire rules taken from the docs

| Rule | Source |
| --- | --- |
| Match paths and query keys without regard to case; trailing slash per capture | `docs/08` union section (accept); `docs/10` C17 |
| Every success is HTTP 200 with a JSON body | `docs/08` union section (emit) |
| Errors are `{ErrorCode, Message}` with `X-PM-ApiErrorCode` | `docs/02` error envelope |
| 406 `Message` matches the SDK regex `Found inactive addresses: (.+?)\.? Inactive` | `docs/03` inactive recipients; `docs/02` SDK error mapping |
| `MessageID` is a UUID; dates ISO 8601 | `docs/08` union section (emit) |

## 4. Routing: reaching the mock without changing clients

| Option | Covers | How | Fits | Mark |
| --- | --- | --- | --- | --- |
| **A. Base-URL option** | REST (per SDK); SMTP host and port | Set the SDK's host or base-URL option to the mock (for example postmark.js `requestHost` + `useHttps: false`; dotnet and php `BASE_URL`). This is configuration, not a code change. | SDK users who own their config; the SDK conformance suites. Not possible when the application hard-codes the host, or for postmark-mcp. | SDK (`docs/01` §2 "How clients choose the host"; `docs/08` per-SDK commands table) |
| B. DNS + test CA | REST + SMTP | A DNS server answers `api.postmarkapp.com` and `smtp.postmarkapp.com` (and `smtp-broadcasts`) with the mock. The mock serves a cert for these names from a test CA and advertises `STARTTLS`. The client trusts the CA (`NODE_EXTRA_CA_CERTS`, a Java trust store, and so on). | Apps that hard-code the host. SMTP needs a real DNS answer: Docker Compose network alias (embedded DNS), a local DNS server, a private zone. A hosts-file entry redirects REST only: nodemailer queries DNS with `resolve4`/`resolve6` before `dns.lookup` (LIB `nodemailer@9.1.1 lib/shared/index.js:52-76,158-218`). | INFERRED; nodemailer part LIB (`docs/01` §3.3 "Options") |
| C. Env proxy | REST only | `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1`; the mock accepts `CONNECT` and terminates TLS with the test CA; `NO_PROXY` for other egress | Where DNS cannot change | INFERRED (`docs/01` §3.2 "Local probe") |
| D. Preload (`docs/01` D.a, D.b) | REST only | `NODE_OPTIONS=--require <file>` replaces the `fetch` dispatcher (D.a) or patches `dns.lookup` (D.b) | Local dev without a DNS server. D.b does not redirect nodemailer SMTP while public DNS answers. D.c (`HttpClient.DefaultOptions`) is not a route. | INFERRED; runs code inside the client process |

Rejected: `docs/01` option E, SMTP without TLS. Postmark offers STARTTLS; a mock without it hides TLS bugs.

Order of preference: **A**, then **B**, then C, then D.
Ship a `compose.yaml` that aliases the mock as all three hostnames, plus a script that makes the test CA.
First spike task: prove A and B (Compose alias) with unmodified postmark.js `sendEmail` and a nodemailer SMTP send.

Real-send guard: give the client a fake server token that only the mock knows.
If routing fails, real Postmark answers 401/10 and no mail leaves.
The test also asserts that the mock saw the request (`GET /control/messages`).

## 5. Control API (test-facing)

Every control action maps to something that can happen on real Postmark.

| Endpoint | Real-world equivalent |
| --- | --- |
| `POST /control/reset` | new account |
| `POST /control/servers` `{token, streams}` | create server + token |
| `POST /control/suppressions` `{stream, email, reason: HardBounce\|SpamComplaint\|ManualSuppression, origin}` | a hard bounce, a complaint, an unsubscribe (`docs/04`) |
| `POST /control/bounces` `{messageId, type}` | recipient server bounces → bounce record, maybe suppression, Bounce webhook |
| `POST /control/events/open` / `click` `{messageId, recipient, link?}` | recipient opens / clicks a tracked message |
| `POST /control/events/delivery` / `spam-complaint` `{messageId, recipient}` | recipient server accepts / recipient marks as spam |
| `POST /control/inbound` `{from, to, subject, text, html, attachments}` or raw MIME | mail arrives at the inbound address → inbound rules → Inbound webhook |
| `POST /control/faults` `{match: {method, path}, times, reply: {status, errorCode} \| "timeout" \| "reset"}` | Postmark outage, 500/503, 429, network loss (`docs/02` retries and rate limits) |
| `GET /control/messages?to=&tag=&channel=rest\|smtp` | Activity page; returns stored request JSON or raw MIME |
| `GET /control/webhooks/attempts` | webhook delivery log |
| `POST /control/clock/advance` `{ms}` | time passes; due webhook retries fire |

## 6. Verification

| Layer | Check | Source |
| --- | --- | --- |
| Capture parity | Replay each `docs/10` scenario against the mock; diff status, headers that matter, body shape | `docs/10` conformance loop |
| SDK conformance | Run every official SDK's own integration suite against the mock. All suites green is the definition of done. | `docs/08` conformance test approach |
| Example apps | `examples/node/`: a tiny Node app that sends with postmark.js and with nodemailer over SMTP, receives a webhook, and asserts on `GET /control/messages`. Runs through option A and option B. | INFERRED |

The SDK suites stay unmodified. Shims and seed data live in this repo (`docs/08` harness shape).

## 7. Phases

Each exit check names SDK suites or tests that must pass against the mock.
Feature-complete = every phase exit check green.

| Phase | Scope | Exit check |
| --- | --- | --- |
| P0 Capture (deferred, `docs/11` B2) | Run the `docs/10` P0 questions on a dedicated sandbox server | Every P0 C-id answered in `captures/` |
| P1 Transport, auth, errors, sending | TLS + http listeners, token auth, ErrorCode table, `POST /email`, `/email/batch`, faults, control API, Compose + test CA | postmark.js `Sending.test.ts` (non-template cases); rails `delivery_spec.rb`, `batch_delivery_spec.rb`; php `PostmarkClientEmailTest.php`; `docs/10` G0 + G1 scenarios conform |
| P2 Suppressions, bounces, streams | state model and transitions between them (`docs/04`); 406 on send | postmark.js `Suppressions`, `Bounce`, `MessageStreams`; dotnet `ClientSuppressionTests`, `ClientBounceTests`, `ClientMessageStreamTests`; java `SuppressionsTest`, `BounceTest`, `MessageStreamsTest`; `g2-inactive`, `g2-suppressions` conform |
| P3 Templates, bulk | templates CRUD + validate, Mustachio renderer, `withTemplate`, `batchWithTemplates`, bulk | postmark.js `Templates`; dotnet `ClientTemplateTests`, `ClientBulkSendingTests`; php `PostmarkClientTemplatesTest.php`; java `TemplateTest`, `TemplatedMessageTest`; cli `email.template.test.ts` |
| P4 Messages, stats, events | outbound + inbound messages, opens, clicks, stats, delivery/open/click events | postmark.js `Messages`, `MessagesOpens`, `MessageStatistics`, `ClickStatistics`; dotnet `ClientMessage*Tests`, `ClientStatisticsTests`; php outbound/inbound message and statistics tests; gem `api_client_messages_spec.rb`; `g2-events-paging`, `g2-opens` conform |
| P5 Webhooks, inbound | webhooks config, emitter for every RecordType, retries on the virtual clock, inbound processing, inbound rules | postmark.js `Webhook`, `Triggers`, `Server`; dotnet `ClientWebhookTests`, `ClientTriggersTests`, `ClientServerInformationTests`; java `WebhookTest`, `TriggersTest`; mcp smoke tests; G3 scenarios conform |
| P6 SMTP | EHLO/STARTTLS/AUTH, MIME store, `X-PM-*` headers, `SMTPApiError` bounce path | G4 scenarios conform; `examples/node` SMTP send |
| P7 Account API | servers, domains, sender signatures, data removals, template push | postmark.js `Servers`, `Domains`, `Signatures`, `DataRemoval`; dotnet `AdminClient*Tests`; php `PostmarkAdminClient*Test.php`; java `ServersTest`, `DomainTest`, `SendersTest`, `DataRemovalTest`, `TemplatePushTest`; gem `account_api_client_spec.rb`; cli integration suite |
| P8 Packaging | npm package, Docker image, `compose.yaml` example, README usage, disclaimer (D7) | `examples/node` passes against the published image; every SDK suite in `docs/08` green in CI |

Test names come from `sdk/*/test*` directory listings; case lists per file come from `docs/08` per-SDK commands table (**SDK**). python has no live suite; its runner (`docs/08`) joins the phase of each endpoint.

## 8. Decisions needed

| # | Decision | Default if nobody decides |
| --- | --- | --- |
| D1 | Default routing in docs and Compose example: base-URL option (A) or DNS + test CA (B)? Local dev without Compose: a local DNS server (B), or D preload (REST only)? | A for SDK users; B in Compose; B with a local DNS server locally |
| D2 | Who provisions the Postmark sandbox server and tokens for captures? | **Decided:** captures deferred (`docs/11` B2) |
| D3 | SDK suites: TLS listener in the mock, or shims and proxies per SDK? | plain http + shims (`docs/08` conformance test approach); the TLS listener still ships for option B |
| D4 | Java conformance: one-line host edit in a local copy, or hosts file + TLS? | hosts file + TLS (keeps the suite unmodified) |
| D5 | Clone `nodemailer-postmark-transport` for profiling, or drop it? | drop; nodemailer is covered through SMTP |
| D6 | Types from a patched spec, or hand-written zod? | hand-written zod; the spec is a cross-check |
| D7 | Project name and trademark. "Postmark" is a mark of ActiveCampaign. | **Decided:** postmock; npm `@benclmnt/postmock`; README disclaimer (`docs/11` B1) |
| D8 | License | MIT |
| D9 | `refs/` redistribution. Postmark docs are copyrighted. | do not commit `refs/`; `tools/fetch-refs.sh` recreates it (`AGENTS.md` rule 8) |
| D10 | Clone postmark.js 4.0.2 to profile the CLI, or accept rows inferred from 5.1.0? | no; accept inferred rows |
