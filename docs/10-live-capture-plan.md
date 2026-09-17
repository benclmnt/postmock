# 10 — Live capture plan

Scope: one plan for every open question in `docs/01`–`docs/08`.
This page merges the questions, defines a safe capture setup, and designs a TypeScript capture harness.
No capture exists yet. This page calls no Postmark endpoint.

Marks: **DOC**, **SDK**, **LIB**, **CAPTURED**, **INFERRED** (`AGENTS.md` rule 6).
The setup and harness design are **INFERRED** unless a row cites a source.

Source keys used in the table:

| Key | Meaning |
| --- | --- |
| `01 Q1` | `docs/01-client-reachability.md` §6 "Open questions", row Q1 |
| `02 Q1` | `docs/02-transport-auth-errors.md` §9 "Open questions for a live capture", row Q1 |
| `03 Q1` | `docs/03-sending.md` §8 "Open questions for a live capture", row 1 |
| `04 Q1` | `docs/04-bounces-suppressions-streams.md` "Open questions for live capture", row Q1 |
| `05 Q1` | `docs/05-webhooks.md` §7 "Open questions for live capture", row Q1 |
| `06 Q1` | `docs/06-messages-stats-templates-server.md` §7 "Open questions for live capture", row Q1 |
| `07 Q1` | `docs/07-smtp-sandbox-limits.md` "Open questions for live capture", row Q1 |
| `08 Q2` | `docs/08-sdk-client-matrix.md` §6 "Open questions", item 2 (item 1 is closed) |

Section numbers inside `docs/01`–`08` can change. A pointer names the doc and the section title.

Impact levels:

| Level | Rule |
| --- | --- |
| P0 | The answer changes what an official SDK parses or raises: error class, fields parsed from `Message` text, success vs error status, required response keys and types (`docs/08` response parsing strictness, error mapping). |
| P1 | Server behavior any client can observe: state transitions, filters, retries, limits, error text that no SDK parses. |
| P2 | Cosmetic or rare: headers no SDK reads, inputs no official SDK sends. |

Setup keys (defined in §2):

| Key | Token | Postmark state touched |
| --- | --- | --- |
| G0 | none, or a deliberately invalid token | none |
| G1 | `POSTMARK_API_TEST` | none (no delivery; DOC `refs/api_overview.md:23`) |
| G2 | server token of the dedicated sandbox server (REST) | sandbox server only |
| G3 | G2 plus a public webhook receiver | sandbox server only |
| G4 | G2 token as SMTP credentials; swaks/openssl transcript | sandbox server only |

---

## 0. P0 list

| C-id | Question | Setup |
| --- | --- | --- |
| C2 | Status survey: does any reply use 201, 204, 400, 404 or 409? | all (reads every capture) |
| C7 | What does `POSTMARK_API_TEST` validate (signature, stream, suppression)? | G1 |
| C13 | 413 body: JSON envelope or proxy HTML? | G1 |
| C18 | Exact 406 `Message` wording on a single send to a suppressed address | G2 |
| C19 | Partial suppression (active `To`, suppressed `Bcc`): status, code, text, `MessageID`? | G2 |
| C22 | Opens/clicks `count=500&offset=10000`: 200, or 422/700? | G2 |
| C37 | Outbound message `Attachments`: name list or object list? | G2 |
| C40 | Batch error item keys | G2 |
| C41 | Bulk key `ID` or `Id`; status `Cancelled` or `Failed` | G2 |
| C42 | SDK-only paths: 200 or 404? | G2 |
| C49 | Is `CanActivate` ever absent on a Bounce payload? | G3 |
| C56 | SMTP send to a suppressed recipient: reject at `RCPT`/`DATA`, or `250` and drop? | G4 (DOC answers the category, §4.1 A4) |
| C60 | Unverified `From` over SMTP: reject, or accept + `SMTPApiError`? | G4 |
| C74 | SMTP host vs stream type mismatch: reject at AUTH, at DATA, or bounce? | G4 |

---

## 1. Merged question table

Columns:
- **Cost / risk**: `none`; `volume` = sends count toward monthly volume (DOC `refs/user-guide_sandbox-mode_server-sandbox-mode.md:6`); `supp` = changes the sandbox server suppression list only; `rate` = may reach the undocumented rate limit (DOC `refs/api_overview.md:37`); `long` = run of hours; `human` = a person sends mail or changes a setting.
- **Status**: `open`, or `answered` with a pointer to §4 (capture only confirms).

### 1.1 G0 — no token or invalid token

| C-id | Question | Sources | Impact | How to capture | Cost / risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Exact 401 `Message` for: no token header; unknown server token; valid-looking token in `X-Postmark-Account-Token` on `/email`. | 02 Q2; 03 Q17 | P1 — no SDK parses the 401 text; java needs a JSON body (`docs/08` error mapping) | `POST /email` three ways | none | open |
| C2 | Error response headers: `Content-Type` charset, `X-PM-ApiErrorCode` on 401, `Server`, `Date`, request id. Across all captures: does any reply use 201, 204, 400, 404 or 409? | 02 Q4; 03 Q17; 08 union section (emit) E2; 08 Q9 | **P0** (status survey) — dotnet, php, gem and java treat 201/204 as errors (`docs/08` error mapping). P2 (headers). | Same exchanges as C1; plus one 422 in G1. The status survey reads every capture's `response.status`. | none | open |
| C3 | Plain `http://api.postmarkapp.com/email`: redirect, refusal, or served? | 02 Q1 | P2 — every SDK default is https (`docs/02` hosts section) | `POST http://…/email`, invalid token | none | open |
| C4 | Does Postmark compress with `Accept-Encoding: gzip`? | 02 Q14 | P2 | 401 exchange with and without the header | none | open |
| C5 | Body and `Content-Type` of 404 for an unknown route. Does auth or routing run first? | 02 Q9 (part 1) | P2 | `GET /nope` with invalid token, then with test token (G1) | none | open |

### 1.2 G1 — `POSTMARK_API_TEST`

