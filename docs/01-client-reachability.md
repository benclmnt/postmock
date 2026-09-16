# 01 — Client reachability and server-text dependencies

This document answers four questions:

1. Which parts of Postmark does the mock cover, and which doc covers each part (§1)?
2. How does each client choose the Postmark host (§2)?
3. How does traffic from an unmodified application reach the mock (§3)?
4. Which client code parses exact server text, so the mock must copy it (§4)?

Source versions: `sdk/*` at the commits in `tools/fetch-sources.sh` (postmark.js 5.1.0, commit `f955212`).
Library cites use `<package>@<version> <path>:LINE` from the published npm package.
Marks: **DOC**, **SDK**, **LIB**, **CAPTURED**, **INFERRED** (`AGENTS.md` rule 6). No captures exist yet.

## 1. Surface tiers

Scope is the whole surface that the official SDKs reach, plus SMTP and webhooks.
A tier groups the surface. It does not set build order; `docs/09` "Phases" does.

| Tier | Meaning |
| --- | --- |
| T1 | The send path. Every SDK and SMTP client reaches it first. |
| T2 | State that sends create, and the APIs and webhooks that read or push that state. |
| T3 | Configuration, reporting and account administration. |

Endpoint lists per group, with per-SDK call lines, are in `docs/08` "Endpoint coverage matrix".

### 1.1 REST, server token

| Group | Paths | Tier | Doc |
| --- | --- | --- | --- |
| Auth, error envelope, JSON, paging | all | T1 | `docs/02` |
| Single and batch send | `POST /email`, `POST /email/batch` | T1 | `docs/03` "Endpoints" |
| Test token and sandbox server | `POSTMARK_API_TEST` on send paths | T1 | `docs/03` "Test token and sandbox"; `docs/07` "Sandbox mode" |
| Templated send | `POST /email/withTemplate`, `POST /email/batchWithTemplates` | T2 (needs the template store) | `docs/03` "Endpoints"; `docs/06` "Templates API" |
| Bulk send | `/email/bulk*` | T2 | `docs/03` "Bulk API" |
| Bounces and delivery stats | `/bounces*`, `/deliverystats` | T2 | `docs/04` "Bounce API" |
| Suppressions | `/message-streams/{stream}/suppressions*` | T2 | `docs/04` "Suppressions API" |
| Message streams | `/message-streams*` | T2 | `docs/04` "Message Streams API" |
| Messages: outbound and inbound search, details, dump, bypass, retry | `/messages/outbound*`, `/messages/inbound*` | T2 | `docs/06` "Messages API" |
| Opens and clicks | `/messages/outbound/opens*`, `/messages/outbound/clicks*` | T2 | `docs/06` "Opens and clicks" |
| Webhook configuration | `/webhooks*` | T2 | `docs/05` "Webhook config API" |
| Templates CRUD and validate | `/templates*` (not push) | T3 | `docs/06` "Templates API" |
| Stats | `/stats/outbound*` | T3 | `docs/06` "Stats API" |
| Server | `GET`/`PUT /server` | T3 | `docs/06` "Server API (server token)" |
| Inbound rule triggers | `/triggers/inboundrules*` | T3 | `docs/05` "Inbound rules triggers" |

### 1.2 REST, account token

| Group | Paths | Tier | Doc |
| --- | --- | --- | --- |
| Servers | `/servers*` | T3 | `docs/06` "Servers API (account token)" |
| Domains | `/domains*` | T3 | `docs/06` "Domains API (account token)" |
| Sender signatures | `/senders*` | T3 | `docs/06` "Sender Signatures API (account token)" |
| Template push | `PUT /templates/push` | T3 | `docs/06` "Push" |
| Data removals | `/data-removals*` | T3 | `docs/04` "Data Removals API" |
| SMTP tokens | No path in `refs/`. Only ErrorCodes 1450–1460 exist (`refs/api_overview.md:184-194` **DOC**). No SDK calls it (`docs/08` matrix). | T3 | `docs/02` "Error code table" |

### 1.3 SMTP and webhooks

