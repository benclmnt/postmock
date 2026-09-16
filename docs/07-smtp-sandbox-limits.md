# 07 — SMTP, sandbox mode, limits

Scope: what the mock must do for Postmark SMTP, sandbox testing, and send limits.
SMTP scope: both hosts, all ports, both credential types (server token + header, SMTP token), all four AUTH methods, `X-PM-*` headers, the SMTPApiError path.

## Citation keys

| Key | Meaning |
| --- | --- |
| `nodemailer@9.1.1 lib/<path>:LINE` | nodemailer 9.1.1, the common Node SMTP client. Third-party library code, marked **LIB**. |
| `sdk/`, `refs/` | This repo |

## Sources

| Source | Use |
| --- | --- |
| `refs/user-guide_send-email-with-smtp.md` | Postmark SMTP reference: hosts, ports, TLS, credentials, AUTH methods, `X-PM-*` headers, error model. **DOC** |
| SDKs in `sdk/` | No SDK sends over SMTP. `postmark-nodemailer` uses the HTTP transport `nodemailer-postmark-transport` (`sdk/postmark-nodemailer/example.js:5-13`). The gem mail handler calls the REST client (`sdk/postmark-gem/lib/postmark/handlers/mail.rb:10-27`). **SDK** |
| nodemailer 9.1.1 | Wire behavior of a typical Node SMTP client. **LIB** |
| SMTP reply text, EHLO lists, reject codes | Not documented. **INFERRED** until captured. |

---

## 1. SMTP

### 1.1 Typical Node SMTP client (nodemailer 9.1.1)

The mock must accept this client without a change to it. Other SMTP clients differ; §1.2 is the Postmark contract.

| Item | Client behavior | Mark |
| --- | --- | --- |
| TLS on port 587 | With `secure: false`, the client sends `STARTTLS` only when EHLO lists it. Without `requireTLS`, TLS is opportunistic. | **LIB** `nodemailer@9.1.1 lib/smtp-connection/index.js:1506-1508` |
| Certificate check | Node `tls.connect` rejects an untrusted cert by default. A mock cert needs a CA the client trusts (for example `NODE_EXTRA_CA_CERTS`). | **LIB** `nodemailer@9.1.1 lib/smtp-connection/index.js:1085-1087`; default **INFERRED** |
| AUTH mechanism | With no method set, the client picks the first mechanism it knows from the EHLO list, in its order PLAIN, LOGIN, CRAM-MD5, XOAUTH2. With none listed it sends PLAIN. | **LIB** `nodemailer@9.1.1 lib/smtp-connection/index.js:554-556`, `:1542-1559` |
| DIGEST-MD5 | Not known to the client. It picks PLAIN when PLAIN is listed. | **LIB** `nodemailer@9.1.1 lib/smtp-connection/index.js:1542-1559` |
| Pool defaults | `pool: true` gives `maxConnections: 5`, `maxMessages: 100`. Many transactions per session. | **LIB** `nodemailer@9.1.1 lib/smtp-pool/index.js:47-48` |
| `RCPT TO` | To, Cc and Bcc go in one transaction, so Postmark keeps them in one message. Split happens only across transactions. | split rule **DOC** `refs/user-guide_send-email-with-smtp.md:89-91` |
| `Bcc` header | Not written. The client strips `Bcc` from headers; BCC exists only in the envelope. | **LIB** `nodemailer@9.1.1 lib/mime-node/index.js:654-658` |
| `alternatives` | Each entry becomes a `multipart/alternative` sibling of `text/plain` and `text/html`. A `text/calendar; method=REQUEST` entry sits there with no attachment part. | **LIB** `nodemailer@9.1.1 lib/mail-composer/index.js:25-31` |
| `icalEvent` | Adds a `text/calendar; charset=utf-8; method=<METHOD>` alternative (default `PUBLISH`) and also an `application/ics` attachment `invite.ics`. | **LIB** `nodemailer@9.1.1 lib/mail-composer/index.js:167-177`, `:307-312` |
| Calendar header | Outlook-style invites often add `Content-Class: urn:content-classes:calendarmessage`. | **INFERRED** |
| Why SMTP for invites | REST `Attachments` produce an attachment part. Some senders use SMTP to place `text/calendar` as an alternative. | **INFERRED** |
| `Message-ID` | The client generates one. Without `X-PM-KeepID`, Postmark replaces it. | **LIB** `nodemailer@9.1.1 lib/mime-node/index.js:1004`, `lib/mailer/mail-message.js:169`; replace **DOC** `refs/user-guide_send-email-with-smtp.md:101` |
| DATA reply | `info.response` = raw DATA reply. `info.messageId` = the client header, not Postmark's MessageID. | **LIB** `nodemailer@9.1.1 lib/smtp-connection/index.js:766`, `lib/smtp-pool/index.js:236` |
| Non-2xx DATA reply | The send fails with `EMESSAGE`. | **LIB** `nodemailer@9.1.1 lib/smtp-connection/index.js:1911-1915` |
| Failure visible to the sender | Postmark accepts all messages and logs failures as bounces. The client sees a failure only on connection, AUTH, or protocol errors. | **DOC** `refs/user-guide_send-email-with-smtp.md:56`, `:87` |