| C-id | Question | Sources | Impact | How to capture | Cost / risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| C6 | Success body: `Message` text, `MessageID` random or zero UUID, `SubmittedAt` shape and zone, `To` echo for named and multi-recipient `To`. Does `TrackLinks` change the body? | 02 Q7; 03 Q7, Q8, Q9 | P1 — dotnet needs `MessageID` as a GUID (`docs/08` response parsing strictness) | Minimal body; named `To`; two-address `To`; with `TrackLinks: HtmlOnly` | none | open |
| C7 | What does the test token validate: `From` signature, `MessageStream` (1235 text), suppression (406)? | 02 Q17 (1235), Q18; 03 Q7 | **P0** — gem and rails specs send with the test token (`docs/08` per-SDK commands); success vs error decides their result | Unregistered `From`; `MessageStream: "nope"`; `To: hardbounce@bounce-testing.postmarkapp.com` twice | none | open |
| C8 | Does the test token work on opens, clicks, suppressions dump/delete, `GET /server`? | 02 Q8; 06 Q6 | P1 — decides which later rows can move from G2 to G1 | Opens, clicks, suppressions dump and delete, plus `GET /server` | none (delete is a no-op without a server) | open |
| C9 | ErrorCode 300 `Message` texts: no `To`; `To: "-"`; no body parts; zero recipients; 51 recipients; `Subject` > 2000; `Tag` > 1000; metadata count/key/value/duplicate. | 02 Q17; 03 Q4 | P1 — SDKs raise by ErrorCode, not by this text | One `POST /email` per case | none | open |
| C10 | Malformed JSON: exact 402 text. Empty body: which code? | 02 Q16 | P2 | Two sends | none | open |
| C11 | Unknown body field; wrong type (`"TrackOpens":"yes"`); lowercase keys; invalid `TrackLinks` (300, 403, or 612?). | 02 Q12, Q13; 03 Q5, Q6 | P2 — official SDKs send typed PascalCase keys (`docs/08` request body serialization) | One send per case | none | open |
| C12 | Which header gives 415 (no `Content-Type`, `text/plain`, no `Accept`)? 415 body? | 02 Q5; 03 Q6 | P2 — postmark.js always sends both (`docs/02` request headers section) | Three sends | none | open |
| C13 | 413 body for a payload over 10 MB: JSON envelope or proxy HTML? | 02 Q10; 03 Q10 | **P0** — an HTML body changes what java and python raise (`docs/08` response parsing strictness) | One send with an 11 MB `TextBody` | none; one 11 MB upload, run once | open |
| C14 | Is the token value case-insensitive (`postmark_api_test`)? | 02 Q3 (value half) | P2 | One send | none | open; header-name half answered (§4.1 A5) |
| C15 | `.exe` attachment: 411 text. Missing `ContentType`: 300? | 03 Q11 | P1 | Two sends | none | open |
| C16 | Literal `null` body (java) on GET, DELETE, bodyless PUT. | 08 Q8 | P1 — java sends this body (`docs/08` open questions) | `GET /server` and `PUT /bounces/1/activate` with body `null` | none | open |
| C17 | Trailing slash: `/email/`, `/deliveryStats/`, `/bounces/?count=1&offset=0`. | 08 Q6; 04 §6 "postmark.js 5.1.0 wire map" | P1 | `/email/` in G1; the others in G2 | none | open; path case answered (§4.1 A6) |

### 1.3 G2 — sandbox server token, REST

Fake bounces need `bounce-testing.postmarkapp.com` (DOC `refs/user-guide_sandbox-mode_generate-fake-bounces.md:7-15`).
No ref says fake bounces fire on a **sandbox** server. Scenario `g2-probe` checks it first (§3.3).