| Group | Surface | Tier | Doc |
| --- | --- | --- | --- |
| SMTP submission | `smtp.postmarkapp.com`, `smtp-broadcasts.postmarkapp.com`; ports 25, 2525, 587; STARTTLS; AUTH | T1 | `docs/07` "SMTP" |
| SMTP `X-PM-*` headers | stream, tag, metadata, tracking, `KeepID` | T1 | `docs/07` "`X-PM-*` headers on SMTP" |
| Outbound event webhooks | Bounce, SpamComplaint, Delivery, Open, Click, SubscriptionChange, SMTP API Error | T2 | `docs/05` "Payloads per RecordType", "Delivery mechanics" |
| Inbound webhook | parsed inbound mail POSTed to the customer | T2 | `docs/05` "Inbound" |
| Test fixtures | `bounce-testing.postmarkapp.com` fake bounces | T2 | `docs/07` "Fake bounces" |

## 2. How clients choose the host

### 2.1 REST

Every official SDK defaults to `https://api.postmarkapp.com`. Every SDK except postmark-mcp has a base-URL option.
Server-token and account-token APIs share this one host (`refs/openapi/server.yml:8-9`, `refs/openapi/account.yml:10-11` **DOC**).

| SDK | Override | Cite **SDK** |
| --- | --- | --- |
| postmark.js | `requestHost` (host, may carry `:port`) + `useHttps`; constructor or `setClientOptions`; or a custom `fetch` | `sdk/postmark.js/src/client/models/client/HttpClient.ts:9-13,23-26`; `models/client/ClientOptions.ts:12-25` |
| postmark-cli | `--request-host` on template commands, passed to postmark.js `setClientOptions` | `sdk/postmark-cli/src/commands/templates/push.ts:34,109-110`; `commands/email/template.ts:67-68` |
| postmark-python | `base_url=` | `sdk/postmark-python/postmark/clients/server_client.py:41,48,90` |
| postmark-dotnet | `apiBaseUri` constructor argument | `sdk/postmark-dotnet/src/Postmark/PostmarkClient.cs:36`; `PostmarkAdminClient.cs:23` |
| postmark-php | static `PostmarkClientBase::$BASE_URL` | `sdk/postmark-php/src/Postmark/PostmarkClientBase.php:28` |
| postmark-gem (and postmark-rails) | `:host`, `:port`, `:secure`, `:path_prefix` | `sdk/postmark-gem/lib/postmark/http_client.rb:15-22` |
| postmark-java | `getApiClient(token, secure, customApiUrl)` | `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/Postmark.java:21,72-73` |
| postmark-mcp | none; constant | `sdk/postmark-mcp/index.js:19` |
| postmark-nodemailer | no code; the README points to the third-party `nodemailer-postmark-transport` | `sdk/postmark-nodemailer/README.md:5` |

Detail per SDK (scheme, timeout, retries, redirects): `docs/08` "Transport"; `docs/02` "Base URL and override, per SDK".

postmark.js host facts:

| Fact | Cite |
| --- | --- |
| `HttpClient.DefaultOptions` is a public mutable static. Clients built after a change use it. | `sdk/postmark.js/src/client/models/client/HttpClient.ts:4-13,19` **SDK** |
| Without a `fetch` option, the client calls the global `fetch` at request time (`(input, init) => fetch(input, init)`). | `sdk/postmark.js/src/client/HttpClient.ts:24` **SDK** |
| The SDK uses no HTTP library. Node's global `fetch` is undici. | `sdk/postmark.js/src/client/HttpClient.ts:24` **SDK**; undici **INFERRED** |
| SDK comment: undici `fetch` does not read `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`; a custom `fetch` is the supported proxy route. | `sdk/postmark.js/src/client/models/client/ClientOptions.ts:4-9` **SDK** |

### 2.2 SMTP

| Fact | Cite |
| --- | --- |
| Hosts: `smtp.postmarkapp.com` (transactional), `smtp-broadcasts.postmarkapp.com` (broadcast). | `refs/user-guide_send-email-with-smtp.md:28,34` **DOC** |
| Ports 25, 2525, 587. TLS through STARTTLS. | `refs/user-guide_send-email-with-smtp.md:35-36` **DOC** |
| No official SDK speaks SMTP. The host is the SMTP client's own setting. | `docs/08` "SDK inventory" |

nodemailer is the common Node SMTP client. Its host resolution matters for routing (§3):

