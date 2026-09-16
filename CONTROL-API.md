# Control API

Status: built — `reset`, `seed`, `clock/advance`, `faults`, `messages`, `account/server-deletion`, `domains/:id/verify`, `senders/:id/verify`, `senders/:id/confirm`, `events/delivery`, `events/open`, `events/click`.
Built by T2 — bounces, spam complaints, unsubscribes.
Design — the endpoints in `docs/09` §5 that tracks add: servers, events, inbound, webhook attempts.

The control API is how a test drives postmock.
It listens on its own port (default `127.0.0.1:8025`), plain http, no auth.
A Postmark client never talks to it.

## Principle

**The control API never produces a state that a real Postmark client action or a real Postmark event could not produce.**
Each endpoint names its real-world equivalent: a new account, a hard bounce, an open, an outage.
A test that passes against postmock then tests code paths that real Postmark can reach.

## Shape

- `POST` for actions, `GET` for state. JSON in, JSON out.
- Every call is synchronous. It returns after the change is applied and every event listener finished (`await events.emit`). Work a listener puts on the clock (a webhook retry) runs on a later `clock/advance` or when real time reaches it.
- A bad request returns 400 and `{"error": "..."}`. There is no partial success.
- An unknown control route returns 404 and `{"error": "..."}`.
- A bug in postmock returns 500 and plain text with the stack.
- A track adds its endpoints in its own `src/control/endpoints/<topic>.ts` with `defineControl`. postmock loads the folder in filename order.

## Endpoints