| C-id | Question | Sources | Impact | How to capture | Cost / risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| C18 | Exact 406 wording on a single send: DOC `a recipient that has been` or SDK `recipient(s) that have been`? Trailing space? Separator? | 01 Q1; 03 Q1 | **P0** — postmark.js, gem and python parse `recipients` from this text. gem needs `. Inactive` after the list and splits it on `, ` (SDK `sdk/postmark-gem/lib/postmark/error.rb:81,89`). | Send to `hardbounce@bounce-testing.postmarkapp.com`; poll dump for the row; send again. Also record the postmark.js 5.1.0 error (§3.2 SDK mode). | volume (2), supp | open |
| C19 | `To` active + `Bcc` suppressed: HTTP status, ErrorCode, text ("Message OK, but will not deliver…"?), `MessageID` present? | 01 Q2; 03 Q2; 04 Q6 | **P0** — success vs error decides whether every SDK raises. python's regex does not match the `Message OK, but will not deliver to these inactive addresses` form (SDK `sdk/postmark-python/postmark/exceptions.py:81`). | `To: capture-active@blackhole.postmarkapp.com`, `Bcc:` the C18 address | volume (1) | open |
| C20 | Does dump filter on `emailAddress` (postmark.js), `EmailAddress` (DOC), `emailaddress`? | 02 Q6; 04 Q5 | P1 — a silently ignored key returns every row | Dump with each key spelling for the C18 address and for an absent address | none | answered for `emailAddress` (§4.1 A2); confirm |
| C21 | Delete for an address with no row: `Deleted` + `Message: null`, or `Failed` "Address not found."? | 04 Q10 | P1 — observable state result; no SDK raises on either value | Delete `never-suppressed@blackhole.postmarkapp.com` | none | answered (§4.1 A1); confirm |
| C22 | Opens and clicks with `tag=capture-tag&count=500&offset=10000`: 422/700 and text? Also `count=501`, `count=0`, no `count`, `offset=9500`. The clicks page states no 10 000 cap. | 02 Q15; 06 Q4 | **P0** — success vs error on a page that SDK paging reaches | Ten GETs; no data needed for validation | none | open; clicks cap not answered (§4.1 A9) |
| C23 | Dump `emailAddress` match: exact, substring, case-sensitive? | 04 Q5 | P1 — substring match can return another address's `HardBounce` row | Dump with a prefix of the C18 address and with upper case | none | open |
| C24 | Delete a `HardBounce` row: is the dump row gone at once? Does the bounce show `Inactive: false`, and does `CanActivate` change? Reverse: activate bounce → dump row gone? `emailFilter`: substring or exact, case-sensitive? | 04 Q8; 04 Q1 | P1 — state transitions (`docs/04` §3 "State machine") | Delete C18 row; `GET /bounces?emailFilter=` with the full address, a prefix, and upper case; repeat with a fresh hard bounce and `PUT /bounces/{id}/activate` | volume (1), supp | open |
| C25 | Unknown tag: `{"TotalCount": 0, "Opens": []}`? | 06 Q11 | P1 — client paging stops on `TotalCount` | `GET /messages/outbound/opens?tag=capture-none&count=500&offset=0`; same for clicks | none | open |
| C26 | Opens: one row per recipient (first open) or per open? `FirstOpen`, `ReadSeconds` present? | 06 Q5 | P1 — open counts | Send tracked HTML; read `/dump`; fetch the pixel URL twice with two User-Agents; list opens. A sandbox server may record no open (**INFERRED**). | volume (1) | open |
| C27 | `/email` from an unregistered `From`; from an unconfirmed signature: ErrorCode (400/401?), status, text. | 03 Q3; 06 Q8 | P1 — the SDK error class follows the ErrorCode, which is known to be an error | `From: capture@example.com`. Unconfirmed case only after human step H9. | volume (≤2) | open |
| C28 | Activate a bounce that is already `Inactive: false`: 200 or error? | 04 Q9 | P1 | Second `PUT /bounces/{id}/activate` from C24 | none | open |
| C29 | Does `SoftBounce` ever set `Inactive: true`? Which `SuppressionReason`? Can a `HardBounce` have `CanActivate: false`? | 04 Q13, Q14 | P1 | Send to `softbounce@`, `transient@`, `dnserror@bounce-testing.postmarkapp.com`; list bounces and dump | volume (3) | open |
| C30 | 401 text for the sandbox server token on an account endpoint (`GET /servers`). | 02 Q2 (last case) | P1 | One GET | none | open |
| C31 | Delete a `ManualSuppression` row (customer-created). Unsubscribe (`Recipient`) row, if one can be made. | 04 Q4 | P1 — state transition | `POST …/suppressions` then delete; `unsubscribe@bounce-testing…` then dump and delete | volume (1), supp | open |
| C32 | Unknown stream on suppressions: 422/1226 or 404, exact text and quotes. Unknown stream route 404 body. | 04 Q11; 02 Q9 (part 2) | P1 | `GET /message-streams/nope/suppressions/dump` | none | open |
| C33 | Default streams on a new server: `broadcast` or `broadcasts`? `UnsubscribeHandlingType` `None` or `none`? | 04 Q7 | P1 — python checks some enums with case (`docs/08` response parsing strictness) | `GET /message-streams` | none | `broadcast` answered (§4.1 A7); casing open |
| C34 | Does a hard bounce on `outbound` also block `broadcast`? | 04 Q3 | P1 — state model | Send C18 address on `broadcast` | volume (1) | open |
| C35 | Date shapes: `SubmittedAt`, `BouncedAt`, suppression `CreatedAt`, opens `ReceivedAt`; `Z` or Eastern offset; DST (`-04:00` in September). | 03 Q9; 04 Q12; 06 Q2 | P1 — dotnet, python, gem and java parse dates (`docs/08` response parsing strictness) | Read from C18, C24, C26 bodies; no extra call | none | open |
| C36 | Query key variants: `messageStream`, `MessageStream`, `clientName`, `client_name`; booleans `True`/`1`; `tag` case-sensitivity. | 06 Q1, Q10; 02 Q6; 08 Q7 | P1 — SDKs spell keys differently (`docs/08` query string building) | Opens GET variants; `GET /bounces?inactive=1` | none | open |
| C37 | Outbound message `Attachments`: name list or object list? | 06 Q3 | **P0** — typed SDKs fail on the wrong shape (`docs/08` response parsing strictness) | Send with a `.txt` attachment; `GET /messages/outbound?count=1&offset=0` | volume (1) | open |
| C38 | Tracking pixel URL and position; tracked link URL format. | 03 Q12 | P2 | `/dump` of the C26 message | none | open |
| C39 | Broadcast non-template send: `List-Unsubscribe` added? `{{{pm:unsubscribe}}}` replaced in raw `HtmlBody`? | 03 Q13 | P1 | Send on `broadcast` to blackhole; `/dump` | volume (1) | open |
| C40 | Batch: error item keys (`To`, `SubmittedAt`, `MessageID`?); 1235 per item or whole request. | 03 Q14; 08 Q3 | **P0** — python raises without the keys; dotnet raises on `MessageID: null` (`docs/08` open questions) | `POST /email/batch` with one good, one bad-stream item | volume (1) | open |
| C41 | Bulk POST key `ID` or `Id`; status `Cancelled` or `Failed`. `GET /email/bulk` `count` range, default, out-of-range error. | 03 Q15, Q20; 08 Q4 | **P0** — required key; python checks `BulkJobStatus` with case | `POST /email/bulk` to blackhole; expect ErrorCode 14 if not approved | volume (≤2) | open |
| C42 | SDK-only paths: `/stats/outbound/opens/readtimes`, `GET /messages/inbound/{id}/dump`, `/triggers/tags`. | 08 Q2 | **P0** — six SDKs send `readtimes`; 200 vs 404 decides success vs error | Three GETs | none | open; `verifyCustomTracking` not captured (§4.2) |
| C43 | Templates: `ContentIsValid` with errors; 1101 text for an unknown numeric `TemplateId`. | 06 Q7, Q9 | P1 | `POST /templates/validate` broken template; `POST /email/withTemplate` with `TemplateId: 1` | none | open |
| C65 | Custom REST `Headers` (`Content-Class`, `List-Unsubscribe`, `List-Unsubscribe-Post`): kept, rewritten or rejected? Which header names are reserved? | 03 Q18 | P1 — any client can send these headers | `POST /email` to blackhole with the three headers; then `GET /messages/outbound/{id}/dump` | volume (1) | open |
| C69 | Archived stream: does a send return 1235, 1236, or succeed? Do suppressions and bounces on the stream stay readable? | 04 Q15 | P1 — state model | Create stream `capture-archive`; send once; `POST /message-streams/capture-archive/archive`; send again; read bounces and dump; unarchive | volume (≤2) | open |
| C70 | Bulk message with some recipients suppressed: counted as released or failed? Active recipients delivered? | 03 Q21 | P1 | `POST /email/bulk` to one blackhole address and the C18 address; poll `GET /email/bulk/{id}`. Needs bulk approval (ErrorCode 14 otherwise). | volume (≤2) | open |
| C66 | Non-ASCII `Subject` (`【】`, `’`): accepted as is, length rule, echo in the Messages API. | 03 Q19 | P1 | `POST /email` to blackhole with a subject such as `【Test】 It’s here`; then `/details` and `/dump` | volume (1) | open |
| C77 | Template created without `Alias`: does the create and get response hold a generated alias, in which format? Does a standard template differ from a layout? | 06 Q15 | P1 — postmark-cli pull stops at a template without an alias | `POST /templates` for a standard and a layout template without `Alias`; `GET` each; delete both | none | open |