### 1.2 Postmark SMTP endpoint

| Item | Value | Mark |
| --- | --- | --- |
| Transactional host | `smtp.postmarkapp.com` | **DOC** `refs/user-guide_send-email-with-smtp.md:28`, `:34` |
| Broadcast host | `smtp-broadcasts.postmarkapp.com` | **DOC** `refs/user-guide_send-email-with-smtp.md:28`, `:34` |
| Host vs stream type | Doc pairs each host with a stream type. Whether a transactional stream is rejected on the broadcast host (or the reverse) is not documented. | **DOC** `:28`; enforcement **INFERRED** — Q14 |
| Ports | 25, 2525, 587 | **DOC** `refs/user-guide_send-email-with-smtp.md:35`, `:109` |
| Port 465 (implicit TLS) | Not listed | **DOC** `refs/user-guide_send-email-with-smtp.md:35` (absence) |
| TLS | Optional. Offered through STARTTLS; recommended, not required. | **DOC** `refs/user-guide_send-email-with-smtp.md:36` |
| AUTH before TLS | Allowed. PLAIN and LOGIN work in clear text without TLS. | **DOC** `refs/user-guide_send-email-with-smtp.md:41-44` |
| AUTH mechanisms | CRAM-MD5, DIGEST-MD5, PLAIN, LOGIN | **DOC** `refs/user-guide_send-email-with-smtp.md:40-44` |
| DIGEST-MD5 status | Obsolete (RFC 6331). Few current clients use it. Still a documented surface; low priority (§4). | RFC status **INFERRED** |
| Credential: server token | Server API token is username and password. Stream from `X-PM-Message-Stream`; blank → `outbound`. Account token does not work. | **DOC** `refs/user-guide_send-email-with-smtp.md:16`, `:38`, `:95`, `:110` |
| Credential: SMTP token | Access Key = username, Secret Key = password. One token per message stream; no stream header needed. Secret shown once. | **DOC** `refs/user-guide_send-email-with-smtp.md:18-20`, `:39` |
| SMTP token + `X-PM-Message-Stream` | Behavior when the header names another stream is not documented. | **INFERRED** — Q13 |
| SMTP token management | Error codes 1450–1460 exist (for example 1457 no tokens on inbound streams, 1458 per-stream token limit, 1460 SMTP disabled). No endpoint doc is in `refs/`, and no SDK calls one. | **DOC** `refs/api_overview.md:183-194`; SDK absence **SDK** (grep of `sdk/`) — Q16 |
| SMTP on/off per server | Server settings; API field `SmtpApiActivated` | **DOC** `refs/user-guide_send-email-with-smtp.md:22`, `:95`; `refs/api_server-api.md:36` |
| IP allowlist | Protects API sends only. SMTP sends are not checked against the ranges. | **DOC** `refs/user-guide_ip-allowlisting.md:24`, `:135` |
| Endpoints | Several AWS regions; client routed to the closest | **DOC** `refs/user-guide_send-email-with-smtp.md:48` |
| Encoding | Quoted-Printable recommended; 8bit without BOM can break characters | **DOC** `refs/user-guide_send-email-with-smtp.md:115` |

### 1.3 `X-PM-*` headers on SMTP

