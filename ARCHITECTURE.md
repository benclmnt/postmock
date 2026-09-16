# Architecture

Status: W0 (foundation) is built.
Built: the REST listener, request normalization, token auth, the ErrorCode table, `GET /server`, the state types and store, the clock, the event bus, the control API skeleton, and the postmark.js conformance runner.
Design: every other endpoint, the send pipeline body, SMTP, TLS, the webhook emitter and inbound processing.
Tracks T1–T8 build the design parts (`docs/11` §3.2).

postmock is one Node 24 process with one in-memory state.
Real, unmodified Postmark clients talk to it.
A test drives it through a separate control port.

```
SDK or app ──── REST  http :8080 (built), https :443 (design) ──┐
SMTP client ─── SMTP  :25 :587 :2525, STARTTLS (design) ────────┤
                                                                ├── postmock ── webhook emitter (design) ──► customer URLs
test runner ─── control API  http :8025 (built) ────────────────┘
```

## How clients reach the mock

The client code never changes (`AGENTS.md` rule 3). Details: `docs/01` §3.3, `docs/09` §4.

| Route | Covers | How | Status |
| --- | --- | --- | --- |
| A. Base-URL option | REST; SMTP host and port | Set the SDK host option to the mock (postmark.js `requestHost` + `useHttps: false`; dotnet and php `BASE_URL`) | built (plain http) |
| B. DNS + test CA | REST and SMTP | A DNS answer sends `api.postmarkapp.com` and `smtp.postmarkapp.com` to the mock; the client trusts a test CA | design (W3) |
| D. Preload | REST in Node | `mocha -r` or `NODE_OPTIONS=--require` replaces `globalThis.fetch` | built for the postmark.js runner only |

Real-send guard: the seeds use tokens that only postmock knows.
A misrouted request gets 401 from real Postmark and sends nothing.

## Listeners

| Listener | Default | Env | Serves | Status |
| --- | --- | --- | --- | --- |
| REST, plain http | `127.0.0.1:8080` | `POSTMOCK_HOST`, `POSTMOCK_API_PORT` | Server-token and account-token API on any host, at `/` | built |
| REST, https | 443 | — | Same, with a test-CA cert (route B) | design |
| Control API | `127.0.0.1:8025` | `POSTMOCK_CONTROL_PORT` | `CONTROL-API.md` | built |
| SMTP | 25, 587, 2525 | — | Postmark SMTP (`docs/07`) | design (T6) |
| Webhook emitter | outbound | — | Every RecordType, retries on the clock (`docs/05`) | design (T5) |

`POSTMOCK_SEED` (default `empty`) names the seed applied at start.
Port `0` picks a free port; startup prints the URLs.

## Request flow (REST)

| Step | Result on failure | Code |
| --- | --- | --- |
| 1. A control-API fault matches method and path | the fault reply | `src/http/faults.ts` |
| 2. The route table matches method and path | 404, plain text `postmock: no route for …` | `src/http/routes.ts` |
| 3. Auth reads the token header the route needs | 401 + ErrorCode 10; 501 for `POSTMARK_API_TEST` where its behavior is unknown | `src/http/auth.ts` |
| 4. The body decodes as UTF-8 JSON | 422 + ErrorCode 402 | `src/http/normalize.ts` |
| 5. The handler returns a JSON body | `ApiError` → envelope; `Unsupported` → 501 text; any other throw → 500 text | `src/http/app.ts` |

A success is always HTTP 200 with `Content-Type: application/json`.
The handler cannot choose another success status.

## Modules

