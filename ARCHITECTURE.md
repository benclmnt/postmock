# Architecture

Status: built. W0 laid the foundation; tracks T1–T8 built the endpoints, SMTP, webhooks and inbound processing (`docs/11` §3.2); W2 integrated them; W3 added REST over TLS, the CLI, the npm package, the Docker image, Compose and CI.
Open work: the endpoints marked `design` in `CONTROL-API.md`, and captures (`docs/10`).

postmock is one Node 24 process with one in-memory state.
Real, unmodified Postmark clients talk to it.
A test drives it through a separate control port.

```
SDK or app ──── REST  http :8080, https (built) ─────────────────┐
SMTP client ─── SMTP  POSTMOCK_SMTP_PORTS, STARTTLS (built) ─────┤
                                                                ├── postmock ── webhook emitter (built) ──► customer URLs
test runner ─── control API  http :8025 (built) ────────────────┘
```

## How clients reach the mock

The client code never changes (`AGENTS.md` rule 3). Details: `docs/01` §3.3, `docs/09` §4.

| Route | Covers | How | Status |
| --- | --- | --- | --- |
| A. Base-URL option | REST; SMTP host and port | Set the SDK host option to the mock (postmark.js `requestHost` + `useHttps: false`; dotnet and php `BASE_URL`) | built (plain http) |
| B. DNS + test CA | REST and SMTP | A DNS answer sends `api.postmarkapp.com` and `smtp.postmarkapp.com` to the mock; the client trusts a test CA (`tools/test-ca.sh`) | built: `compose.yaml` (network aliases, postmock's https listener), and the java and cli runners (a Docker network alias and a TLS front in the runner, `conformance/docker.ts`) |
| D. Preload | REST in Node and Ruby | `mocha -r` or `NODE_OPTIONS=--import` replaces `globalThis.fetch`; `rspec --require` sets the `Postmark::HttpClient` host | built for the postmark.js, mcp, gem and rails runners |

Real-send guard: the seeds use tokens that only postmock knows.
A misrouted request gets 401 from real Postmark and sends nothing.
The conformance runners also prove their route before and after each suite (`TESTING.md` "Routing proof").

## Listeners

| Listener | Default | Env | Serves | Status |
| --- | --- | --- | --- | --- |
| REST, plain http | `127.0.0.1:8080` | `POSTMOCK_HOST`, `POSTMOCK_API_PORT` | Server-token and account-token API on any host, at `/` | built |
| REST, https | off | `POSTMOCK_HTTPS_PORT` + `POSTMOCK_HTTPS_TLS_KEY` + `POSTMOCK_HTTPS_TLS_CERT` (PEM files; all three or none) | Same app as plain http, with a test-CA cert (route B) | built |
| Control API | `127.0.0.1:8025` | `POSTMOCK_CONTROL_PORT` | `CONTROL-API.md` | built |
| SMTP | `127.0.0.1:0` (a free port) | `POSTMOCK_SMTP_PORTS` (comma list; every port serves the same endpoint), `POSTMOCK_SMTP_TLS_KEY` + `POSTMOCK_SMTP_TLS_CERT` (PEM files; offers STARTTLS) | Postmark SMTP (`docs/07`). For Postmark's ports set `2525` and map 25 and 587 to it (`-p 25:2525 -p 587:2525 -p 2525:2525`). | built |
| Webhook emitter | outbound | `POSTMOCK_WEBHOOKS_ALLOW_HOSTS` (comma-separated hostnames, `*` for all; default: none) | Every RecordType, retries on the clock (`docs/05`). Reaches only loopback hosts (`localhost`, `127.0.0.0/8`, `::1`) and the listed hosts over `http:`/`https:`, also for redirects; an entry with a port fails at start. A refused hop, or a redirect `Location` with userinfo, opens no socket and is logged as a `stop` attempt with no retry (`docs/05` D3). A retry is dropped once its hook changes (`docs/05` D4) | built (`src/plugins/webhooks.ts`) |

`POSTMOCK_SEED` (default `empty`) names the seed applied at start.
Every env key is also a CLI flag: `postmock --seed conformance --api-port 0` sets `POSTMOCK_SEED` and `POSTMOCK_API_PORT` (`postmock --help`).
Port `0` picks a free port; startup prints one `name=url` per listener, plugin listeners included.
Listeners bind in order api, https, plugins, control: once the control API answers, every listener is up.

## Request flow (REST)

| Step | Result on failure | Code |
| --- | --- | --- |
| 1. A control-API fault matches method and path | the fault reply | `src/http/faults.ts` |
| 2. The route table matches method and path; one trailing slash is ignored | 404, plain text `postmock: no route for …` (also for `//` or a bad percent-escape) | `src/http/routes.ts` |
| 3. Auth reads the token header the route needs. `POSTMARK_API_TEST` gets a stored-nowhere server with the default streams (INFERRED) | 401 + ErrorCode 10; 501 for `POSTMARK_API_TEST` where its behavior is unknown | `src/http/auth.ts` |
| 4. The body decodes as UTF-8 JSON | 422 + ErrorCode 402 | `src/http/normalize.ts` |
| 5. The handler returns a JSON body | `ApiError` → envelope; `Unsupported` → 501 text; any other throw → 500 text | `src/http/app.ts` |

A success is always HTTP 200 with `Content-Type: application/json`.
The handler cannot choose another success status.

## Modules

| Path | Holds | Status |
| --- | --- | --- |
| `src/main.ts`, `src/config.ts` | The `postmock` CLI: flags set env keys (a flag wins over the env), env becomes `PostmockConfig`; empty values, non-decimal ports and missing PEM files stop startup | built |
| `src/server.ts` | `startPostmock(config)`: seed, REST and control listeners | built (SMTP starts as a plugin) |
| `src/runtime.ts` | `Runtime`: store, events, clock; `createRuntime()` installs every plugin | built |
| `src/plugins.ts`, `src/plugins/` | Plugin contract and loader; one file per plugin | built (`smtp.ts`, `stats.ts`, `message-events.ts`) |
| `src/errors.ts` | ErrorCode table (`docs/02` §4.4), `apiError`, `errorBody` | built |
| `src/time.ts` | Eastern-time parse and the timestamp formats of `docs/02` §7.1 | built |
| `src/http/` | Route registry, normalization, auth, responder, faults, app factory | built |
| `src/discover.ts` | Imports route, control and seed-part files from disk in filename order, with its own file extension: `.ts` from the sources, `.js` from `dist/` | built |
| `src/api/index.ts` | Loads every `src/api/<group>/routes.ts` | built |
| `src/api/server/` | `GET/PUT /server`; `serverJson`; `PUT` uses `editServer` from `src/api/account/servers.ts` | built |
| `src/api/account/` | Account-token API: servers, domains, sender signatures, template push | built (T7) |
| `src/api/email/` | `POST /email`, `POST /email/batch`; `sendResponse`, `batchItem` for other send routes | built (T1) |
| `src/api/bounces/`, `src/api/suppressions/`, `src/api/message-streams/`, `src/api/data-removals/` | Bounce, Suppressions, Message Streams and Data Removals APIs (`docs/04`) | built (T2) |
| `src/recipients/` | The bounce and suppression state machine (`docs/04` §3.2): `recordBounce`, `recordUnsubscribe`, `activateBounce`, `suppressByCustomer`, `deleteSuppression`; each emits its events. `MessageEvents` on the message come from listeners of those events (T4). | built (T2) |
| `src/api/templates/` | Templates CRUD, `/templates/validate`, `/email/withTemplate`, `/email/batchWithTemplates` (replies from `src/api/email/json.ts`) | built (T3; push: T7) |
| `src/api/bulk/` | `/email/bulk` send, status, list; processing on the clock | built (T3) |
| `src/api/messages/` | Messages API: outbound and inbound search and details, dump, opens, clicks; paging caps (inbound bypass and retry: T5) | built (T4) |
| `src/api/stats/` | Stats API from recorded facts | built (T4) |
| `src/api/webhooks/` | `/webhooks` list, get, create, edit, delete; `verify` and `statistics` answer 501 | built (T5) |
| `src/api/triggers/` | `/triggers/inboundrules` list, create, delete | built (T5) |
| `src/api/inbound/` | `PUT /messages/inbound/{id}/bypass`, `/retry` | built (T5) |
| `src/state/` | Entity types, `Store` (incl. `stats` facts), ids, `Clock`, `createServer` | built |
| `src/events.ts` | Typed event bus | built |
| `src/pipeline/` | `validateOutbound` (data checks, no state change), `acceptOutbound` (account approval, suppressions, store, `sent`), `submitOutbound` (both); `draftFromJson`; address lists; 406 wording | built (T1) |
| `src/control/` | Control registry, app, seed loader; endpoints in `endpoints/*.ts` | built (more endpoints: tracks) |
| `src/render/` | Mustachio renderer: parse errors, render, suggested model | built (T3) |
| `src/tracking.ts` | Recipient actions: delivery (writes the `Delivered` event), open, click; refuses what a real recipient could not do | built (T4) |
| `src/plugins/stats.ts`, `src/plugins/message-events.ts` | Stats facts from events; `MessageEvents` for bounces, complaints, subscription changes, first opens and first clicks | built (T4) |
| `src/webhooks/` | Payloads per RecordType, hook selection, delivery with retries and the attempt log | built |
| `src/mime/` | `composeMime`: the MIME source of a control inbound message, a REST send and a seeded past send | built |
| `src/inbound/` | MIME parse, server routing, rules, spam threshold, hook delivery | built |
| `src/plugins/webhooks.ts` | Subscribes the emitter to every domain event | built |
| `src/plugins/test-bounces.ts` | A send to `bounce-testing.postmarkapp.com` bounces at once: type from `X-PM-Bounce-Type` or the local part (`docs/07` §2.3) | built |
| `src/smtp/` | SMTP listener (`smtp-server`), AUTH, MIME to `OutboundDraft` (`mailparser`), `SMTPApiError` bounces; started by `src/plugins/smtp.ts` | built |
| `seeds/` | `empty`, `conformance` (parts in `seeds/conformance/*.ts`, shared constants, `read-server.ts`, `template-server.ts` and `history.ts` past traffic in `seeds/lib/`) | built (more parts: tracks) |
| `conformance/` | Runners, results, ratchet (`TESTING.md`) | built for every SDK suite |

## Shared contracts

A track adds files. postmock finds them on disk in filename order; no shared list needs an edit (`docs/11` §5).
A change to a contract below goes through the integrator.

| Contract | Path | Shape |
| --- | --- | --- |
| API route | `src/http/routes.ts` | `defineRoute({ method, path: "/templates/:idOrAlias", auth: "server" \| "serverOrTest" \| "account", handler(ctx) })`. The handler returns the 200 body or throws `ApiError`/`Unsupported`. `ctx` has `store`, `events`, `clock`, `params`, `query`, `body`, `headers`, `auth`. |
| API group registration | `src/api/<group>/routes.ts` | The file exists; `src/api/index.ts` imports it |
| Errors | `src/errors.ts` | `apiError(code, { family?, status?, message? \| params?, extra? })`; `errorBody(code, …)` for a batch item; `apiErrorOf(body)` answers a body built earlier (a send rejection) with the one status of its code. A `summary` row needs `message`, used verbatim; `params` fill `{name}` only in a `message` row; `extra` cannot set `ErrorCode` or `Message`. `isSummaryRow`, `ERROR_FAMILIES`. |
| Normalization | `src/http/normalize.ts` | `ctx.query.get/all/prefixed/pick(schema)`; codecs `queryBool`, `queryInt`, `queryDate`; `parseBody(schema, ctx.body)`; codecs `absent`, `intLike`, `objectOrEmptyArray`, `base64` |
| Responses | `src/http/respond.ts` | `paged(key, items, count, offset)`; `Unsupported` |
| Send pipeline | `src/pipeline/submit.ts` | `await submitOutbound(runtime, { auth, channel, draft: OutboundDraft, request, rawSource (SMTP only), bulkRequestId, templateId }): Promise<SubmitResult>` = `validateOutbound(runtime, submission): Validation` then `await acceptOutbound(runtime, outbound)`. `validateOutbound` runs every type, syntax and limit check with no state change; a rejection names its `field` (for the bulk `Errors` map). `acceptOutbound` / `acceptOutbounds` apply account approval and suppressions, store every message, then emit `sent` for each. JSON channels build the draft with `draftFromJson`. Every draft field is `unknown`: the channel passes values as received (REST JSON values, SMTP header text such as `X-PM-TrackOpens`). For REST the pipeline writes the MIME source from the draft (INFERRED layout). |
| Event bus | `src/events.ts` | `events.on(name, listener)` → unsubscribe; `await events.emit(name, payload)` awaits each listener in order. Listeners may be async; later work goes on the clock. Names: `sent`, `delivered`, `bounced`, `opened`, `clicked`, `spamComplaint`, `subscriptionChange`, `inboundReceived`, `smtpApiError` |
| Store | `src/state/store.ts` | `store.state.<collection>`; `store.nextId(kind)` (throws while seeding); `store.useId(kind, id)` for a fixed ID; `store.reset()`; `streamKey`, `suppressionKey` |
| Suppressions | `src/state/suppressions.ts` | `suppressedAddresses(state, serverId, streamId, emails)`, the one read path for the send-side 406 check; `findSuppression`. A stored message keeps the recipients it skipped in `suppressedRecipients`. Writes go through `src/recipients/`. |
| Servers | `src/state/servers.ts` | `createServer(store, now, settings)` and `addAccountToken(store, token)` refuse a token held twice (without case) and `POSTMARK_API_TEST`; `testTokenContext(now)`; `findStream(state, auth, id)` for a stored or test-token server |
| Entities | `src/state/types.ts` | PascalCase fields are wire fields; camelCase fields are internal; dates are `Date` |
| Clock | `src/state/clock.ts` | `clock.now()`; `clock.schedule(delayMs, run)` with a sync or async `run`; `await clock.advance(ms)` runs due tasks in due order with `now()` at each due time, including tasks they schedule. Advances and real-timer tasks run one at a time; `await clock.idle()` waits for them. `reset()` throws during an advance; `checkpoint()` returns a restore function. |
| Control endpoint | `src/control/registry.ts` | `defineControl({ method, path: "/control/…", handler(ctx) })`; `controlInput(schema, ctx.body)`; throw `ControlError` for 400 |
| Control registration | `src/control/endpoints/<topic>.ts` | The file exists; `src/control/index.ts` imports it |
| Seed part | `seeds/conformance/<NN-part>.ts` | Default export `Seed = (runtime) => void \| Promise<void>`. It claims fixed IDs from its track's range (`docs/11` §5). |
| Plugin | `src/plugins/<name>.ts` (`src/plugins.ts`) | Default export `{ install?(runtime), start?(runtime, host): Promise<{ name, url, close() }> }`. `install` runs on every runtime before the seed; `start` runs after the seed; `close` runs on shutdown. The plugin reads its own env keys. |

## Deviations from real Postmark

Each one is a place where Postmark behavior is unknown. The mock fails loudly there instead of guessing (`AGENTS.md` rule 5).

| Case | postmock answer | Open question |
| --- | --- | --- |
| Unknown route | 404, plain text | `docs/02` §9 Q9 |
| `POSTMARK_API_TEST` on a route that does not accept it yet | 501, plain text | `docs/02` §9 Q8 |
| A send `From` that no sender signature or domain covers | accepted: postmock does not check senders | `docs/03` §8 Q3 |
| A message over 10 MB, a body part over 5 MB, a batch over 50 MB (HTTP 413) | 501, plain text | `docs/02` §9 Q10 |
| A send to an archived stream | 501, plain text | `docs/04` Q15 |
| An `/email` body that is not a JSON object; a batch body that is not an array of objects | 501, plain text | `docs/02` §9 Q16 |
| An unknown `MessageStream` in a batch | 501, plain text; the batch sends nothing | `docs/03` §8 Q14 |
| Suppressions API or Bounce API state with an unknown effect: delete or re-suppress of an unsubscribe or `Admin` row, a bounce over a row of another reason, activate of an active bounce, any call on an archived stream's suppressions | 501, plain text | `docs/04` Q4, Q9, Q15 |
| Stream handling type `Postmark` or `Custom` on a Transactional stream; archive of an archived stream; unarchive of an active stream | 501, plain text | `docs/04` §4 |
| Data removal with a malformed body or an invalid `RequestedFor` | 501, plain text | `docs/04` Q16 |
| Data removal status: a request stays `Pending`, and erases nothing | 200, `Pending` | `docs/04` Q16 |
| A purged stream (a clock task at `ExpectedPurgeDate`): the stream, its suppressions and bounces are deleted; unarchive answers 1232; create may reuse its ID | INFERRED | `docs/04` §4.3 |
| Suppressions of an inbound stream; edit of an archived stream | 501, plain text | `docs/04` §2, §4 |
| A response shape nobody captured (a track throws `Unsupported`) | 501, plain text | per route |
| `/stats/outbound/opens/readtimes` bucket names | whole seconds read (`"5"`) per unique open with a read time; the shape comes from the SDK clients | `docs/06` §2.2, `docs/10` C42 |
| A body with two spellings of one key (`HtmlBody` and `htmlBody`) | 501, plain text | — |
| An unknown server ID on `/servers/{id}`: no servers ErrorCode names it | 501, plain text | capture |
| A field of the wrong JSON type on an account-token body | 501, plain text | capture |
| `DeliveryType` change on `PUT /servers/{id}`; a signature without `Name`; a successful `requestnewdkim` | 501, plain text | capture |
| `InboundDomain` on a server: no MX lookup (ErrorCode 610 never occurs) | accepted | — |
| An unknown sender signature | 404 + ErrorCode 501 (the doc allows 422 or 404); an unknown domain is 422 + 510 | capture |
| Free mail domains refused for a signature (ErrorCode 503) | a fixed list of 8 domains | capture |
| A verified DKIM key replaces an older key | the old key becomes revoked with `SafeToRemoveRevokedKeyFromDNS: true` at once | capture |
| Domain and signature DNS (DKIM, Return-Path CNAME) | verified only through the control API | — |
| Template syntax the article omits (`{{! }}`, `{{> }}`), `{{#x}}` on a list, `{{x}}` on an object or list | 501, plain text | `docs/06` §3.5 |
| Rendered HTML with a `<style>` block while `InlineCss` is on (default) | 501, plain text | `docs/06` Q12 |
| A `TemplateType` change on edit; a new alias for a layout in use | 501, plain text | `docs/06` §3.2 |
| A bulk send on a non-broadcast stream; `GET /email/bulk` without `count` 1–500 | 501, plain text | `docs/03` Q20 |
| A bulk message that reaches uncaptured behavior on the clock (a stream archived after accept) | the request stops releasing and never completes; the reason goes to stderr and `GET /control/bulk/:id` | `docs/03` §1.6 |
| A bug in postmock | 500, plain text with the stack | — |
| Webhook create or edit without `Verify: false` | saved `verified`; no probe (INFERRED, `docs/05` conflict V1) | `docs/05` Q13 |
| `POST /webhooks/{id}/verify`; `GET /webhooks/{id}/statistics` | 501, plain text | `docs/05` Q13, Q19 |
| A webhook or hook URL at a host that is not loopback | no request; an `egress refused` attempt | `docs/05` D3 |
| 401 `Message` text | the doc table text for ErrorCode 10 | `docs/02` §9 Q2 |
| SMTP behavior nobody captured: `POSTMARK_API_TEST` as AUTH, an SMTP token with `X-PM-Message-Stream` naming another stream | SMTP 502 with the reason | `docs/07` Q4, Q13 |
| SMTP bad credentials, SMTP disabled, revoked token | 535 at AUTH (and at MAIL/DATA on an open connection) | `docs/07` Q3 |
| SMTP message over 10 MB | 552 at `MAIL FROM SIZE=` or at DATA | `docs/07` Q3 |
| SMTP DATA reply | `250 Ok: queued as <MessageID>`; for a rejected message, the MessageID of its `SMTPApiError` bounces | `docs/07` Q1 |
| SMTP idle connection | never closed; a control fault answers the next command with 421 | `docs/07` Q11 |
| SMTP EHLO | no `8BITMIME`, so clients encode 8-bit bodies; raw 8-bit bytes that are not UTF-8 are not kept byte for byte in `Request` and `rawSource` | `docs/07` Q2 |
| SMTP postmock bug | 554 with the message | — |
| SMTP recipients | `RCPT TO` only; `To`/`Cc` headers sort and name them; a header address outside the envelope is dropped | `docs/07` §1.1 |
| SMTP delivered copy (`rawSource`) | passed to `submitOutbound`; incoming `X-PM-*` removed; `X-PM-Tag` added; `Message-ID: <uuid@mtasv.net>` unless `X-PM-KeepID: true`; no `X-PM-Message-Id` (the pipeline mints the MessageID later) | `docs/07` Q8 |
| `SMTPApiError` bounce | one per affected recipient; `Content` = `ErrorCode`, `Message`, raw MIME | `docs/07` Q9 |

## Traps

| Trap | Source |
| --- | --- |
| The 406 `Message` must keep `Found inactive addresses: a, b. Inactive`. postmark.js, gem and python parse the addresses with regexes; gem splits on `", "` only. | `docs/01` §4.1 |
| Paths, query keys and body keys arrive in every case (`/deliveryStats`, `fromEmail`, `HTMLBody`). Match literals without case; keep param and record-key case. | `docs/08` R2, R3, R8 |
| Every success is HTTP 200. php, gem, java and dotnet treat 201 and 204 as errors. | `docs/08` E1 |
| A rejection is an HTTP status, never a closed socket. postmark.js reports a closed socket as `statusCode 0`, the same as a timeout. | `docs/02` §5.1 |
| `JSON.stringify` turns a `Date` into a 3-digit `Z` string. Postmark uses 7 digits and an Eastern offset. The responder throws on a raw `Date`; format it with `src/time.ts`. | `docs/02` §7.1 |
| A hosts-file entry does not redirect SMTP from nodemailer: it queries DNS (`resolve4`/`resolve6`) before `dns.lookup`. Route B needs a real DNS answer. | `docs/01` §2.2, §3.3 |
| postmark.js has no proxy support and a default host. An app that never sets the host needs route B. | `docs/01` §3.3 |
| A bundled app has its own copy of postmark.js. A preload that sets `HttpClient.DefaultOptions` does not reach it; replacing `globalThis.fetch` does. | `docs/01` §3.1 (D.c) |
| postmark-cli uses postmark.js 4.0.2 (axios), not fetch. The fetch shim does not reach it. | `docs/08` §0 |
| A route pattern with a literal wins over a param at the same position (`PUT /templates/push` before `/templates/:idOrAlias`). | `docs/08` §2.5 |
| `614` and `1226` appear under several families; `501` and `1408` use several statuses; `1406` appears only inside 200 bodies. `apiError` throws until the caller names the family or status. | `docs/02` §4.4 |
| Many docs/02 §4.4 rows summarize several messages (300, 700, 1000, 1122, …). Those rows are marked `summary`; the caller passes the exact wire text. | `src/errors.ts` |
| `setTimeout` fires at once for a delay above 2^31−1 ms. The clock arms no real timer past that limit. | Node timers |
| `smtp-server` reads `socketTimeout: 0` and `closeTimeout: 0` as its defaults (60 s, 30 s). The SMTP listener passes 2^31−1 ms (never idle-close) and 1 ms. | `smtp-server@3.19.13` `lib/smtp-connection.js:585`, `lib/smtp-server.js:174` |
| nodemailer writes header names in title case (`X-PM-Metadata-client-id` → `X-Pm-Metadata-Client-ID`). Metadata keys keep the wire case, so a nodemailer send gets `Client-ID`. | **LIB** nodemailer 9.1.1 `lib/mime-node/index.js:344`, `:1220`; `src/smtp/smtp.test.ts` |
| The CRLF before the terminating `.` ends the last body line: a single-part SMTP `TextBody` ends in `\n`. | RFC 5321 §4.1.1.4 |
| An SMTP message problem is never an SMTP reject: SMTP answers 250 and records `SMTPApiError` bounces (`smtpApiError` event). | `docs/07` §1.4 |