| Header | Effect | Mark |
| --- | --- | --- |
| `X-PM-Message-Stream: <id>` | Selects the stream (server-token auth). Absent → default transactional stream `outbound`. Doc spells it `X-PM-MESSAGE-STREAM`; header names are case-insensitive. | **DOC** `refs/user-guide_send-email-with-smtp.md:16`, `:38`; case rule **INFERRED** |
| `X-PM-Tag: <tag>` | Sets `Tag`. One tag per message. Max 1000 characters. | **DOC** `refs/user-guide_send-email-with-smtp.md:57`, `:61-63` |
| `X-PM-Metadata-<key>: <value>` | Adds metadata key. Duplicate keys get an incrementing suffix on SMTP. Max 10 fields, key ≤ 20 chars, value ≤ 80 chars, values are strings. | **DOC** `refs/user-guide_send-email-with-smtp.md:78-83`; limits `refs/support_article_1125-custom-metadata-faq.md:70-75` |
| `X-PM-TrackOpens: true` | Adds pixel to HTML part. Absent or `false` → no tracking. Server `TrackOpens` overrides to always on. | **DOC** `refs/user-guide_tracking-opens_tracking-opens-per-email.md:8`, `:19-23` |
| `X-PM-TrackLinks: None\|HtmlAndText\|HtmlOnly\|TextOnly` | Overrides server `TrackLinks`. | **DOC** `refs/user-guide_tracking-links.md:50-61` |
| `X-PM-Bounce-Type: <type>` | Fake bounce; only to `bounce-testing.postmarkapp.com`. Works on SMTP. | **DOC** `refs/support_article_1239-how-to-test-bounces.md:40`, `:87` |
| `X-PM-KeepID: true` | Keep the original `Message-ID` header. Without it Postmark replaces every `Message-ID` on SMTP. Postmark `MessageID` (webhook JSON field) is separate and never changes. | **DOC** `refs/user-guide_send-email-with-smtp.md:99-105` |
| `X-PM-Metadata-*` visibility | Removed before delivery to recipient | **DOC** `refs/support_article_1125-custom-metadata-faq.md:49` |
| Other `X-PM-*` removal | Removed before delivery | **INFERRED** |

Headers the gem never forwards as custom `Headers` on REST (a hint of what Postmark treats as reserved): `return-path`, `x-pm-rcpt`, `from`, `reply-to`, `sender`, `received`, `date`, `content-type`, `cc`, `bcc`, `subject`, `tag`, `attachment`, `to`, `track-opens`, `track-links`, `postmark-template-alias`, `message-stream`. **SDK** `sdk/postmark-gem/lib/postmark/message_extensions/mail.rb:183-194`. SMTP rewrite of these is **INFERRED**.

### 1.4 Replies, MessageID, errors

| Item | Behavior | Mark |
| --- | --- | --- |
| DATA accepted | `250`. Doc names only the REST response as the MessageID source; SMTP clients get MessageID from webhooks and the Bounce/Messages API. Whether the 250 text holds it is Q1. | **DOC** `refs/user-guide_send-email-with-smtp.md:56`, `:99`; 250 text **INFERRED** |
| MessageID on REST | UUID string, e.g. `b7bc2f4a-e38e-4336-af7d-e6c392c2f817` | **DOC** `refs/user-guide_send-email-with-api_send-a-single-email.md:238-248` |
| Error model | SMTP accepts all messages. Message problems become an `SMTPApiError` bounce. Bounce description = short error; bounce raw source = long error, error code, and the SMTP message. | **DOC** `refs/user-guide_send-email-with-smtp.md:56`, `:87` |
| Suppressed recipient | SMTP accepts. Postmark records an "SMTP API Error" internal rejection instead of a REST 406. | **DOC** `refs/webhooks_smtp-api-error.md:6-8` |
| Disallowed attachment extension | SMTP API bounce (REST rejects) | **DOC** `refs/user-guide_send-email-with-api.md:176`, `:184` |
| SMTPApiError bounce type | `SMTPApiError`, TypeCode `100007` | **DOC** `refs/api_bounce-api.md:415` |
| Stats counters | `SMTPApiErrors` (overview), `SMTPApiError` (bounce stats) | **DOC** `refs/api_stats-api.md:45`, `:198` |
| Bad credentials, SMTP disabled | AUTH fails (reply code unknown) | fail **DOC** `refs/user-guide_send-email-with-smtp.md:93-95`; code **INFERRED** |
| Oversize, unverified sender | Doc model says accept + `SMTPApiError` bounce; oversize may still fail at `SIZE`/DATA | **INFERRED** — Q3 |

### 1.5 "SMTP API Error" webhook

