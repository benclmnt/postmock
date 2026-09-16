# Control API

Status: built — `reset`, `seed`, `clock/advance`, `faults`, `messages`, `account/server-deletion`, `domains/:id/verify`, `senders/:id/verify`, `senders/:id/confirm`.
Design — the endpoints in `docs/09` §5 that tracks add: servers, suppressions, bounces, events, inbound, webhook attempts.

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
| `POST /control/servers` | `{token, streams}` | — | Create a server and its token | design |
| `POST /control/suppressions` | `{stream, email, reason, origin}` | — | A hard bounce, a complaint, an unsubscribe (`docs/04`) | design (T2) |
| `POST /control/bounces` | `{messageId, type}` | — | The recipient server bounces | design (T2) |
| `POST /control/events/open`, `/click` | `{messageId, recipient, link?}` | — | The recipient opens or clicks | design (T4) |
| `POST /control/events/delivery`, `/spam-complaint` | `{messageId, recipient}` | — | The recipient server accepts; the recipient marks spam | design (T4, T5) |
| `POST /control/inbound` | `{from, to, subject, text, html, attachments}` or raw MIME | — | Mail arrives at the inbound address | design (T5) |
| `GET /control/webhooks/attempts` | — | — | The webhook delivery log | design (T5) |

## Seeds

A seed is `seeds/<name>.ts` with a default export `(runtime) => void`.
It writes state that real Postmark could hold, directly into the store.

| Seed | Content |
| --- | --- |
| `empty` | No token, no server |
| `conformance` | Account token `postmock-account-token`; server ID 10 with token `postmock-server-token` and the streams `outbound`, `inbound`, `broadcast` (`seeds/conformance/00-core.ts`). Tracks add part files with fixed IDs from their range (`docs/11` §5). `70-account.ts`: server deletion enabled; domain 7000 `example.com` with a verified DKIM key; confirmed sender signature 7000 `sender@example.com`. |
