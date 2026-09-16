# Control API

Status: built — `reset`, `seed`, `clock/advance`, `faults`, `messages`.
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
- Every call is synchronous. It returns after the change is applied and its events are emitted.
- A bad request returns 400 and `{"error": "..."}`. There is no partial success.
- An unknown control route returns 404 and `{"error": "..."}`.
- A bug in postmock returns 500 and plain text with the stack.
- A track adds its endpoints in `src/control/<topic>.ts` with `defineControl`, and one import line in `src/control/index.ts`.

## Endpoints

| Call | Body / query | Response | Real-world equivalent | Status |
| --- | --- | --- | --- | --- |
| `POST /control/reset` | `{seed?}` | `{seed}` | A new account. Clears all state, pending clock tasks and the clock offset, then applies `seed` or the startup seed. An unknown seed changes nothing. | built |
| `POST /control/seed` | `{name}` | `{seed}` | Account setup done before the test. Applies `seeds/<name>.ts` on top of the current state. | built |
| `POST /control/clock/advance` | `{ms}` (integer ≥ 0) | `{now}` | Time passes. Runs every scheduled task now due, in due order (webhook retries, bulk progress). | built |
| `POST /control/faults` | `{match: {method, path}, times?, reply}` | `{faults}` | A Postmark outage or network loss. `path` is a route pattern matched like an API route. `times` defaults to 1. `reply` is `{status, errorCode}` (the envelope for that code), `"timeout"` (no answer until the client gives up) or `"reset"` (socket destroyed). | built |
| `GET /control/messages` | `?to=&tag=&channel=rest\|smtp` | `{Messages: [{MessageID, ServerID, MessageStream, Channel, SubmittedAt, Request}]}` | The Activity page. `Request` is the request JSON (REST) or raw MIME (SMTP). `to` matches To, Cc or Bcc without case. | built |
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
| `conformance` | Account token `postmock-account-token`; one server with token `postmock-server-token` and the streams `outbound`, `inbound`, `broadcast` (`seeds/conformance/core.ts`). Tracks add parts. |