| Item | Value | Mark |
| --- | --- | --- |
| Enable | `PUT /servers/{id}` with `EnableSmtpApiErrorHooks: true`, account token. API only, no UI. | **DOC** `refs/webhooks_smtp-api-error.md:10-25` |
| Delivery channel | Included with bounce webhooks | **DOC** `refs/api_server-api.md:53` |
| Payload | Bounce webhook shape (`RecordType: "Bounce"`) with `Type: "SMTPApiError"`, `TypeCode: 100007` | shape **DOC** `refs/webhooks_bounce-webhook.md:63-80`; SMTPApiError values **INFERRED** |
| Test | Create suppression, then send to that address over SMTP. Or send to `SMTPApiError@bounce-testing.postmarkapp.com`. | **DOC** `refs/webhooks_smtp-api-error.md:35-37`; `refs/support_article_1239-how-to-test-bounces.md:33` |

### 1.6 Pool lifecycle (nodemailer 9.1.1)

All cites below are **LIB**.

| Event | Client behavior | Cite |
| --- | --- | --- |
| Next message on an open connection | Sends `MAIL FROM` at once. No `RSET` between messages; no pool code calls `reset()`. | `nodemailer@9.1.1 lib/smtp-pool/pool-resource.js:208`; `reset()` defined at `lib/smtp-connection/index.js:784-790`, no caller in `lib/` |
| 100th message on a connection | Closes the socket (`end()`, FIN). No `QUIT`. Opens a new connection for the next message. | `nodemailer@9.1.1 lib/smtp-pool/pool-resource.js:224-228`; `lib/smtp-connection/index.js:482-493` |
| Non-2xx reply during a send | Fails that message. Closes the socket, no `QUIT`. Drops the connection from the pool. | `nodemailer@9.1.1 lib/smtp-pool/pool-resource.js:209-214`; `lib/smtp-connection/index.js:1911-1915` |
| Idle pooled connection | Stays open. Client inactivity timeout is 10 min (`socketTimeout` default); then `ETIMEDOUT` closes it. | `nodemailer@9.1.1 lib/smtp-connection/index.js:15`, `:1105`, `:1018-1020` |
| Server closes an idle connection | Client drops it from the pool. No queued message fails. | `nodemailer@9.1.1 lib/smtp-connection/index.js:967-997`; `lib/smtp-pool/index.js:322-367` |
| Server closes during a send | That message fails with `ECONNECTION` ("Connection closed unexpectedly"). | `nodemailer@9.1.1 lib/smtp-connection/index.js:991-992`; `lib/smtp-pool/index.js:346-349` |
| `421` at EHLO | `ECONNECTION` "Server terminates connection". | `nodemailer@9.1.1 lib/smtp-connection/index.js:1477-1480` |
| `QUIT` | Sent only by `verify()`. | `nodemailer@9.1.1 lib/smtp-pool/index.js:600`; `lib/smtp-connection/index.js:474-476` |

Postmark's idle timeout, its reply before an idle close, and its per-connection message limit are not documented. Q11.

### 1.7 Non-ASCII content

| Item | Value | Mark |
| --- | --- | --- |
| Header text | nodemailer writes a non-ASCII `Subject` or display name as RFC 2047 encoded-words (Q or B, max 52 chars), and encodes all words when any is non-ASCII. | **LIB** `nodemailer@9.1.1 lib/mime-node/index.js:1488-1512` |
| Body parts | ASCII text with short lines → `7bit`; else `quoted-printable` or `base64`. | **LIB** `nodemailer@9.1.1 lib/mime-node/index.js:508-531` |
| `SMTPUTF8`, `8BITMIME` | nodemailer uses them only when EHLO lists them and the envelope or body needs them. | **LIB** `nodemailer@9.1.1 lib/smtp-connection/index.js:1264-1275`, `:1512-1525` |
| Postmark advice | Quoted-Printable recommended; 8bit without BOM can break characters. | **DOC** `refs/user-guide_send-email-with-smtp.md:115` |

---

## 2. Sandbox mode

### 2.1 Sandbox server

| Behavior | Mark |
| --- | --- |
| Never delivers to a recipient; "black hole". | **DOC** `refs/user-guide_sandbox-mode_server-sandbox-mode.md:4` |
| Message appears as **Delivered** in UI, webhooks, API. | **DOC** `refs/user-guide_sandbox-mode_server-sandbox-mode.md:4` |
| Works for API and SMTP. | **DOC** `refs/user-guide_sandbox-mode_server-sandbox-mode.md:4` |
| Counts toward monthly volume. | **DOC** `refs/user-guide_sandbox-mode_server-sandbox-mode.md:6` |
| Set by `DeliveryType: "Sandbox"` at create; default `Live`; cannot change later. | **DOC** `refs/user-guide_sandbox-mode_server-sandbox-mode.md:18-20` |
| Invalid `DeliveryType` → ErrorCode 613. | **DOC** `refs/api_overview.md:108` |
| Delivery webhook fires with `Details` from the black hole. | **INFERRED** — Q6 |