### 1.4 G3 — sandbox server plus public webhook receiver

| C-id | Question | Sources | Impact | How to capture | Cost / risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| C44 | Does `204` count as success for the **inbound** hook? For an outbound Bounce webhook? For webhook verification? | 05 Q6; 05 §3.6 conflict R2 | P1 — retry behavior. A literal "non-200 retries" reading means 10 duplicate deliveries to a receiver that answers 204. | Receiver path answers 204. Human sends one mail to the inbound address (H7). Fake hard bounce to a 204 Bounce webhook. Create a webhook with `Verify: true` against a 204 path. Count requests for 30 min. | volume (1), human | open |
| C45 | Inbound retry on 400 and 401 (inbound page: retry; overview: drop). | 05 §3.6 conflict R3 | P1 — retry behavior | Two inbound mails; receiver answers 400, then 401; count for 30 min | human | open |
| C46 | Inbound attachment keys (`ContentType`, `Name`, `ContentID`, `Disposition`) for mail from Outlook, Gmail and Apple Mail, with an inline image and a `text/calendar` part. Does a calendar part also land in `TextBody`? | 05 Q17 | P1 — receivers select parts by these keys | Human sends the same multipart mail from each client to the inbound address (H8) | human | open |
| C47 | Outbound webhook timeout. | 05 Q5 | P1 | Bounce webhook path that sleeps 5, 10, 15, 30 s (one fake bounce each) | volume (4) | open |
| C48 | Full outbound retry schedule past 51 min; trigger pause threshold. | 05 Q7, Q11 | P1 (schedule) / P2 (pause) | Bounce webhook path that always answers 500; log for 12 h | volume (1), long; may pause the Bounce trigger on the sandbox server only | open |
| C49 | Is `CanActivate` ever absent on a Bounce payload? Field set per type. | 05 Q14 | **P0** — python requires the key (`docs/05` open questions Q14) | Payloads from C24 and C29 bounces | none | open |
| C50 | Webhook request headers: `Content-Type`, `User-Agent`, `X-PM-Retries-Remaining` (first value), `X-PM-Webhook-Trace-Id`; also on inbound. | 05 Q1, Q2, Q8 | P2 — no SDK reads them | Headers from C44–C48 logs | none | open |
| C51 | Order of Bounce vs SubscriptionChange for one hard bounce. | 05 Q12 | P2 | Enable both triggers; one fake hard bounce | volume (1), supp | open |
| C52 | Verify probe bodies; `?verify=false` query vs `Verify` body field. | 05 Q13, Q16 | P2 | Create webhooks against the receiver both ways | none | open |
| C53 | Max webhooks per stream (1359); legacy `BounceHookUrl` vs `/webhooks` rows; URL userinfo vs `HttpAuth` precedence. | 05 Q9, Q10, Q3 | P2 | Create until 1359, then delete all; set legacy URL via `PUT /server`, list `/webhooks`; one webhook with both auth forms | none | open |
| C54 | Delivery payload key `ServerID` or `ServerId`; `Details` text on a sandbox server; time from accept to Delivery and Bounce webhook. | 05 Q15; 07 Q6 (webhook part); 03 Q16 | P2 | Delivery trigger on; one send to blackhole; timestamps from receiver log | volume (1) | open |
| C71 | Webhook URL `https://u:p@<receiver>/hook?token=x`: query string kept? userinfo sent as `Authorization: Basic` and stripped from the request line? | 05 Q18 | P1 — common receiver auth forms | Create a Delivery webhook with that URL; one send to blackhole; read receiver log | volume (1) | open |
| C72 | Thresholds behind `SlowCount` and `VerySlowCount` in `/webhooks/{Id}/statistics`. | 05 Q19 | P2 | Receiver paths that answer after 1, 5, 10 s; one send each; read statistics | volume (3) | open |
| C55 | `SMTPApiError` bounce webhook fields and dump layout. | 07 Q9 | P2 | After H10, send over SMTP to `smtpapierror@bounce-testing.postmarkapp.com` | volume (1), human | open |

### 1.5 G4 — SMTP transcripts (sandbox server token)