| Path | Holds | Status |
| --- | --- | --- |
| `src/main.ts` | Reads env, starts postmock | built |
| `src/server.ts` | `startPostmock(config)`: seed, REST and control listeners | built (SMTP, TLS: design) |
| `src/runtime.ts` | `Runtime`: store, events, clock | built |
| `src/errors.ts` | ErrorCode table (`docs/02` §4.4), `apiError`, `errorBody` | built |
| `src/time.ts` | Eastern-time parse and the timestamp formats of `docs/02` §7.1 | built |
| `src/http/` | Route registry, normalization, auth, responder, faults, app factory | built |
| `src/api/index.ts` | One import per API group | built |
| `src/api/server/` | `GET /server`; `serverJson` for the Servers API | built (`PUT /server`: T5) |
| `src/api/<group>/` | Other API groups | design (T1–T5, T7) |
| `src/state/` | Entity types, `Store`, ids, `Clock`, `createServer` | built |
| `src/events.ts` | Typed event bus | built |
| `src/pipeline/submit.ts` | `submitOutbound` | contract + stub (body: T1) |
| `src/control/` | Control registry, core endpoints, seed loader | built (more endpoints: tracks) |
| `src/render/` | Mustachio renderer | design (T3) |
| `src/webhooks/`, `src/inbound/` | Emitter, inbound parse and rules | design (T5) |
| `src/smtp/` | SMTP listener | design (T6) |
| `seeds/` | `empty`, `conformance` (parts under `seeds/conformance/`) | built (more parts: tracks) |
| `conformance/` | Runners, results, ratchet (`TESTING.md`) | built for postmark.js |

## Shared contracts

A track adds files and one import line. It never edits another track's lines (`docs/11` §5).
A change to a contract below goes through the integrator.

| Contract | Path | Shape |
| --- | --- | --- |
| API route | `src/http/routes.ts` | `defineRoute({ method, path: "/templates/:idOrAlias", auth: "server" \| "serverOrTest" \| "account", handler(ctx) })`. The handler returns the 200 body or throws `ApiError`/`Unsupported`. `ctx` has `store`, `events`, `clock`, `params`, `query`, `body`, `headers`, `auth`. |
| API group registration | `src/api/index.ts` | `import "./<group>/routes.ts";` |
| Errors | `src/errors.ts` | `apiError(code, { family?, status?, message?, params?, extra? })`; `errorBody(code, …)` for a batch item |
| Normalization | `src/http/normalize.ts` | `ctx.query.get/all/prefixed/pick(schema)`; codecs `queryBool`, `queryInt`, `queryDate`; `parseBody(schema, ctx.body)`; codecs `absent`, `intLike`, `objectOrEmptyArray`, `base64` |
| Responses | `src/http/respond.ts` | `paged(key, items, count, offset)`; `Unsupported` |
| Send pipeline | `src/pipeline/submit.ts` | `submitOutbound(runtime, { auth, channel, draft: OutboundDraft, request, bulkRequestId, templateId }): SubmitResult` |
| Event bus | `src/events.ts` | `events.on(name, listener)` → unsubscribe; `events.emit(name, payload)`. Names: `sent`, `delivered`, `bounced`, `opened`, `clicked`, `spamComplaint`, `subscriptionChange`, `inboundReceived`, `smtpApiError` |
| Store | `src/state/store.ts` | `store.state.<collection>`; `store.nextId(kind)`; `store.reset()`; `streamKey`, `suppressionKey` |
| Entities | `src/state/types.ts` | PascalCase fields are wire fields; camelCase fields are internal; dates are `Date` |
| Clock | `src/state/clock.ts` | `clock.now()`, `clock.schedule(delayMs, run)`, `clock.advance(ms)` |
| Control endpoint | `src/control/registry.ts` | `defineControl({ method, path: "/control/…", handler(ctx) })`; `controlInput(schema, ctx.body)`; throw `ControlError` for 400 |
| Control registration | `src/control/index.ts` | `import "./<topic>.ts";` |
| Seed part | `src/control/seed.ts` | `defineSeedPart("conformance", (runtime) => …)` in `seeds/conformance/<part>.ts`, plus one import line in `seeds/conformance.ts` |

## Deviations from real Postmark

Each one is a place where Postmark behavior is unknown. The mock fails loudly there instead of guessing (`AGENTS.md` rule 5).

| Case | postmock answer | Open question |
| --- | --- | --- |
| Unknown route | 404, plain text | `docs/02` §9 Q9 |
| `POSTMARK_API_TEST` on a route that does not accept it yet | 501, plain text | `docs/02` §9 Q8 |
| A response shape nobody captured (a track throws `Unsupported`) | 501, plain text | per route |
| A bug in postmock | 500, plain text with the stack | — |
| 401 `Message` text | the doc table text for ErrorCode 10 | `docs/02` §9 Q2 |

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
| `614` and `1226` appear under several families; `501`, `1406`, `1408` use several statuses. `apiError` throws until the caller names the family or status. | `docs/02` §4.4 |