### 2.2 `POSTMARK_API_TEST` token

| Behavior | Mark |
| --- | --- |
| Pass in `X-Postmark-Server-Token`. Validates data; no delivery. | **DOC** `refs/api_overview.md:23`; `refs/user-guide_send-email-with-api_send-a-single-email.md:79-81` |
| SDK integration suites send with it and expect a MessageID. | **SDK** `sdk/postmark-gem/spec/integration/mail_delivery_method_spec.rb:13`, `:52-53` |
| No activity, no webhooks. | **INFERRED** |
| Works as SMTP username/password. | Unknown — Q4 |

### 2.3 Fake bounces (`bounce-testing.postmarkapp.com`)

Trigger: send to `<Type>@bounce-testing.postmarkapp.com`, or to any address there with `X-PM-Bounce-Type: <Type>`. Case-insensitive; camel or snake case. **DOC** `refs/support_article_1239-how-to-test-bounces.md:40`, `:88`; `refs/user-guide_sandbox-mode_generate-fake-bounces.md:15`, `:26`.

| Local part / header value | Bounce `Type` | Extra effect | Mark |
| --- | --- | --- | --- |
| `HardBounce` (also the default for unknown local parts) | HardBounce (1) | Adds address to stream suppression list | **DOC** `refs/support_article_1239-how-to-test-bounces.md:4`, `:16`, `:89`; `refs/webhooks_bounce-webhook.md:55` |
| `Transient` | Transient (2) | — | **DOC** `:17`; code `refs/webhooks_bounce-webhook.md:59` |
| `SoftBounce` | SoftBounce (4096) | — | **DOC** `:26`; code `refs/webhooks_bounce-webhook.md:57` |
| `Unsubscribe`, `Subscribe`, `AutoResponder`, `AddressChange`, `DnsError`, `SpamNotification`, `OpenRelayTest`, `Unknown`, `VirusNotification`, `ChallengeVerification`, `BadEmailAddress`, `ManuallyDeactivated`, `Unconfirmed`, `Blocked`, `SMTPApiError`, `InboundError`, `DMARCPolicy`, `TemplateRenderingFailed` | Same name | — | **DOC** `refs/support_article_1239-how-to-test-bounces.md:18-36`; TypeCodes `refs/api_bounce-api.md` |
| `SpamComplaint` | Not supported; becomes HardBounce | — | **DOC** `refs/support_article_1239-how-to-test-bounces.md:90`; `refs/user-guide_sandbox-mode_generate-fake-bounces.md:9` |

| Common effect | Mark |
| --- | --- |
| Bounces immediately; appears in activity and stats. | **DOC** `refs/support_article_1239-how-to-test-bounces.md:4` |
| Posts the Bounce webhook if enabled. | **DOC** `refs/support_article_1239-how-to-test-bounces.md:4`; `refs/webhooks_bounce-webhook.md:128` |
| Not counted toward bounce limits; counts toward monthly volume. | **DOC** `refs/support_article_1239-how-to-test-bounces.md:91-92` |
| Works on live servers, not only sandbox servers. | **INFERRED** |

### 2.4 Spam complaints, opens, clicks

| Event | How to test | Mark |
| --- | --- | --- |
| Spam complaint | No black-hole trigger. Use the curl sample payload against your endpoint. | **DOC** `refs/support_article_1239-how-to-test-bounces.md:90`; payload `refs/webhooks_spam-complaint-webhook.md:52` |
| Open | Real open of a tracked HTML message, or curl sample payload. Sandbox has no real inbox, so no real opens. | curl **DOC** `refs/webhooks_open-tracking-webhook.md:77-79`; sandbox gap **INFERRED** |
| Click | Real click on a tracked link, or curl sample payload. | curl **DOC** `refs/webhooks_click-webhook.md:89-96`; sandbox gap **INFERRED** |
| Webhook create/edit | Postmark calls the endpoint for each enabled type and expects 200. | **DOC** `refs/webhooks_webhooks-overview.md:12` |

---

## 3. Limits