| C-id | Question | Sources | Impact | How to capture | Cost / risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| C56 | SMTP send to a suppressed recipient: reply code at `RCPT` and `DATA`? Accept and log `SMTPApiError`? | 07 SMTP replies section; 07 Q3 | **P0** — nodemailer raises on a non-2xx reply (LIB, `docs/07` SMTP replies section) | swaks `--tls` from the C18 suppressed address as `RCPT TO`; then `GET /bounces` | volume (1) | category answered (§4.1 A4); reply codes open |
| C57 | EHLO before and after STARTTLS: `AUTH` list order, `SIZE`, `PIPELINING`, `8BITMIME`, `SMTPUTF8`. | 07 Q2 | P1 — nodemailer picks the first listed AUTH method and uses STARTTLS only if listed | `openssl s_client -starttls smtp` session, EHLO twice, QUIT | none | open |
| C58 | AUTH failure reply codes: bad token; SMTP disabled on the server. | 07 Q3 (part) | P1 — clients see a send error either way | swaks with a wrong token; again after H11 turns SMTP off | none, human | open |
| C59 | Calendar invite MIME (`multipart/alternative` + `text/calendar; method=REQUEST` + `Content-Class`): Messages API record, `/dump`, is the calendar part unchanged, header rewrites (`X-PM-Message-Id`, `Return-Path`, `Message-ID`, `X-PM-*` removal). | 07 Q6, Q8, Q10 | P1 — calendar clients depend on the MIME shape | swaks `--data` with `harness/fixtures/invite.eml`; then `GET /messages/outbound?count=1&offset=0`, `/details`, `/dump` | volume (1) | open |
| C60 | Unverified `From` over SMTP: reject or accept + `SMTPApiError`? | 07 Q3 (part) | **P0** — success vs error at the SMTP layer; nodemailer raises on a reject | swaks `--from capture@example.com` | volume (1) | open |
| C61 | Throttling under 5 connections × 10 concurrent sends. | 07 Q7 | P1 — pooled SMTP clients (`docs/07` pool lifecycle) | 50 sends to blackhole, 5 parallel swaks loops; stop on first 4xx | volume (50), rate | open |
| C62 | Exact DATA `250` text; does it hold the MessageID? | 07 Q1 | P2 — nodemailer does not parse it | Any C59 transcript | none | open |
| C63 | Does `POSTMARK_API_TEST` work as SMTP username and password? | 07 Q4 | P2 | One AUTH attempt | none | open |
| C64 | Oversize message (SIZE or DATA reject?); 51 `RCPT TO`. | 07 Q3 (part), Q5 | P2 | One 11 MB DATA; one 51-recipient envelope to blackhole | volume (≤2) | open |
| C67 | SMTP idle timeout, the reply before an idle close, and any per-connection message cap. | 07 Q11 | P1 — nodemailer keeps pooled connections idle (`docs/07` pool lifecycle) | `openssl s_client -starttls smtp`, AUTH, then wait with a timer until the server closes | none | open |
| C73 | SMTP token auth: which stream gets the message when `X-PM-Message-Stream` names another stream? Reply code for a revoked token? | 07 Q13 | P1 | Human creates an SMTP token on `outbound` (H13); send with a broadcast stream header; human revokes it; retry AUTH | volume (1), human | open |
| C74 | Host vs stream type: transactional stream through `smtp-broadcasts`, broadcast stream through `smtp`: reject at AUTH, at DATA, or bounce? | 07 Q14 | **P0** — success vs error at the SMTP layer | One send per pairing to blackhole | volume (2) | open |
| C75 | DIGEST-MD5 AUTH with a server token and an SMTP token (realm, qop, `rspauth`). | 07 Q15 | P1 | `swaks --auth DIGEST-MD5`, only if C57 lists it | none | open |
| C76 | SMTP token management: endpoint paths, token type, response shape, per-stream limit (ErrorCode 1458). | 07 Q16 | P2 — no SDK calls it | Human records the web UI network calls during H13 (browser dev tools, HAR with cookies and tokens removed) | none, human | open |
| C68 | SMTP non-ASCII subject: encoded-word decoding, `SMTPUTF8`/`8BITMIME` in EHLO, MIME re-encoding in `/dump`. | 07 Q12 | P1 — non-ASCII subjects over SMTP | swaks with an RFC 2047 subject to blackhole; then `/dump` | volume (1) | open |

---

## 2. Capture setup

### 2.1 Safety rules

| # | Rule | Why |
| --- | --- | --- |
| R1 | Use one dedicated sandbox server. Never a server that an application uses. | An application server can hold real suppressions, webhooks and traffic. It is not a safe target. |
| R2 | The harness preflight calls `GET /server` and refuses to run unless `DeliveryType` is `Sandbox` and `Name` equals the configured capture name. | Sandbox never delivers (DOC `refs/user-guide_sandbox-mode_server-sandbox-mode.md:4`). Type is fixed at create (`:14`). |
| R3 | The harness refuses a token equal to any value in `CAPTURE_DENY_TOKENS_FILE` (one token per line) or to any `POSTMARK_*TOKEN*` value in its process env. | Guards a copy-paste of a production token. |
| R4 | Recipients: only `*@bounce-testing.postmarkapp.com`, `*@blackhole.postmarkapp.com`, and the sandbox server inbound address. The harness rejects any other `To`, `Cc`, `Bcc`, `RCPT TO`. | Black-hole domains (DOC `refs/user-guide_sandbox-mode_generate-fake-bounces.md:7`; `refs/api_bounce-api.md:168`). |
| R5 | Suppression writes go only to the sandbox server, only for addresses in R4. | No production suppression list is touched. |
| R6 | Never hold an account token in the harness. Account-level changes are human steps. | `AGENTS.md` rule 7; account tokens reach every server. |
| R7 | Serial requests, at least 1 s apart. Stop the group on the first 429 and keep that capture. | No rate number is documented (DOC `refs/api_overview.md:37`). |
| R8 | Every scenario prints its planned send count. The run needs `--confirm-sends N`. | Sandbox sends count toward monthly volume. |
| R9 | Clean up created objects (webhooks, templates, customer suppressions) at scenario end, and record the cleanup exchanges too. | Leaves the sandbox server reusable. |

Estimated volume for the full plan: under 170 messages (C61 is 50 of them).

### 2.2 Human steps

| Id | Human step | Needed by |
| --- | --- | --- |
| H1 | In the Postmark UI, create a new server `postmock-capture` with type **Sandbox**. Do not reuse an existing server. | G2, G3, G4 |
| H2 | Copy that server's API token into `.env.capture` at the repo root as `CAPTURE_SERVER_TOKEN`. Add `CAPTURE_SERVER_NAME=postmock-capture`. Add `.env.capture` to `.gitignore`. | G2–G4 |
| H3 | Pick a `From` address that the account already allows (confirmed signature or verified domain), preferably on a test domain. Put it in `.env.capture` as `CAPTURE_FROM`. | G2–G4 |
| H4 | Enable SMTP on the sandbox server's `outbound` stream settings. | G4 |
| H5 | Approve the send budget (§2.1 R8) and the account's monthly volume headroom. | G2–G4 |
| H6 | Install a tunnel (for example `cloudflared`) and start it in front of the local receiver port. Put the public URL in `.env.capture` as `CAPTURE_RECEIVER_URL`. | G3 |
| H7 | Set the sandbox server inbound hook URL to `<CAPTURE_RECEIVER_URL>/inbound/204?token=<random>` (UI or harness `PUT /server` with the sandbox token). Send one plain mail from a test mailbox to the sandbox server inbound address. Repeat for the 400 and 401 paths (C45). | C44, C45 |
| H8 | From test mailboxes in Outlook, Gmail and Apple Mail, send one multipart mail (inline image + `.ics` attachment) to the sandbox inbound address. | C46 |
| H9 | (optional) Create an unconfirmed sender signature for C27. This sends a confirmation mail to a human mailbox. | C27 |
| H10 | (optional) Run one `PUT /servers/{id}` with `EnableSmtpApiErrorHooks: true` using the account token, outside the harness (DOC `refs/webhooks_smtp-api-error.md:12-24`). | C55 |
| H11 | (optional) Turn SMTP off on the sandbox server for C58, then turn it on again. | C58 |
| H12 | Install `swaks` and `openssl`. | G4 |
| H13 | (optional) In the Postmark UI, create an SMTP token on the sandbox server's `outbound` stream; revoke it when C73 asks. Record the UI network calls for C76. | C73, C76 |