| Behavior | Cite **LIB** |
| --- | --- |
| Resolves the host with `dns.Resolver` `resolve4` and `resolve6` (DNS queries). Calls `dns.lookup` (which reads the hosts file) only when both return no address. | `nodemailer@9.1.1 lib/shared/index.js:52-76,158-218` |
| Caches resolved addresses per host for 5 min, process-wide. | `nodemailer@9.1.1 lib/shared/index.js:19,78,184-187` |
| A host that is an IP skips resolution. | `nodemailer@9.1.1 lib/shared/index.js:108-119` |
| TLS SNI `servername` is the configured host name, unless the host is an IP. | `nodemailer@9.1.1 lib/smtp-connection/index.js:84` |
| Sends `STARTTLS` when the server advertises it, unless `ignoreTLS`. | `nodemailer@9.1.1 lib/smtp-connection/index.js:1506-1508` |
| A failed TLS upgrade (for example an untrusted certificate) is an `ETLS` error. It continues in plain text only with `opportunisticTLS` and only for a non-2xx `STARTTLS` reply. | `nodemailer@9.1.1 lib/smtp-connection/index.js:1596-1614` |
| Reads no proxy env var. The only proxy hooks are the `proxy` option and `getSocket`. The only `process.env` reads are Ethereal settings. | `nodemailer@9.1.1 lib/smtp-transport/index.js:32-33,67-70`; `lib/nodemailer.js:15-18` |

AUTH selection, pooling and connection close: `docs/07` "Pool lifecycle (nodemailer 9.1.1)".

### 2.3 Webhooks

Webhooks reverse the direction. The mock is the HTTP client; the application is the server.
The target URL comes from the webhook configuration API or server hook fields (`docs/05` "Webhook config API", "Legacy server-level hook URLs").
No routing trick is needed. The test configures a URL that the mock can reach.

## 3. Routing an unmodified application to the mock

### 3.1 Transport facts

| Fact | Mark |
| --- | --- |
| `NODE_EXTRA_CA_CERTS=<ca.pem>` adds a CA to Node's default TLS trust store at process start. undici `fetch` and `tls.connect` (nodemailer) use that store. | **INFERRED** (Node documentation, not in `refs/`) |
| undici connects through `net.connect`, which resolves with `dns.lookup`. So a hosts-file entry redirects `fetch`. | **INFERRED** |
| Node 24 `fetch` honors `HTTPS_PROXY` only when `NODE_USE_ENV_PROXY=1`. | **INFERRED** (local probe, §3.2) |
| Bundlers can inline the SDK into the application bundle. A preload that imports `postmark` then gets a different module instance. Changing `HttpClient.DefaultOptions` there does not reach the bundled copy. | **INFERRED** |
| Other languages' SDKs use their own HTTP stacks (`httpx`, Guzzle, `Net::HTTP`, Apache HttpClient, .NET `HttpClient`), each with its own proxy and trust-store rules. | `docs/08` "Transport" **SDK**; per-stack rules **INFERRED** |

### 3.2 Local probe (no Postmark traffic)

Setup: Node v24.18.0 and `postmark@5.1.0`.
`requestHost` is `api.postmarkapp.invalid`, so no name resolves.
A local TCP listener on `127.0.0.1:18443` answers `502`.

| Env | Listener saw | SDK error |
| --- | --- | --- |
| `HTTPS_PROXY=http://127.0.0.1:18443` | nothing | `PostmarkError`, `statusCode 0`, `fetch failed` |
| `HTTPS_PROXY=…` + `NODE_USE_ENV_PROXY=1` | `CONNECT api.postmarkapp.invalid:443 HTTP/1.1` | `PostmarkError`, `statusCode 0`, `fetch failed` |

Result: the env-proxy route works only with `NODE_USE_ENV_PROXY=1`. **INFERRED** (one local run).

### 3.3 Options