| Limit | Value | Mark |
| --- | --- | --- |
| `TextBody`, `HtmlBody` | 5 MB each | **DOC** `refs/support_article_1056-what-are-the-attachment-and-email-size-limits.md:6` |
| Message total incl. attachments | 10 MB, measured after base64 | **DOC** `refs/support_article_1056-what-are-the-attachment-and-email-size-limits.md:7`, `:10` |
| Same 10 MB on SMTP | Yes; advertised as EHLO `SIZE` | **INFERRED**; nodemailer reads `SIZE` **LIB** `nodemailer@9.1.1 lib/smtp-connection/index.js:1562-1565` |
| REST oversize | HTTP 413 | **DOC** `refs/api_overview.md:30` |
| Batch | 500 messages, 50 MB payload | **DOC** `refs/user-guide_send-email-with-api_batch-emails.md:6`; ErrorCode 410 `refs/api_overview.md:73` |
| Tag | 1000 characters, one per message | **DOC** `refs/user-guide_send-email-with-smtp.md:57` |
| Recipients | 50 per message, To + Cc + Bcc total | **DOC** `refs/user-guide_send-email-with-api_send-a-single-email.md:95` |
| Same 50 on SMTP `RCPT TO` | Doc error model suggests accept + `SMTPApiError` bounce; not confirmed | **INFERRED** from `refs/user-guide_send-email-with-smtp.md:56` — Q5 |
| Forbidden attachment extensions | vbs, exe, bin, bat, chm, com, cpl, crt, hlp, hta, inf, ins, isp, jse, lnk, mdb, pcd, pif, reg, scr, sct, shs, vbe, vba, wsf, wsh, wsl, msc, msi, msp, mst | **DOC** `refs/user-guide_send-email-with-api.md:176` |
| Metadata | 10 fields, key 20 chars, value 80 chars | **DOC** `refs/support_article_1125-custom-metadata-faq.md:71-74` |
| Inbound attachments | 35 MB total | **DOC** `refs/support_article_1056-what-are-the-attachment-and-email-size-limits.md:14` (rendered as "3\*\*\*\*5 MB") |
| Stored message size | 1 MB; larger is truncated in UI and Messages API | **DOC** `refs/support_article_1056-what-are-the-attachment-and-email-size-limits.md:20` |
| Attachments retrievable | No (UI raw source only) | **DOC** `refs/support_article_1056-what-are-the-attachment-and-email-size-limits.md:24` |
| Activity retention | 45 days default; 7–365 with add-on; aggregate stats forever | **DOC** `refs/support_article_how-long-are-inbound-and-outbound-messages-stored-in-activity.md:4` |
| Individual opens retention | 45 days | **DOC** `refs/user-guide_tracking-opens.md:41` |
| Bounce dump retention | 30 days | **DOC** `refs/api_bounce-api.md:141`; **SDK** `sdk/postmark-mcp/index.js:1199`, `:1214` |
| Rate limit (REST) | HTTP 429; no number published | **DOC** `refs/api_overview.md:37` |
| Rate limit / throttle (SMTP) | Not documented | Q7 |
| Pending-approval account | Recipients must share From domain (ErrorCode 412) | **DOC** `refs/api_overview.md:75` |
| SMTP tokens per stream | A limit exists (ErrorCode 1458); the number is not documented | **DOC** `refs/api_overview.md:192` — Q16 |

Open-tracking rules:

| Rule | Mark |
| --- | --- |
| HTML part required; text-only mail is never tracked. | **DOC** `refs/user-guide_tracking-opens.md:21` |
| Default off per message. | **DOC** `refs/user-guide_tracking-opens_tracking-opens-per-email.md:6`, `:19` |
| Server `TrackOpens` on forces every HTML message on. | **DOC** `refs/user-guide_tracking-opens_tracking-opens-per-email.md:8`; `refs/user-guide_tracking-opens_tracking-opens-per-message-stream.md` |
| Only first open stored in UI; webhook fires on each open when `PostFirstOpenOnly` is false. | **DOC** `refs/webhooks_open-tracking-webhook.md:6-8` |
| Link tracking default `None`; only `http`/`https` links rewritten. | **DOC** `refs/user-guide_tracking-links.md:40-42`, `:50` |

---

## 4. TypeScript SMTP server options (all **INFERRED**)