### 2.3 Webhook receiver

| Item | Rule |
| --- | --- |
| Process | `harness/src/receiver.ts`, a `node:http` server on a local port, behind the H6 tunnel. |
| Routing | Path `/<name>/<status>[/sleep/<seconds>]`. Example: `/inbound/204`, `/bounce/500`, `/bounce/200/sleep/15`. The path alone decides the reply. No state. |
| Logging | For each request, before the reply: arrival time (UTC, ms), remote address, method, raw request target, HTTP version, `rawHeaders` in wire order, raw body bytes, reply status, reply delay. |
| Output | `captures/<stamp>-receiver/<NNNN>-<name>/` (format §3.4). |
| Redaction | Query `token`, `Authorization`, URL userinfo (§3.5). |
| Reply body | Empty. |

### 2.4 SMTP transcripts

| Item | Rule |
| --- | --- |
| Tool | `swaks --server smtp.postmarkapp.com --port 587 --tls --auth PLAIN --auth-user <token> --auth-password <token>` with `--dump-mail` off. |
| EHLO check (C57) | `openssl s_client -starttls smtp -connect smtp.postmarkapp.com:587 -crlf`, with a scripted `EHLO` and `QUIT`. The pre-TLS EHLO comes from a swaks `--quit-after EHLO` run without `--tls`. |
| Record | swaks full transcript (`-S` lines with `<-`/`->` markers) with a UTC timestamp per line, exit code, total time. |
| Redaction | AUTH lines (§3.5). |
| MIME input | `harness/fixtures/invite.eml`: `multipart/alternative` with `text/plain`, `text/html` and `text/calendar; method=REQUEST`, plus a `Content-Class: urn:content-classes:calendarmessage` header. Built by hand. |

---

## 3. Capture harness (design only)

### 3.1 Layout

```
harness/
  package.json            # node 24, TypeScript, postmark@5.1.0 (the cloned postmark.js)
  src/
    cli.ts                # `capture <scenario...>`, `capture --group G2`, `conform <capture-dir>`
    config.ts             # reads .env.capture; one typed Config; fails on a missing key
    safety.ts             # §2.1 R2–R8 guards; runs before every scenario
    http.ts               # raw exchange over node:https (§3.2)
    sdk.ts                # postmark.js 5.1.0 call with a tee fetch (§3.2)
    smtp.ts               # spawns swaks/openssl, records transcript
    receiver.ts           # webhook receiver (§2.3)
    redact.ts             # one redaction function + post-write scan (§3.5)
    store.ts              # writes the capture directory (§3.4)
    normalize.ts          # volatile-field rules shared by conform (§3.6)
    conform.ts            # replay a capture against the mock and diff (§3.6)
    scenarios/
      <scenario>.ts       # one file per row in §3.3; exports { id, group, cIds, sends, steps }
  fixtures/
    invite.eml
captures/                 # git-ignored (`.gitignore`)
```

A scenario is data: an ordered list of steps.
Step kinds: `http` (raw request), `sdk` (one postmark.js method call), `poll` (repeat an `http` step until a JSON predicate holds, max N tries), `smtp` (swaks/openssl argv), `await-webhooks` (read receiver logs for a time window), `human` (print an instruction and wait for Enter).
`conform` replays the same steps. There is one step model for capture and replay.

### 3.2 Request paths

| Mode | Implementation | Why |
| --- | --- | --- |
| Raw | `node:https.request` with `Accept-Encoding: identity` unless the step sets it. Record `res.httpVersion`, `res.statusCode`, `res.statusMessage`, `res.rawHeaders` (wire order, duplicates kept), body bytes before any decode. | `fetch` hides header order, reason phrase and raw bytes. |
| SDK | `new ServerClient(token, { fetch: tee })` from `postmark@5.1.0`. `tee` records the same fields as Raw, then returns the response to the SDK. The step also records the SDK outcome: resolved value, or error `name`, `code`, `statusCode`, `message`, and `recipients` for `InactiveRecipientsError`. | Shows what the SDK makes of the reply (C18, C19, C22, C40, C41, C42). The `fetch` option exists in 5.1.0 (`sdk/postmark.js/src/client/HttpClient.ts:20-25` **SDK**). |
| SMTP | `smtp.ts` spawn; stdout/stderr line-stamped. | §2.4 |

Timing per exchange: `startedAt` (UTC ISO, ms), `dnsMs`, `connectMs`, `tlsMs`, `ttfbMs`, `totalMs` from socket events.

### 3.3 Scenarios

Run order: G0 → G1 → `g2-probe` → G2 → G4 → G3.
G4 and G3 reuse the C18 suppressed address, so they run after G2.