| Option | REST | SMTP | Needs | Tradeoff | Mark |
| --- | --- | --- | --- | --- | --- |
| A. Base-URL option | set the SDK option to the mock (§2.1) | set the SMTP host and port to the mock | the application exposes the setting as config | Simplest. Not possible when the application hard-codes the host, or for postmark-mcp. Plain `http://` hides TLS bugs. | SDK |
| B. DNS + test CA | resolve `api.postmarkapp.com` to the mock; mock serves a cert for that name | resolve `smtp.postmarkapp.com` (and `smtp-broadcasts`) to the mock; mock advertises `STARTTLS` with that cert | a DNS server that answers for the names (container network alias, private DNS zone, local resolver); `NODE_EXTRA_CA_CERTS` or the runtime's trust store | Covers REST and SMTP with no config change. Affects every process that uses that resolver. A hosts-file entry alone does not redirect nodemailer while public DNS answers (§2.2). | INFERRED |
| C. Env proxy | `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1`; mock accepts `CONNECT api.postmarkapp.com:443` and terminates TLS with the test CA | not covered | `NODE_EXTRA_CA_CERTS`; `NO_PROXY` for every other egress | REST only. All other `fetch` egress goes through the proxy unless listed in `NO_PROXY`. | INFERRED (probe shows `CONNECT`, §3.2) |
| D.a Preload replaces `globalThis.fetch` or the undici global dispatcher | works: postmark.js looks up `fetch` per request (§2.1) | not covered | `NODE_OPTIONS=--require <file>` | Runs test code inside the application process. Affects all `fetch` calls. | SDK (`HttpClient.ts:24`); route INFERRED |
| D.b Preload patches `dns.lookup` | works (§3.1) | fails while public DNS answers: nodemailer queries DNS first (§2.2) | `NODE_OPTIONS=--require <file>` | Runs code inside the process. Also needs the test CA. | INFERRED; nodemailer part LIB |
| D.c Preload sets `HttpClient.DefaultOptions` | fails when the SDK is bundled (§3.1) | not covered | — | Not a route. | INFERRED |
| E. SMTP without TLS | — | mock does not advertise `STARTTLS`; nodemailer then sends `AUTH` in plain text | option A or B for the host | **Rejected.** Postmark offers STARTTLS (`refs/user-guide_send-email-with-smtp.md:36` **DOC**). A mock without it hides TLS bugs. | LIB (`smtp-connection/index.js:1506`) |

Option B is the only option that covers REST and SMTP with no application setting.
The mock SMTP listener advertises `STARTTLS` with a test-CA certificate (`docs/07` "Mock must").
Route choice and the real-send guard: `docs/09` §4 "Routing: reaching the mock without changing clients".

## 4. Client code that parses exact server text

### 4.1 ErrorCode 406: inactive recipients

Three SDKs extract the refused addresses from `Message` with a regex.
The mock `Message` must match every regex, or those clients get an empty list.

| SDK | Property | Regex | Split | Cite **SDK** |
| --- | --- | --- | --- | --- |
| postmark.js | `InactiveRecipientsError.recipients` | `/Found inactive addresses: (.+?)\.? Inactive/`, then `/these inactive addresses: (.+?)\.?$/` | `,` then trim | `sdk/postmark.js/src/client/errors/Errors.ts:97-127` |
| postmark-gem | `InactiveRecipientError#recipients` | `/Found inactive addresses: (.+?)\. Inactive/`, then `/these inactive addresses: (.+?)\.?$/` | exactly `", "` | `sdk/postmark-gem/lib/postmark/error.rb:77-93` |
| postmark-python | `InactiveRecipientException.inactive_recipients` | `Found inactive addresses:\s*(.+?)\.(?:\s\|$)` | `,` then strip, drop empty | `sdk/postmark-python/postmark/exceptions.py:70-86` |
| dotnet, php, java, mcp | none | — | — | `docs/02` "Other SDKs" |

Consequences:

| Rule | Why | Mark |
| --- | --- | --- |
| Separate addresses with `", "`. | gem splits on `", "` only. | SDK |
| End the address list with `. Inactive` (period, space, `Inactive`). | gem needs the period; postmark.js needs ` Inactive`; python needs `.` then whitespace or end. | SDK |
| A client that reads the recipient list gets `[]` when no regex matches. The error class does not change. | `Errors.ts:112-127` | SDK |
| The class needs HTTP 422 in postmark.js. A 406 code under another status gives no `InactiveRecipientsError`. | `docs/02` "postmark.js" | SDK |

Known `Message` forms:

| Case | Text | Cite |
| --- | --- | --- |
| All recipients inactive, single send (mock default until captured) | `You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: a@example.com, b@example.com. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression.` | `sdk/postmark.js/test/unit/ErrorHandler.test.ts:113-116`; `sdk/postmark-gem/spec/unit/postmark/error_spec.rb:254-257` **SDK** (fixtures, not captures) |
| Batch item (inside HTTP 200) | `You tried to send to a recipient that has been marked as inactive. Found inactive addresses: example@example.com. Inactive recipients are … suppression. ` (trailing space) | `refs/api_email-api.md:301-313` **DOC** |
| Some recipients inactive | `Message OK, but will not deliver to these inactive addresses: a@example.com, b@example.com.` HTTP status unknown. python's regex does not match it. | `sdk/postmark-gem/spec/unit/postmark/error_spec.rb:250-252`; `sdk/postmark.js/test/unit/ErrorHandler.test.ts:136,144` **SDK** |

Partial suppression (active `To`, suppressed `Bcc`):
the mock returns HTTP 422 / 406 naming the suppressed addresses, and delivers to the active recipients.
**INFERRED**: reported by an application integrator; unverified.
The SDK fixture above suggests a different `Message` form for this case. Q2 decides. Full rule: `docs/03` "ErrorCode 406 — inactive recipients"; `docs/04` "The 406 response on `/email`".

### 4.2 Other text and shape that clients depend on

| Dependency | Effect if the mock differs | Doc |
| --- | --- | --- |
| Success is HTTP 200 with JSON | php, gem, java and dotnet treat 201/204 as errors | `docs/02` "HTTP status codes" |
| Error body has numeric `ErrorCode` and string `Message` | postmark.js: missing `Message` becomes `Request returned status code <n>`; a string body gives `code 0`. java throws on a non-JSON 401/422 body. | `docs/02` "postmark.js", "Other SDKs" |
| postmark-python picks the exception class by `ErrorCode` first (10, 300, 405, 406, 701) | a wrong code changes the class even with the right status | `docs/02` "Other SDKs" |
| A rejection is an HTTP status, never a closed socket | postmark.js maps a transport failure to `statusCode 0`, which a caller cannot tell from a timeout | `docs/02` "postmark.js" |
| postmark-mcp message format `Postmark API <status> (ErrorCode <n>): <Message>` | `Message` text reaches the MCP user as is | `docs/02` "Other SDKs" |

## 5. Mock must

- [ ] Cover every group in §1. Tiers group the work; `docs/09` "Phases" orders it.
- [ ] Answer REST at any host name and port the test routes to it. Do not require the `Host` header to be `api.postmarkapp.com`. (§3.3 A–D)
- [ ] Serve TLS for `api.postmarkapp.com`, `smtp.postmarkapp.com` and `smtp-broadcasts.postmarkapp.com` from a test CA. (§3.3 B)
- [ ] Advertise `STARTTLS` on every SMTP port. (§3.3 E)
- [ ] Ship DNS for option B as a DNS answer (container network alias or resolver), not only a hosts-file entry. (§2.2)
- [ ] Use a 406 `Message` that matches the postmark.js, gem and python regexes: addresses joined by `", "`, followed by `. Inactive`. (§4.1)
- [ ] Return HTTP 422 with ErrorCode 406 for an inactive recipient on a single send. (§4.1)
- [ ] For partial suppression, deliver to active recipients and return 422 / 406 until a capture decides the form. (§4.1, INFERRED)

## 6. Open questions

| # | Question | Why |
| --- | --- | --- |
| Q1 | Which 406 `Message` does Postmark return for a single send: DOC batch form `a recipient that has been`, or SDK fixture `recipient(s) that have been`? Trailing space? | Both match the regexes, but the mock copies one text. Capture (`docs/10`). |
| Q2 | Send with active `To` and suppressed `Bcc`: HTTP status, ErrorCode, `Message` form (`Found inactive addresses` or `Message OK, but will not deliver to these inactive addresses`), and is `To` delivered? | The only evidence is an integrator report (§4.1). python's regex does not match the second form. |
| Q3 | From which Node version does `fetch` honor `NODE_USE_ENV_PROXY`? | Option C depends on it. Not a Postmark capture; check Node release notes. |