| Requirement | Library | Notes |
| --- | --- | --- |
| Listener on 25/2525/587, EHLO, STARTTLS, AUTH, SIZE, multi-message sessions | `smtp-server` (nodemailer project) | `onAuth` gets method, username, password. `size` option advertises `SIZE`. `authMethods` covers PLAIN/LOGIN/CRAM-MD5/XOAUTH2. `onData` reply controls the 250 text. Same project as nodemailer, so wire quirks match. |
| DIGEST-MD5 | No built-in support in `smtp-server` | Obsolete mechanism (RFC 6331). Low priority. Build a custom SASL handler (challenge with nonce/realm/qop, verify `response`, send `rspauth`) only after capture confirms Postmark lists it (Q2). Until then the mock does not advertise it and answers `504` to `AUTH DIGEST-MD5`; the doc records the gap. |
| Two hostnames | One listener set, SNI or DNS alias per name | The host decides the stream type (Q14). |
| STARTTLS certificate | `node:tls` with a cert from a test CA | Covers both hostnames. The client trusts the CA through env config (for example `NODE_EXTRA_CA_CERTS`). Client code stays unmodified. |
| MIME parse: headers, `X-PM-*`, text/html/calendar parts | `mailparser` (`simpleParser`) | Returns `headers` map, `text`, `html`, `attachments`. A `text/calendar` alternative may land in `attachments`; check. |
| Raw source for Messages API dump | Keep raw DATA buffer | No library needed. |
| MessageID | `node:crypto` `randomUUID()` | Matches REST UUID form. |
| DNS for `smtp.postmarkapp.com`, `smtp-broadcasts.postmarkapp.com` | Container `/etc/hosts` or Docker network alias | Needed when the client cannot set a host. |
| Not recommended | `smtp-tester`, MailHog, Mailpit | They do not model Postmark tokens, streams, suppression, or bounce types. |

---

## Mock must

Transport and hosts:

- [ ] Listen on ports 25, 2525 and 587 for both `smtp.postmarkapp.com` and `smtp-broadcasts.postmarkapp.com`. No port 465.
- [ ] Advertise `STARTTLS` but do not require it; serve a cert for both names from a test CA.
- [ ] Apply the stream-type rule per host after capture (Q14). Until captured, route by credential and header only.

Authentication:

- [ ] Advertise `AUTH PLAIN LOGIN CRAM-MD5` in the captured order (Q2). Accept AUTH before STARTTLS.
- [ ] Accept username = password = a server token; route by `X-PM-Message-Stream`, default `outbound`.
- [ ] Accept an SMTP token (Access Key / Secret Key); route to the token's stream. Apply the captured rule for a conflicting `X-PM-Message-Stream` (Q13).
- [ ] Reject an account token, an unknown token, a revoked SMTP token, and an SMTP-disabled server (`SmtpApiActivated: false`) at AUTH, with the captured code (Q3).
- [ ] DIGEST-MD5: low priority (§4). Until built, do not advertise it and answer `504` to `AUTH DIGEST-MD5`.
- [ ] Let tests create and revoke SMTP tokens per stream through the control API. Enforce ErrorCodes 1457 (inbound stream), 1458 (token limit), 1459 (archived stream), 1460 (SMTP disabled) if a token API is captured (Q16).
- [ ] Do not apply the server IP allowlist to SMTP.

Session:

- [ ] Accept many transactions per session (5 connections × 100 messages each) with no `RSET` between them. Accept `RSET` when a client sends it (§1.6).
- [ ] Treat a client close without `QUIT` as normal. Do not log it as an error (§1.6).
- [ ] Close an idle connection only after the captured idle timeout, with the captured reply (Q11). Until captured, do not close idle connections. A control-API fault can send `421` and close.
- [ ] Take `RCPT TO` from the envelope (BCC appears only there); keep one transaction as one message.

Content:

- [ ] Decode RFC 2047 encoded-words in headers and `quoted-printable`/`base64` parts to UTF-8 before storing `Subject`, text and HTML. Keep the raw DATA bytes unchanged (§1.7).
- [ ] Parse `multipart/alternative` and `multipart/mixed`, including `text/calendar; method=PUBLISH|REQUEST` alternatives and `application/ics` attachments; store the raw source.
- [ ] Keep `Content-Class` and the `text/calendar` part intact in stored raw source.
- [ ] Parse `X-PM-Message-Stream` (case-insensitive name), `X-PM-Tag` (≤ 1000 chars), `X-PM-Metadata-*` (suffix duplicates), `X-PM-TrackOpens`, `X-PM-TrackLinks`, `X-PM-Bounce-Type`, `X-PM-KeepID`; strip them from the stored "delivered" copy.
- [ ] Replace `Message-ID` unless `X-PM-KeepID: true`.

Results:

- [ ] Reply `250` to DATA and mint a UUID Postmark `MessageID` (whether the 250 text holds it: Q1).
- [ ] Accept every message after DATA. Turn each message-level error (suppressed recipient, forbidden attachment extension, invalid field, over 50 recipients if Q5 confirms) into an `SMTPApiError` (100007) bounce: short description, long error + code + raw message in the dump.
- [ ] Post `SMTPApiError` bounces to bounce webhooks only when `EnableSmtpApiErrorHooks` is true.
- [ ] Record SMTP sends in the same activity store as REST sends (Messages API, webhooks, stats `SMTPApiErrors`).