| Scenario | Group | C-ids | Sends | Notes |
| --- | --- | --- | --- | --- |
| `g0-auth` | G0 | C1, C2, C4 | 0 | |
| `g0-http-plain` | G0 | C3 | 0 | |
| `g0-routes` | G0/G1 | C5 | 0 | |
| `g1-send-ok` | G1 | C6, C14 | 0 | |
| `g1-send-validation` | G1 | C7, C9, C10, C11, C12, C15, C17 (`/email/`) | 0 | |
| `g1-send-oversize` | G1 | C13 | 0 | run once |
| `g1-reads` | G1 | C8, C16 | 0 | |
| `g2-probe` | G2 | — | 1 | Preflight (R2). One send to `hardbounce@bounce-testing…`; poll dump up to 60 s. If no row appears, stop G2 and report: C18/C19 then use a customer suppression (reason `ManualSuppression`), and C24, C28, C29, C49 need a new human decision. |
| `g2-inactive` | G2 | C18, C19, C34 | 3 | SDK mode for the sends; also record gem and python parsing of the `Message` offline from the capture |
| `g2-suppressions` | G2 | C20, C21, C23, C24, C28, C31, C32 | 3 | SDK mode for dump and delete |
| `g2-events-paging` | G2 | C22, C25, C36 | 0 | SDK mode for the opens and clicks GETs |
| `g2-opens` | G2 | C26, C35, C37, C38 | 2 | |
| `g2-sender` | G2 | C27, C30 | ≤2 | unconfirmed case only after H9 |
| `g2-bounce-types` | G2 | C29 | 3 | |
| `g2-archived-stream` | G2 | C69 | ≤2 | unarchive at end |
| `g2-bulk` | G2 | C41 (`GET /email/bulk`), C70 | ≤2 | skip send cases on ErrorCode 14 |
| `g2-streams` | G2 | C33, C39 | 1 | |
| `g2-headers-utf8` | G2 | C65, C66 | 1 | one send carries both |
| `g2-misc-p2` | G2 | C17 (`/deliveryStats/`, `/bounces/?`), C40, C41, C42, C43 | ≤3 | cleanup templates |
| `g4-smtp-ehlo-auth` | G4 | C57, C58, C62, C63 | 0 | C58 SMTP-off case after H11 |
| `g4-smtp-invite` | G4 | C59, C60 | 2 | |
| `g4-smtp-suppressed` | G4 | C56 | 1 | |
| `g4-smtp-idle-utf8` | G4 | C67, C68 | 1 | idle wait up to 15 min |
| `g4-smtp-streams` | G4 | C73, C74, C75, C76 | ≤3 | human H13 |
| `g4-smtp-limits` | G4 | C61, C64 | ≤52 | rate risk; last in G4 |
| `g3-receiver` | G3 | — | 0 | long-running process for all G3 rows |
| `g3-inbound` | G3 | C44 (inbound), C45, C50 | 0 | human H7; 30 min window per case |
| `g3-inbound-attachments` | G3 | C46 | 0 | human H8 |
| `g3-outbound` | G3 | C44 (bounce, verify), C49, C51, C52, C53, C54 | ≤4 | cleanup webhooks |
| `g3-timeout` | G3 | C47 | 4 | |
| `g3-webhook-url-auth` | G3 | C71, C72 | 4 | cleanup webhooks |
| `g3-smtpapierror` | G3 | C55 | 1 | after H10 |
| `g3-retry-12h` | G3 | C48 | 1 | long; run alone |

### 3.4 Output format

Directory: `captures/<UTC stamp>-<scenario>/`, stamp `YYYYMMDDTHHMMSSZ` from `new Date().toISOString()` (UTC, never local time).

| Path | Content |
| --- | --- |
| `meta.json` | scenario id, group, C-ids, harness git SHA, token kind (`none` / `invalid` / `test` / `sandbox`), sandbox server name, planned and actual send count, start and end UTC |
| `NN-<step>/request.json` | method, full URL, HTTP version, headers as ordered `[name, value]` pairs, body file name, step kind |
| `NN-<step>/request.body` | raw bytes sent (absent when no body) |
| `NN-<step>/response.status` | one line: `HTTP/1.1 422 Unprocessable Entity` |
| `NN-<step>/response.headers.json` | ordered `[name, value]` pairs exactly as received |
| `NN-<step>/response.body` | raw bytes as received (compressed bytes stay compressed) |
| `NN-<step>/timing.json` | §3.2 timing fields |
| `NN-<step>/sdk.json` | SDK mode only: call, arguments, outcome (§3.2) |
| `NN-<step>/smtp.transcript` | SMTP steps: timestamped `C:`/`S:` lines, exit code |
| `NNNN-<name>/` (receiver) | `request.json`, `request.body`, `reply.json` (status, delay), `timing.json` (arrival UTC) |
| `redaction.json` | list of redaction kinds applied, counts per file; no secret values |

Docs cite a capture as `captures/<stamp>-<scenario>/NN-<step>/response.body` with mark **CAPTURED**.

### 3.5 Redaction rule

One function, `redact(bytes, secrets)`, runs in memory before `store.ts` writes any file.

| Secret | Where it appears | Replacement |
| --- | --- | --- |
| `CAPTURE_SERVER_TOKEN` value | request header `X-Postmark-Server-Token`; `GET /server` body `ApiTokens`; swaks argv | `<REDACTED:server-token>` |
| SMTP AUTH | `AUTH PLAIN <base64>` line; `AUTH LOGIN` base64 user and password lines | `<REDACTED:smtp-auth>` |
| Receiver token | query `token=` in inbound URL, request target, `PUT /server` body `InboundHookUrl` | `token=<REDACTED:hook-token>` |
| Webhook auth | `Authorization` header; URL userinfo; `HttpAuth.Password` in bodies | `<REDACTED:http-auth>` |
| Inbound address hash | `InboundHash`, `InboundAddress`, `OriginalRecipient`, `ToFull[].Email` | `<REDACTED:inbound-hash>@inbound.postmarkapp.com` |
| Tunnel URL host | `CAPTURE_RECEIVER_URL` host in bodies and headers | `<REDACTED:receiver-host>` |

Not redacted: `POSTMARK_API_TEST`, the fixed invalid tokens of G0 (they are test inputs), black-hole addresses.
Redaction changes body length. `request.json` keeps the original `Content-Length` value. `conform` ignores `Content-Length`.
After write, `redact.ts` scans the directory for every secret value (raw, base64, URL-encoded). A hit deletes the directory and fails the run.

### 3.6 Conformance loop

Command: `conform captures/<stamp>-<scenario> --mock http://localhost:<port>`.

| Step | Action |
| --- | --- |
| 1 | Start from an empty mock seeded with one server named like the capture server and the mock's server token. No other seed: state comes from replaying the same steps (for example, the fake hard bounce send that creates the suppression). |
| 2 | Replay every `http`, `sdk`, `poll` step against the mock. Swap the host and the token. `human` and `await-webhooks` steps read the mock's emitted-webhook log instead. `smtp` steps run swaks against the mock SMTP port. |
| 3 | Store the mock replies in the same format under `captures/<stamp>-<scenario>/conform-<UTC stamp>/`. |
| 4 | Normalize both sides with `normalize.ts`. |
| 5 | Diff and write `conform-<UTC stamp>/report.json` plus a table on stdout. Exit non-zero on any difference. |