| Call | Body / query | Response | Real-world equivalent | Status |
| --- | --- | --- | --- | --- |
| `POST /control/reset` | `{seed?}` | `{seed}` | A new account. Waits for running clock work, clears all state, pending clock tasks and the clock offset, then applies `seed` or the startup seed on the fresh clock. An unknown or failing seed restores state, clock offset and tasks, and answers 400. | built |
| `POST /control/seed` | `{name}` | `{seed}` | Account setup done before the test. Applies `seeds/<name>.ts` on top of the current state. A seed that clashes with the state (a token another server holds) changes nothing and answers 400. | built |
| `POST /control/clock/advance` | `{ms}` (integer ≥ 0) | `{now}` | Time passes. Runs every task due by the end, in due order, with the clock at each due time, and awaits it. Tasks scheduled during the advance run too when due (chained webhook retries). Concurrent advances run one after another. | built |
| `POST /control/faults` | `{match: {method, path}, times?, reply}` | `{faults}` | A Postmark outage or network loss. `path` is a route pattern matched like an API route. `times` defaults to 1. `reply` is `{errorCode, status?, family?, message?}`: the envelope `apiError` builds, so only a status and code pair from `docs/02` §4.4 is accepted. `family` is one of the table families; `message` is allowed only for a summary row. 429 has no documented body and cannot be faulted yet. Or `"timeout"` (no answer until the client gives up) or `"reset"` (socket destroyed). | built |
| `GET /control/messages` | `?to=&tag=&channel=rest\|smtp` | `{Messages: [{MessageID, ServerID, MessageStream, Channel, SubmittedAt, Request}]}` | The Activity page. `Request` is the request JSON (REST) or raw MIME (SMTP). `to` matches To, Cc or Bcc without case. | built |
| `POST /control/account/server-deletion` | `{enabled}` | `{serverDeletionEnabled}` | Support enables or disables server deletion through the API. Off: `DELETE /servers/{id}` answers ErrorCode 604. | built (T7) |
| `POST /control/domains/:id/verify` | `{dkim?: true, returnPath?: true}` | the domain, as `GET /domains/{id}` | Postmark finds the DNS records. `dkim`: the pending key becomes the active key; an earlier key becomes the revoked key. `returnPath`: `ReturnPathDomainVerified` becomes true. 400 when no key is pending or no Return-Path is set. The `verifyDkim` and `verifyReturnPath` API calls report this state. | built (T7) |
| `POST /control/senders/:id/verify` | `{dkim?: true, returnPath?: true}` | the signature, as `GET /senders/{id}` | The same for a sender signature | built (T7) |
| `POST /control/senders/:id/confirm` | — | the signature | The recipient clicks the confirmation link. 400 when already confirmed. | built (T7) |
| `POST /control/smtp/tokens` | `{serverId, messageStream}` | `{AccessKey, SecretKey, ServerID, MessageStream}` | A user creates an SMTP token for a stream in the UI. Refused (400) for an inbound or archived stream and a server with SMTP off, as ErrorCodes 1457, 1459, 1460. | built (T6) |
| `DELETE /control/smtp/tokens/:accessKey` | — | `{AccessKey}` | A user revokes the token; the next AUTH or transaction on an open connection gets 535. | built (T6) |
| `POST /control/smtp/faults` | `{stage: connect\|mail\|rcpt\|data, times?, reply: {code, message}}` | `{faults}` | A Postmark SMTP outage: the reply to the client's next command at that stage. `code` is 400–599; 421 also closes the connection. It cannot send an unprompted idle close. | built (T6) |
| `GET /control/bulk/:id` | — | the bulk status object plus `Unsupported` | The Activity view of a bulk request. `Unsupported` is null, or why processing stopped on behavior postmock does not know (the request then never completes). 400 for an unknown request. | built (T3) |
| `POST /control/bulk/:id/cancel` | — | the bulk status object | Postmark cancels a bulk request. Messages not yet released stay unsent. 400 for an unknown or finished request. | built (T3) |
| `POST /control/servers` | `{token, streams}` | — | Create a server and its token | design |
| `POST /control/bounces` | `{messageId, recipient, type, details?, dump?}` | `{ID}` | The recipient server bounces a delivered message. `type` is a type a mail server reports whose effect is known: `HardBounce`, `Transient`, `Subscribe`, `AutoResponder`, `AddressChange`, `DnsError`, `SpamNotification`, `OpenRelayTest`, `Unknown`, `SoftBounce`, `VirusNotification`, `ChallengeVerification`. `HardBounce` adds a `HardBounce`/`Recipient` suppression on the message stream (`docs/04` §3.2 T1). Answers 400 for: a sandboxed or queued message; an address that is not a recipient; an address the send skipped as suppressed; a message whose stream was purged since the send; a bounce after a bounce or complaint other than `Transient` for one message and recipient; a bounce whose effect over an existing suppression is not captured. | built (T2) |
| `POST /control/events/spam-complaint` | `{messageId, recipient, dump?}` | `{ID}` | The recipient marks the message as spam: a `SpamComplaint` bounce that cannot be reactivated, and a `SpamComplaint`/`Recipient` suppression (`docs/04` §3.2 T3). The same 400 rules apply. | built (T2) |
| `POST /control/events/unsubscribe` | `{messageId, recipient}` | `{suppressed}` | The recipient uses Postmark's unsubscribe link. Only on a Broadcasts stream with `UnsubscribeHandlingType: Postmark`; adds a `ManualSuppression`/`Recipient` suppression (`docs/04` §3.2 T5). `suppressed: false` when the address is already unsubscribed; 400 over another suppression. | built (T2) |
| `POST /control/events/delivery` | `{messageId, recipient, details?}` | `{MessageID, Recipient, ReceivedAt}` | The recipient server accepts the message. Adds the `Delivered` message event and fires `delivered`. 400 for an unknown, sandboxed or queued message, an address the message did not go to or the send skipped as suppressed, a recipient it bounced for (hard, soft, blocked and similar types), or a second delivery. `details` defaults to `smtp;250 2.0.0 OK`. | built (T4) |
| `POST /control/events/open` | `{messageId, recipient, userAgent?, client?, os?, platform?, geo?, readSeconds?}` | `{MessageID, Recipient, ReceivedAt, FirstOpen}` | The recipient opens the message. Fires `opened` each time; the Messages API keeps the first open per recipient. `client` and `os` are `{name, company, family}`; `platform` is `WebMail`, `Desktop`, `Mobile` or `Unknown`; `geo` has `countryISOCode, country, regionISOCode, region, city, zip, coords, ip`. Postmark derives these from the user agent; the test gives them. Same 400 cases as delivery, plus no delivery to that recipient yet, a message without `TrackOpens`, or an empty `geo`. | built (T4) |
| `POST /control/events/click` | `{messageId, recipient, link, clickLocation, userAgent?, client?, os?, platform?, geo?}` | `{MessageID, Recipient, ReceivedAt}` | The recipient clicks a tracked link. `clickLocation` is `HTML` or `Text`. Fires `clicked` each time; the Messages API keeps one click per recipient and link. 400 as for an open, or when `link` is not a tracked http(s) link of that body under the message's `TrackLinks`. | built (T4) |
| `POST /control/inbound` | `{from, to, subject, text, html, attachments}` or raw MIME | — | Mail arrives at the inbound address | design (T5) |
| `GET /control/webhooks/attempts` | — | — | The webhook delivery log | design (T5) |

## Seeds

A seed is `seeds/<name>.ts` with a default export `(runtime) => void`.
It writes state that real Postmark could hold, directly into the store.

| Seed | Content |
| --- | --- |
| `empty` | No token, no server |
| `conformance` | Account token `postmock-account-token`; server ID 10 with token `postmock-server-token` and the streams `outbound`, `inbound`, `broadcast` (`seeds/conformance/00-core.ts`). Tracks add part files with fixed IDs from their range (`docs/11` §5). `70-account.ts`: server deletion enabled; domain 7000 `example.com` with a verified DKIM key; confirmed sender signature 7000 `sender@example.com`. |
| `conformance`, bounces part | Server 10 has bounce 2001 (`HardBounce`, inactive, with a `HardBounce` suppression for `hardbounce@example.com` on `outbound`) and bounce 2002 (`SoftBounce`, active), both with a dump and a stored message (`seeds/conformance/20-bounces.ts`). |
| `conformance`, messages part | Read server 4000 `postmock read history`, token `postmock-read-server-token` (`seeds/lib/read-server.ts`): 46 outbound messages over 60 days (40 in the last 25 days, some tagged `test_tag`), deliveries, bounces 4000–4003 (a hard bounce that suppresses `reader-4@example.com` on `outbound`, soft, transient, and a later SMTP API error to the suppressed address), opens, clicks, and 5 inbound messages. Server 10 gets one processed inbound message (`seeds/conformance/40-messages.ts`). |