Sandbox and test addresses:

- [ ] Implement `bounce-testing.postmarkapp.com`: local part or `X-PM-Bounce-Type` → bounce type, case-insensitive, default HardBounce, SpamComplaint → HardBounce, HardBounce adds a suppression.
- [ ] Sandbox server (`DeliveryType: Sandbox`): accept, mark Delivered, fire delivery webhook, never forward.
- [ ] `POSTMARK_API_TEST` on REST: validate and return a MessageID, record nothing. On SMTP: follow Q4.

Limits:

- [ ] Advertise `SIZE` and enforce the 10 MB total with the captured behavior (Q3).
- [ ] Enforce the REST limits in §3 (body 5 MB, 50 recipients, batch 500 / 50 MB, tag, metadata, forbidden extensions).

## Open questions for live capture

Answered by `refs/user-guide_send-email-with-smtp.md` and removed: ports, TLS optionality, AUTH methods and AUTH before TLS, `Message-ID` rewrite and `X-PM-KeepID`, general SMTP error model.

| # | Question | Capture plan |
| --- | --- | --- |
| Q1 | Exact DATA `250` reply text. Does it hold the MessageID? | Sandbox server, `swaks --tls` to 587, log transcript |
| Q2 | EHLO before/after STARTTLS: order of `AUTH` list (does it include DIGEST-MD5?), `SIZE` value, `PIPELINING`, `8BITMIME`, `SMTPUTF8`. Same on `smtp-broadcasts`? | Same session on both hosts, record both EHLO replies |
| Q3 | Reply codes: bad token, account token, SMTP disabled (AUTH), oversize (SIZE/DATA reject or bounce?), unverified From signature (bounce?) | One session per case on a sandbox server |
| Q4 | Does `POSTMARK_API_TEST` work as SMTP username/password? | One AUTH attempt |
| Q5 | Over 50 `RCPT TO`: per-RCPT reject, or accept + `SMTPApiError` bounce? | 51 black-hole recipients |
| Q6 | Sandbox SMTP send: Messages API record, delivery webhook `Details`, stored raw source with `text/calendar` part | Send a nodemailer calendar invite; `GET /messages/outbound/{id}/details` and `/dump` |
| Q7 | SMTP throttling under 5 parallel connections × 10 concurrent sends | Short burst to black-hole addresses |
| Q8 | Other header rewrites on SMTP: `X-PM-Message-Id` added?, `Return-Path`, removal of every `X-PM-*` | Compare `/dump` with sent source |
| Q9 | `SMTPApiError` bounce webhook fields (`Description`, `Details`, `Inactive`, `CanActivate`) and dump layout | Send to `SMTPApiError@bounce-testing.postmarkapp.com` with hooks on |
| Q10 | Does a `text/calendar` alternative survive Postmark unchanged (no re-encoding, no pixel in HTML when tracking is off)? | Diff dump vs. source |
| Q11 | Idle and pool limits: after how long does Postmark close an idle authenticated connection, with which reply (`421`?)? Is there a per-connection message cap below 100? | Hold a session idle and log; send 101 messages on one connection to black-hole addresses |
| Q12 | Non-ASCII: does an encoded-word `Subject` (`【】`, `’`) come back decoded in the Messages API and webhooks? Is the delivered MIME re-encoded? | Send a nodemailer message with a non-ASCII subject; compare `/details` and `/dump` |
| Q13 | SMTP token auth: which stream gets the message when `X-PM-Message-Stream` names another stream (ignore, override, or `SMTPApiError`)? Reply code for a revoked token? | Create an SMTP token on `outbound`; send with a broadcast stream header; revoke and retry AUTH |
| Q14 | Host vs stream type: does a transactional stream (server token or SMTP token) send through `smtp-broadcasts`, and a broadcast stream through `smtp`? Reject at AUTH, at DATA, or bounce? | One send per pairing |
| Q15 | DIGEST-MD5: does AUTH succeed with a server token and an SMTP token (realm, qop, `rspauth`)? | `swaks --auth DIGEST-MD5` if Q2 lists it |
| Q16 | SMTP token management: endpoint paths, auth token type, response shape, per-stream token limit (ErrorCode 1458) | Inspect the web UI network calls on the sandbox account; no SDK calls it |