Diff rules (`normalize.ts`, one list):

| Part | Rule |
| --- | --- |
| Status line | exact (version, code, reason) |
| Headers | exact value for `Content-Type`, `X-PM-ApiErrorCode`, `Retry-After`, `Location`; presence only for `Date`; ignore hop and CDN headers (`Server`, `Via`, `CF-*`, `X-Request-Id`, `Connection`, `Content-Length`) |
| JSON body | parse both; compare key set, key order, and values. Masks: `MessageID`, `Id` UUIDs → UUID shape; `SubmittedAt`, `BouncedAt`, `CreatedAt`, `ReceivedAt`, `DeliveredAt`, `ChangedAt` → same format pattern; bounce `ID`, `ServerID` → integer. `Message` text stays exact, with addresses swapped by position. |
| Non-JSON body | byte-exact |
| `sdk.json` | exact error class, `code`, `statusCode`, `recipients` |
| SMTP transcript | server lines only; exact reply codes and enhanced codes; mask ids and timestamps in text |
| Webhooks | request method, headers (same rules), JSON body (same masks), attempt count, and gaps between attempts in virtual time |

Loop: capture once on Postmark → `conform` on the mock → fix the mock → `conform` again. Only step 1 of the loop reaches Postmark.
A doc claim changes to **CAPTURED** only when a capture file backs it.

---

## 4. No capture needed

### 4.1 Answered by an existing source

These rows keep a C-id. The capture there only confirms; it adds no cost to its scenario.

| Id | Question | Answer | Source |
| --- | --- | --- | --- |
| A1 | C21 / 04 Q10: delete for an address with no row | `Status: "Deleted"`, `Message: null`. The Python `"Address not found."` fixture is a unit stub. | DOC `refs/api_suppressions-api.md:253-261` (`not.suppressed@wildbit.com` → `Deleted`); SDK live integration test `sdk/postmark-dotnet/src/Postmark.Tests/ClientSuppressionTests.cs:57-68` (random address, asserts `Deleted` and null `Message`) |
| A2 | C20 / 02 Q6: does dump honor `emailAddress` (lower camel) | Yes. The live test filters by `emailAddress` and gets 1 row for the created address and 0 rows for `"invalid"`, so the key is not ignored. It does not show whether `EmailAddress` also works. | SDK `sdk/postmark.js/test/integration/Suppressions.test.ts:77-95` |
| A3 | Query key casing for `tag`, `count`, `offset` on opens and clicks | No casing question exists for these keys. postmark.js sends `tag`, `count`, `offset`; the doc spells them the same. Other keys stay open in C36. | DOC `refs/api_messages-api.md:630-633`, `:839-842`; `docs/06` §5 "Opens and clicks: wire detail" |
| A4 | C56: SMTP to a suppressed recipient, category | SMTP accepts every message and logs an `SMTPApiError` bounce; no SMTP-level reject is documented. Exact reply codes stay open in C56. | DOC `refs/user-guide_send-email-with-smtp.md:56`, `:87`; `refs/webhooks_smtp-api-error.md:6-8` |
| A5 | C14 / 02 Q3: header name case | Case-insensitive. Only the token **value** half stays open. | DOC `refs/api_overview.md:21`; HTTP header names are case-insensitive by RFC 9110 (**INFERRED**, not in `refs/`) |
| A6 | C17 / 08 Q6 / 04 §6 "postmark.js 5.1.0 wire map": path case | Postmark routes `/deliveryStats`, `/stats/outbound/opens/emailClients`, `/stats/outbound/clicks/browserFamilies`, which differ from the doc spelling. Trailing slash stays open in C17. | SDK live tests `sdk/postmark.js/test/integration/MessageStatistics.test.ts:17-18`, `MessagesOpens.test.ts:28-29`, `ClickStatistics.test.ts:18-19`; paths per `docs/08` path spelling disagreements |
| A7 | C33 / 04 Q7: default broadcast stream id | `broadcast`. `UnsubscribeHandlingType` casing stays open. | SDK live test `sdk/postmark.js/test/integration/Sending.test.ts:41` |
| A8 | 04 Q2: seed a `SpamComplaint` suppression through fake bounces | Not possible; a `SpamComplaint` request becomes a hard bounce. The mock needs its own seed path. This is a mock design choice, not a capture. | DOC `refs/user-guide_sandbox-mode_generate-fake-bounces.md:9`; `refs/support_article_1239-how-to-test-bounces.md:90` |
| A9 | C22 (clicks half): does the 10 000 cap apply to clicks | Not answered. The opens table states the cap; the clicks table does not. C22 captures both. | DOC `refs/api_messages-api.md:630-631` vs `:839-840` |

Evidence limit for A1, A2, A6, A7: each is an SDK live integration test. No run log shows the test passing today. A capture outranks it (`AGENTS.md` rule 6).

### 4.2 Not a capture (out of plan)

| Source | Question | Why no capture | Next action |
| --- | --- | --- | --- |
| 02 Q11 | 429 body and `Retry-After` | Triggering 429 is unsafe. | Ask Postmark support. Mock returns 429 only on a test command (`docs/02` retries and rate limits section). |
| 08 Q5; 04 Q16 | Data-removal `Status` type (**P0**: dotnet parses it as a number); error for an invalid `RequestedFor`; time from `Pending` to `Done`; what is erased | Needs an account token (R6) and support enablement (DOC `refs/api_data-removals-api.md:6`). | Ask Postmark support, or a human runs one call outside the harness. |
| 08 Q2 (part) | `PUT /domains/{id}/verifyCustomTracking` | Account token (R6). | A human runs one call outside the harness; record it in the capture format. |
| 05 Q4 | Webhook source IP ranges | Documentation page, not API behavior. | Fetch support article 800 into `refs/`. |
| 01 Q3 | Node versions whose `fetch` honors `NODE_USE_ENV_PROXY` | Local runtime check; no Postmark traffic. | Read Node release notes; confirm with a local `CONNECT` probe. |

### 4.3 Decisions, not captures

Decisions live in one table: `docs/09`, section "Decisions needed".
