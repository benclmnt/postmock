# 04 — Bounces, suppressions, message streams

Scope: Bounce API, Suppressions API, the state that links them to `/email`,
Message Streams API, Data Removals API.

Marks: DOC, SDK, LIB, CAPTURED, INFERRED (`AGENTS.md` rule 6).
Short paths: `refs/...` is DOC; `postmark.js/...`, `postmark-python/...` and other SDK repo names are under `sdk/` and are SDK.
`postmark.js` is v5.1.0 (`sdk/postmark.js/package.json:12`).

## 0. Surface

| API | Calls | Token | Section |
| --- | --- | --- | --- |
| Bounce API | `GET /deliverystats`, `GET /bounces`, `GET /bounces/{id}`, `GET /bounces/{id}/dump`, `PUT /bounces/{id}/activate` | server | §1 |
| Suppressions API | dump, create, delete per stream | server | §2 |
| Send-side suppression check | `POST /email` and the other send paths → 406 | server | §3.3; `docs/03` §3.2 |
| Message Streams API | list, get, edit, create, archive, unarchive | server | §4 |
| Data Removals API | create, get status | account | §5 |

## 1. Bounce API

All calls need header `X-Postmark-Server-Token` — `refs/api_bounce-api.md:17` DOC.
Bounces are kept for the retention period, 45 days by default — `refs/api_bounce-api.md:4` DOC.
The OpenAPI file lists every error as HTTP 422 with `{ErrorCode, Message}` — `refs/openapi/server.yml:885-889,239-245` DOC.

### 1.1 Endpoints

| Method | Path | Request | 200 response | Source |
| --- | --- | --- | --- | --- |
| GET | `/deliverystats` | none | `DeliveryStats` | `refs/api_bounce-api.md:10-79` DOC; `refs/openapi/server.yml:946-966` DOC |
| GET | `/bounces` | query (§1.2) | `{TotalCount, Bounces: Bounce[]}` | `refs/api_bounce-api.md:86-197` DOC; `refs/openapi/server.yml:967-1031` DOC |
| GET | `/bounces/{bounceid}` | path int64 | `Bounce` (with `Content`) | `refs/api_bounce-api.md:204-271` DOC; `refs/openapi/server.yml:1032-1058` DOC |
| GET | `/bounces/{bounceid}/dump` | path int64 | `{Body: string}`; `""` if no dump | `refs/api_bounce-api.md:277-310` DOC |
| PUT | `/bounces/{bounceid}/activate` | empty body | `{Message: "OK", Bounce}` | `refs/api_bounce-api.md:316-391` DOC; `refs/openapi/server.yml:1085-1111` DOC |

### 1.2 `GET /bounces` query parameters

| Param | Required | Rule | Source |
| --- | --- | --- | --- |
| `count` | yes | max 500; `count + offset` ≤ 10,000 | `refs/api_bounce-api.md:110` DOC; `refs/openapi/server.yml:979-984` DOC |
| `offset` | yes | `count + offset` ≤ 10,000 | `refs/api_bounce-api.md:111` DOC |
| `type` | no | one bounce `Type` string (§1.4) | `refs/api_bounce-api.md:112` DOC |
| `inactive` | no | `true`/`false`; absent = both | `refs/api_bounce-api.md:113` DOC |
| `emailFilter` | no | partial match (substring), not equality | `refs/api_bounce-api.md:114` DOC ("Filter by email address"); `postmark-python/postmark/models/bounces/manager.py:54` SDK ("Partial email address"); case rule unknown (Q1) |
| `tag` | no | tag | `refs/api_bounce-api.md:115` DOC |
| `messageID` | no | message id | `refs/api_bounce-api.md:116` DOC |
| `fromdate` | no | inclusive, Eastern Time, `YYYY-MM-DDTHH:MM:SS` | `refs/api_bounce-api.md:117` DOC |
| `todate` | no | inclusive, Eastern Time | `refs/api_bounce-api.md:118` DOC |
| `messagestream` | no | absent = `outbound` | `refs/api_bounce-api.md:119` DOC |

Validation failures return ErrorCode 1000 (negative, > 500, count+offset, illegal type) — `refs/api_overview.md:116` DOC.
postmark.js expects `ApiInputError` for `count: -1` — `postmark.js/test/integration/Bounce.test.ts:24-28` SDK.

Doc disagreements:

| Topic | Source A | Source B |
| --- | --- | --- |
| `messagestream` param | present, `refs/api_bounce-api.md:119` DOC | absent, `refs/openapi/server.yml:973-1022` DOC |
| `fromdate`/`todate` format | date-time ET, `refs/api_bounce-api.md:117-118` DOC | `format: date`, `refs/openapi/server.yml:1013-1022` DOC |
| `type` enum | `ChallengeVerification`, `refs/api_bounce-api.md:409` DOC | `'MailFrontier Matador.'` (doc bug), `refs/openapi/server.yml:994-995` DOC |

### 1.3 `Bounce` object

| Field | Type | Note | Source |
| --- | --- | --- | --- |
| `RecordType` | string | `"Bounce"`; list items only in doc example | `refs/api_bounce-api.md:157` DOC; `postmark.js/src/client/models/bounces/Bounce.ts:2` SDK |
| `ID` | integer | OpenAPI says string | `refs/api_bounce-api.md:128` DOC; `refs/openapi/server.yml:326-327` DOC; `Bounce.ts:3` SDK (number) |
| `Type` | string | §1.4 | `refs/api_bounce-api.md:129` DOC |
| `TypeCode` | integer | §1.4 | `refs/api_bounce-api.md:130` DOC |
| `Name` | string | human name, e.g. `"Hard bounce"` | `refs/api_bounce-api.md:131,161` DOC |
| `Tag` | string | optional | `Bounce.ts:7` SDK |
| `MessageID` | string | | `refs/api_bounce-api.md:133` DOC |
| `ServerID` | integer | table says string; example is integer | `refs/api_bounce-api.md:134,164` DOC; `Bounce.ts:9` SDK |
| `MessageStream` | string | | `refs/api_bounce-api.md:135` DOC |
| `Description` | string | canned per type | `refs/api_bounce-api.md:166` DOC; "canned" INFERRED |
| `Details` | string | remote server text | `refs/api_bounce-api.md:167,187` DOC |
| `Email` | string | | `refs/api_bounce-api.md:138` DOC |
| `From` | string | absent for spam complaints | `refs/api_bounce-api.md:139` DOC |
| `BouncedAt` | string | list example `Z`; single example `-05:00` | `refs/api_bounce-api.md:170,264` DOC |
| `DumpAvailable` | boolean | no dump after 30 days | `refs/api_bounce-api.md:141` DOC |
| `Inactive` | boolean | this bounce deactivated the address | `refs/api_bounce-api.md:142` DOC |
| `CanActivate` | boolean | address can be reactivated | `refs/api_bounce-api.md:143` DOC |
| `Subject` | string | | `refs/api_bounce-api.md:144` DOC |
| `Content` | string | single bounce + activate only | `refs/api_bounce-api.md:243,269` DOC; `Bounce.ts:19` SDK (optional) |

`DeliveryStats`: `{InactiveMails: int, Bounces: [{Name, Count, Type?}]}`.
The first element is `{"Name": "All", Count}` with no `Type` — `refs/api_bounce-api.md:41-47` DOC; `postmark.js/src/client/models/bounces/Bounce.ts:87-96` SDK.

### 1.4 Bounce types

Source for every row: `refs/api_bounce-api.md:395-418` DOC; `postmark.js/src/client/models/bounces/Bounce.ts:23-71` SDK (same set and codes).
"Deactivates" column: see §1.5 for evidence.

| Type | TypeCode | Name | Deactivates address |
| --- | --- | --- | --- |
| HardBounce | 1 | Hard bounce | yes (DOC) |
| Transient | 2 | Message delayed/Undeliverable | no (INFERRED, unverified integrator report; Q13) |
| Unsubscribe | 16 | Unsubscribe request | unknown |
| Subscribe | 32 | Subscribe request | no (INFERRED) |
| AutoResponder | 64 | Auto responder | no (INFERRED) |
| AddressChange | 128 | Address change | no (INFERRED) |
| DnsError | 256 | DNS error | no (INFERRED, unverified integrator report; Q13) |
| SpamNotification | 512 | Spam notification | no (INFERRED) |
| OpenRelayTest | 1024 | Open relay test | no (INFERRED) |
| Unknown | 2048 | Unknown | no (INFERRED) |
| SoftBounce | 4096 | Soft bounce | sometimes (DOC) |
| VirusNotification | 8192 | Virus notification | no (INFERRED) |
| ChallengeVerification | 16384 | Spam challenge verification | no (INFERRED) |
| BadEmailAddress | 100000 | Invalid email address | unknown |
| SpamComplaint | 100001 | Spam complaint | yes, `CanActivate: false` (DOC) |
| ManuallyDeactivated | 100002 | Manually deactivated | yes (INFERRED) |
| Unconfirmed | 100003 | Registration not confirmed | unknown |
| Blocked | 100006 | ISP block | unknown |
| SMTPApiError | 100007 | SMTP API error | no (INFERRED) |
| InboundError | 100008 | Processing failed | no (INFERRED) |
| DMARCPolicy | 100009 | DMARC Policy | unknown |
| TemplateRenderingFailed | 100010 | Template rendering failed | no (INFERRED) |

Codes 100004 and 100005 do not exist in any source.

### 1.5 `Inactive` and `CanActivate`

| Claim | Source |
| --- | --- |
| A hard bounce adds the address to the stream suppression list. | `refs/user-guide_sandbox-mode_generate-fake-bounces.md:15` DOC; `refs/support_article_1239-how-to-test-bounces.md:89` DOC |
| A hard bounce should be suppressed from further sends. | `refs/webhooks_bounce-webhook.md:55` DOC |
| A soft bounce may deactivate; check `Inactive` and `CanActivate`. | `refs/webhooks_bounce-webhook.md:57` DOC |
| A spam complaint deactivates, and the customer cannot reactivate it. | `refs/webhooks_spam-complaint-webhook.md:6` DOC |
| Spam complaint payload: `Inactive: true`, `CanActivate: false`. | `refs/webhooks_spam-complaint-webhook.md:57-58` DOC |
| SoftBounce, Transient, DnsError bounces are stored `Inactive: false` from creation. | INFERRED, unverified integrator report (Q13) |
| A hard bounce can also have `CanActivate: false`. | INFERRED, unverified integrator report (Q14) |
| After activation the bounce stays in `GET /bounces`, with `Inactive: false`. | INFERRED, unverified integrator report (Q8) |
| Activate response example: `Inactive: false`, `CanActivate: true`. | `refs/api_bounce-api.md:385-386` DOC |
| Activate fixture: `Inactive: false`, `CanActivate: false`. | `postmark-python/tests/test_bounces.py:327` SDK (unit fixture; doc wins) |
| `CanActivate: false` on activate → 422, ErrorCode 1003, "Due to the type of bounce, this address cannot be reactivated." | `refs/api_overview.md:119` DOC |
| Unknown bounce id or expired dump → 422, ErrorCode 1001. | `refs/api_overview.md:117` DOC |
| Missing `bounceID` → HTTP 400, ErrorCode 1002. | `refs/api_overview.md:118` DOC |
| Inactive filter on list describes "deactivated by Postmark due to the bounce". | `refs/api_bounce-api.md:113` DOC |

## 2. Suppressions API

All three calls are per stream, under `/message-streams/{stream_id}/`.
All need `X-Postmark-Server-Token` — `refs/api_suppressions-api.md:17,86,185` DOC.
None of them are in the OpenAPI files (path lists `refs/openapi/server.yml:895-2463`, `refs/openapi/account.yml:392-1002`) DOC.
Deleting a `HardBounce` suppression equals reactivating the linked bounce — `refs/api_suppressions-api.md:4` DOC.

### 2.1 Endpoints

| Method | Path | Body | 200 response | Source |
| --- | --- | --- | --- | --- |
| GET | `/message-streams/{stream_id}/suppressions/dump` | none | `{Suppressions: Suppression[]}` | `refs/api_suppressions-api.md:10-72` DOC |
| POST | `/message-streams/{stream_id}/suppressions` | `{Suppressions: [{EmailAddress}]}`, max 50 | `{Suppressions: SuppressionStatus[]}` | `refs/api_suppressions-api.md:78-169` DOC |
| POST | `/message-streams/{stream_id}/suppressions/delete` | `{Suppressions: [{EmailAddress}]}`, max 50 | `{Suppressions: SuppressionStatus[]}` | `refs/api_suppressions-api.md:175-269` DOC |

### 2.2 Dump query parameters

| Doc name | postmark.js sends | Values | Source |
| --- | --- | --- | --- |
| `SuppressionReason` | `suppressionReason` | `HardBounce`, `SpamComplaint`, `ManualSuppression` | `refs/api_suppressions-api.md:32` DOC; `postmark.js/src/client/models/suppressions/SuppressionFilteringParameters.ts:3-7,20` SDK |
| `Origin` | `origin` | `Recipient`, `Customer`, `Admin` | `refs/api_suppressions-api.md:33` DOC; `SuppressionFilteringParameters.ts:9-13,21` SDK |
| `todate` | `toDate` | date, inclusive | `refs/api_suppressions-api.md:34` DOC; `SuppressionFilteringParameters.ts:22` SDK |
| `fromdate` | `fromDate` | date, inclusive (doc text says "up to"; a doc typo) | `refs/api_suppressions-api.md:35` DOC |
| `EmailAddress` | `emailAddress` | address | `refs/api_suppressions-api.md:36` DOC; `SuppressionFilteringParameters.ts:24` SDK |
| (none) | `count`, `offset` | only when the caller uses `new SuppressionFilteringParameters()` | `postmark.js/src/client/models/client/FilteringParameters.ts:10-13` SDK |

Query key casing: postmark.js sends camelCase keys, and its live integration test expects the filter to work — `postmark.js/test/integration/Suppressions.test.ts:83-94` SDK.
Other SDKs send PascalCase keys — `postmark-python/postmark/models/suppressions/manager.py:33-43` SDK.
So Postmark matches query keys case-insensitively — INFERRED.

A postmark.js caller that passes a plain `{emailAddress}` object sends no `count` or `offset` — `postmark.js/src/client/HttpClient.ts:85-101` SDK.
The dump is not paged; the doc has no count or offset — `refs/api_suppressions-api.md:28-36` DOC.
Invalid `SuppressionReason` → 422 / 1404; invalid `Origin` → 422 / 1405 — `refs/api_overview.md:152-153` DOC.
Whether `EmailAddress` is an exact or substring match: unknown (Q5).

### 2.3 `Suppression` (dump item)

| Field | Values | Source |
| --- | --- | --- |
| `EmailAddress` | string | `refs/api_suppressions-api.md:53` DOC |
| `SuppressionReason` | `HardBounce`, `SpamComplaint`, `ManualSuppression` | `refs/api_suppressions-api.md:32,54,60,66` DOC |
| `Origin` | `Recipient`, `Customer`, `Admin` | `refs/api_suppressions-api.md:33,55` DOC |
| `CreatedAt` | ISO with offset, e.g. `2019-12-17T08:58:33-05:00` | `refs/api_suppressions-api.md:56` DOC |

Origin meaning:

| Origin | Meaning | Source |
| --- | --- | --- |
| `Recipient` | caused by the recipient: bounce, complaint, unsubscribe | `refs/webhooks_subscription-change-webhook.md:37-39,52-54` DOC + INFERRED |
| `Customer` | created by the API or UI by the account user | `postmark-dotnet/src/Postmark.Tests/ClientSuppressionTests.cs:119-120` SDK (API create → `Customer` / `ManualSuppression`); `postmark.js/test/integration/Suppressions.test.ts:83-88` SDK |
| `Admin` | created by Postmark staff | INFERRED |

### 2.4 `SuppressionStatus` (create/delete item)

| Call | `Status` | `Message` | Condition | Source |
| --- | --- | --- | --- | --- |
| create | `Suppressed` | `null` | address suppressed | `refs/api_suppressions-api.md:141-142,153-155` DOC |
| create | `Failed` | `"An invalid email address was provided."` | bad address syntax | `refs/api_suppressions-api.md:163-165` DOC; ErrorCode 1408 `refs/api_overview.md:156` DOC |
| create | `Failed` | `"You do not have the required authority to change this suppression."` | existing suppression the customer cannot change (example is a spam-complaint address) | `refs/api_suppressions-api.md:158-161` DOC; ErrorCode 1406 `refs/api_overview.md:154` DOC |
| delete | `Deleted` | `null` | suppression removed | `refs/api_suppressions-api.md:241-242,253-256` DOC |
| delete | `Deleted` | `null` | address was not suppressed | `refs/api_suppressions-api.md:258-261` DOC; `postmark-dotnet/src/Postmark.Tests/ClientSuppressionTests.cs:58-68` SDK |
| delete | `Failed` | `"You do not have the required authority to change this suppression."` | `SpamComplaint` suppression | `refs/api_suppressions-api.md:177,263-266` DOC |
| delete | `Failed` | `"An invalid email address was provided."` | bad address syntax | INFERRED (create behaviour applied to delete) |

The per-item result has no `ErrorCode` field — `refs/api_suppressions-api.md:139-142,239-242` DOC; `postmark.js/src/client/models/suppressions/Suppression.ts:12-16` SDK.
Item order and count match the request — `refs/api_suppressions-api.md:151-167` DOC + INFERRED.
A Python unit fixture uses `Failed` / `"Address not found."` — `postmark-python/tests/test_suppressions.py:32-36` SDK. The doc says a missing address gives `Deleted`. The doc wins.

### 2.5 Request-level errors

| Condition | HTTP | ErrorCode | Message | Source |
| --- | --- | --- | --- | --- |
| More than 50 items | 422 | 1410 | "You cannot provide more than the maximum number of suppressions for this request." | `refs/api_suppressions-api.md:114,214` DOC; `refs/api_overview.md:158` DOC |
| Missing or bad body | 422 | 1409 | "A proper request body must be provided." | `refs/api_overview.md:157` DOC |
| Unknown `stream_id` | 422 | 1226 | "The message stream for the provided 'ID' was not found." | `refs/api_overview.md:133` DOC; `postmark-php/tests/PostmarkClientSuppressionsTest.php:129-136` SDK (message text; the test has no fail-on-no-throw, so weak) |
| Internal failure | 422 | 1407 | "Something went wrong when processing the request." | `refs/api_overview.md:155` DOC |
| Bad token | 401 | 10 | | `refs/api_overview.md:60` DOC |

### 2.6 Eventual consistency

A created suppression may not show in the dump at once.
postmark.js and .NET tests poll the dump after create — `postmark.js/test/integration/Suppressions.test.ts:43-56` SDK; `postmark-dotnet/src/Postmark.Tests/ClientSuppressionTests.cs:86-88` SDK.
Mock is synchronous. Polling tests pass on the first read — INFERRED.

## 3. State machine: bounce ↔ suppression ↔ send

### 3.1 States per (server, stream, email)

| State | Suppression row | Send to `/email` on this stream |
| --- | --- | --- |
| Active | none | accepted |
| Suppressed / HardBounce | `HardBounce`, `Recipient` | 422 / 406 |
| Suppressed / SpamComplaint | `SpamComplaint`, `Recipient` | 422 / 406 |
| Suppressed / Manual (customer) | `ManualSuppression`, `Customer` | 422 / 406 |
| Suppressed / Unsubscribe | `ManualSuppression`, `Recipient` | 422 / 406 |

Sources: 406 means "hard bounce, spam complaint, or manual suppression" — `refs/api_email-api.md:311` DOC; `refs/api_overview.md:72` DOC.
Unsubscribe → `ManualSuppression` — `refs/webhooks_subscription-change-webhook.md:37` DOC.
Note: the unsubscribe reason is `ManualSuppression`, not a separate `SubscriptionChange` reason. `SubscriptionChange` is only the webhook `RecordType` — `refs/webhooks_subscription-change-webhook.md:46` DOC.

### 3.2 Transitions

| # | Event | Effect | Source |
| --- | --- | --- | --- |
| T1 | Hard bounce on stream S | new Bounce `Inactive: true`; suppression `HardBounce`/`Recipient` on S | `refs/user-guide_sandbox-mode_generate-fake-bounces.md:15` DOC; `refs/webhooks_bounce-webhook.md:55` DOC |
| T2 | Hard bounce on S | other streams unchanged | list per stream DOC `refs/user-guide_sandbox-mode_generate-fake-bounces.md:15`; effect on other streams INFERRED (Q3) |
| T3 | Spam complaint on S | Bounce `SpamComplaint`, `Inactive: true`, `CanActivate: false`; suppression `SpamComplaint` | `refs/webhooks_spam-complaint-webhook.md:6,57-58` DOC; reason value `refs/webhooks_subscription-change-webhook.md:36` DOC; stream scope INFERRED (Q3) |
| T4 | Soft/transient/DNS bounce | Bounce `Inactive: false`; no suppression (usually) | INFERRED, unverified integrator report (Q13); `refs/webhooks_bounce-webhook.md:57` DOC (soft bounce can deactivate) |
| T5 | Recipient unsubscribes on a Broadcasts stream with `UnsubscribeHandlingType: Postmark` | suppression `ManualSuppression`/`Recipient` on that stream | `refs/webhooks_subscription-change-webhook.md:37-39` DOC; handling type `refs/api_message-streams-api.md:50` DOC |
| T6 | `POST .../suppressions` | suppression `ManualSuppression`/`Customer` | `postmark-dotnet/src/Postmark.Tests/ClientSuppressionTests.cs:119-120` SDK |
| T7 | `POST .../suppressions/delete` on `HardBounce` row | row removed; linked bounce(s) `Inactive: false` | `refs/api_suppressions-api.md:4` DOC; bounce flag change INFERRED |
| T8 | `POST .../suppressions/delete` on `ManualSuppression`/`Customer` row | row removed | `refs/api_suppressions-api.md:253-256` DOC |
| T9 | `POST .../suppressions/delete` on `SpamComplaint` row | row kept; item `Failed` | `refs/api_suppressions-api.md:177` DOC |
| T10 | `POST .../suppressions/delete` on `ManualSuppression`/`Recipient` (unsubscribe) row | row kept; item `Failed` (likely) | `postmark-php/src/Postmark/PostmarkClient.php:1441` SDK (docblock: only `Customer`/`ManualSuppression` and `Recipient`/`HardBounce` can be reactivated); item text unknown (Q4) |
| T11 | `PUT /bounces/{id}/activate`, `CanActivate: true` | bounce `Inactive: false`; suppression row on the bounce's stream removed; bounce stays listed | `refs/api_bounce-api.md:369-387` DOC; `refs/webhooks_subscription-change-webhook.md:8` DOC (reactivation removes the row); stays listed INFERRED, unverified integrator report (Q8); row removal via activate INFERRED |
| T12 | `PUT /bounces/{id}/activate`, `CanActivate: false` | no change; 422 / 1003 | `refs/api_overview.md:119` DOC |
| T13 | Send after T7/T11 that bounces again | T1 again, new bounce id | INFERRED |
| T14 | Bounce record older than retention | bounce gone; suppression row stays | bounce retention `refs/api_bounce-api.md:4` DOC; row stays INFERRED |
| T15 | `POST /message-streams/{id}/archive` on S | S hidden from list; `ArchivedAt`, `ExpectedPurgeDate` set; effect on sends, suppressions and bounces of S unknown | `refs/api_message-streams-api.md:33,48` DOC; effects Q15 |
| T16 | `POST /message-streams/{id}/unarchive` before purge | S back; `ArchivedAt: null` | `refs/api_message-streams-api.md:402-453` DOC; after purge → 422 / 1232 `refs/api_overview.md:139` DOC |
| T17 | `POST /data-removals` for address A | request `Pending`, later `Done`; effect on messages, bounces and suppressions of A unknown | `refs/api_data-removals-api.md:4,59` DOC; effects Q16 |

### 3.3 The 406 response on `/email`

| Item | Value | Source |
| --- | --- | --- |
| HTTP status | 422 | `refs/api_overview.md:72` DOC |
| `ErrorCode` | 406 | `refs/api_overview.md:72` DOC |
| `Message` (single send, mock default until captured) | `You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: <a>, <b>. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression.` | `postmark.js/test/unit/ErrorHandler.test.ts:113-116` SDK |
| `Message` (batch item only, inside HTTP 200) | `You tried to send to a recipient that has been marked as inactive. Found inactive addresses: <a>. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression. ` | `refs/api_email-api.md:301-313` DOC |
| postmark.js class | `InactiveRecipientsError` only when HTTP = 422 **and** ErrorCode = 406 | `postmark.js/src/client/errors/ErrorHandler.ts:40-41` SDK; `postmark.js/src/client/errors/Errors.ts:74-75,87-88` SDK |
| `recipients` parse | regex `/Found inactive addresses: (.+?)\.? Inactive/` or `/these inactive addresses: (.+?)\.?$/` | `postmark.js/src/client/errors/Errors.ts:98-101` SDK |

If the message matches neither regex, a client that reads `.recipients` gets an empty list — `postmark.js/src/client/errors/Errors.ts:109,112-127` SDK.
So the mock message must match the first regex exactly.

Which stream is checked: the `MessageStream` of the send; absent = `outbound` — `refs/api_email-api.md:56` DOC. Each stream has its own suppression list — `refs/user-guide_sandbox-mode_generate-fake-bounces.md:15` DOC. That the check reads only that stream's list is INFERRED (Q3).
Unknown send stream → 422 / 1235; Inbound stream → 422 / 1236 — `refs/api_overview.md:78-79` DOC.
Mixed active and inactive recipients (e.g. active `To`, suppressed `Bcc`): deliver to the active recipients and return HTTP 422 / 406 naming the suppressed addresses. INFERRED: reported by an application integrator; unverified. Same rule as `docs/03` §3.2. Capture: Q6.

### 3.4 Reactivation flows (the mock must support both end to end)

Flow A, Suppressions API:

| Step | SDK call | Mock result needed | Source |
| --- | --- | --- | --- |
| 1 | `sendEmail` to a suppressed address on S | 422 / 406, parsable message | `postmark.js/src/client/errors/ErrorHandler.ts:40-41` SDK |
| 2 | `getSuppressions(S, {emailAddress})` | row with `SuppressionReason: "HardBounce"` | `postmark.js/src/client/ServerClient.ts:779-782` SDK |
| 3 | `deleteSuppressions(S, {Suppressions:[{EmailAddress}]})` | every item `Status: "Deleted"` | `ServerClient.ts:805-808` SDK |
| 4 | `sendEmail` again | 200 | T7 |
| alt | row is `SpamComplaint` | delete item `Failed`; next send still 406 | T9 |

Flow B, Bounce API:

| Step | SDK call | Mock result needed | Source |
| --- | --- | --- | --- |
| 1 | `getBounces({emailFilter, count, offset})` | bounces whose `Email` contains the filter; caller filters exact match | §1.2 |
| 2 | `activateBounce(id)` | `{Message: "OK", Bounce}`; suppression row gone | T11 |
| alt | `CanActivate: false` | 422 / 1003 | T12 |

Activate request body differs by SDK. The doc lists `Content-Type` as required — `refs/api_bounce-api.md:322` DOC.

| SDK | Body | `Content-Type` | Source |
| --- | --- | --- | --- |
| postmark.js | `{}` | `application/json` | `postmark.js/src/client/ServerClient.ts:227-229`; `BaseClient.ts:109-116` SDK |
| postmark-python | none | `application/json` (client default) | `postmark-python/postmark/models/bounces/manager.py:141`; `postmark-python/postmark/clients/server_client.py:91-94` SDK |
| postmark-gem | `''` | gem default headers | `postmark-gem/lib/postmark/api_client.rb:148`; `postmark-gem/lib/postmark/http_client.rb:34-36,82-84` SDK |
| postmark-php | none | `application/json` | `postmark-php/src/Postmark/PostmarkClient.php:382`; `postmark-php/src/Postmark/PostmarkClientBase.php:116-117` SDK |

So the mock must accept an empty body and `{}` on activate.
A request with no `Content-Type`: 415 or 200 is unknown (Q9).

## 4. Message Streams API

All calls need `X-Postmark-Server-Token` — `refs/api_message-streams-api.md:17` DOC.
Not in the OpenAPI files. §4.5 lists the stream state.

### 4.1 Endpoints

| Method | Path | Body / query | 200 response | Source |
| --- | --- | --- | --- | --- |
| GET | `/message-streams` | `MessageStreamType` = `All`\|`Inbound`\|`Transactional`\|`Broadcasts` (default `All`); `IncludeArchivedStreams` (default false) | `{MessageStreams: MessageStream[], TotalCount}` | `refs/api_message-streams-api.md:10-118` DOC |
| GET | `/message-streams/{id}` | none | `MessageStream` | `refs/api_message-streams-api.md:125-179` DOC |
| PATCH | `/message-streams/{id}` | `Name`, `Description`, `SubscriptionManagementConfiguration.UnsubscribeHandlingType` | `MessageStream` | `refs/api_message-streams-api.md:185-259` DOC |
| POST | `/message-streams` | `ID`*, `Name`*, `MessageStreamType`* (`Broadcasts`\|`Transactional`), `Description`, `SubscriptionManagementConfiguration` | `MessageStream` | `refs/api_message-streams-api.md:266-350` DOC |
| POST | `/message-streams/{id}/archive` | empty, `Content-Length: 0` | `{ID, ServerID, ExpectedPurgeDate}` | `refs/api_message-streams-api.md:357-396` DOC |
| POST | `/message-streams/{id}/unarchive` | empty, `Content-Length: 0` | `MessageStream` with `ArchivedAt: null` | `refs/api_message-streams-api.md:402-453` DOC |

### 4.2 `MessageStream` object

| Field | Type | Note | Source |
| --- | --- | --- | --- |
| `ID` | string | | `refs/api_message-streams-api.md:40` DOC |
| `ServerID` | integer | | `refs/api_message-streams-api.md:41` DOC |
| `Name` | string | | `refs/api_message-streams-api.md:42` DOC |
| `Description` | string \| null | | `refs/api_message-streams-api.md:43` DOC |
| `MessageStreamType` | `Inbound`\|`Broadcasts`\|`Transactional` | | `refs/api_message-streams-api.md:44` DOC; `postmark-dotnet/src/Postmark/Model/MessageStreams/MessageStreamType.cs:8-10` SDK |
| `CreatedAt` | string | | `refs/api_message-streams-api.md:45` DOC |
| `UpdatedAt` | string \| null | null on create | `refs/api_message-streams-api.md:46` DOC; `postmark-dotnet/src/Postmark.Tests/ClientMessageStreamTests.cs:43` SDK |
| `ArchivedAt` | string \| null | | `refs/api_message-streams-api.md:47` DOC |
| `ExpectedPurgeDate` | string \| null | archive + 45 days | `refs/api_message-streams-api.md:48` DOC |
| `SubscriptionManagementConfiguration.UnsubscribeHandlingType` | `None`\|`Postmark`\|`Custom` | Broadcasts default `Postmark` (required); Transactional/Inbound default `None`; `Custom` needs approval | `refs/api_message-streams-api.md:50,213` DOC; `postmark.js/src/client/models/streams/MessageStream.ts:2-6` SDK |

Doc disagreements:

| Topic | Source A | Source B |
| --- | --- | --- |
| `None` casing | `"none"` in examples, `refs/api_message-streams-api.md:85,99,113` DOC | `"None"`, `refs/api_message-streams-api.md:312,349` DOC; `MessageStream.ts:3` SDK |
| Archive `ID` type | string, `refs/api_message-streams-api.md:381,393` DOC | number, `postmark.js/src/client/models/streams/MessageStream.ts:31` SDK |
| Archive/unarchive `ServerID` type | string, `refs/api_message-streams-api.md:382,427` DOC | integer in examples, `refs/api_message-streams-api.md:394` DOC |
| Create example `ArchivedAt` | non-null, `refs/api_message-streams-api.md:346` DOC | null expected, `postmark-dotnet/src/Postmark.Tests/ClientMessageStreamTests.cs:44` SDK |

### 4.3 Default streams and limits

| Rule | Source |
| --- | --- |
| A server has at most 10 streams, defaults included. | `refs/api_message-streams-api.md:4` DOC |
| Default streams cannot be deleted. | `refs/api_message-streams-api.md:4` DOC |
| A server has at most 1 Inbound stream. | `refs/api_message-streams-api.md:4` DOC; ErrorCode 1228 `refs/api_overview.md:135` DOC |
| Default transactional id is `outbound`. | `refs/api_email-api.md:56` DOC; `postmark.js/test/integration/MessageStreams.test.ts:50-51` SDK |
| Default inbound id is `inbound`. | `refs/api_message-streams-api.md:89` DOC (example) |
| A new server has 3 streams: one Transactional, one Inbound, one Broadcasts. | `postmark.js/test/integration/MessageStreams.test.ts:57-62` SDK (1 create → 4); `postmark-dotnet/src/Postmark.Tests/ClientMessageStreamTests.cs:82,89,103` SDK |
| Default broadcast id is `broadcast`. | `postmark.js/test/integration/Sending.test.ts:41` SDK (live send); doc examples use `broadcasts` as a custom id, `refs/api_message-streams-api.md:61` DOC (Q7) |
| Default transactional and inbound streams cannot be archived. | ErrorCode 1229 `refs/api_overview.md:136` DOC |
| Archive of a stream may fail with "unable to be archived". The condition is unknown: the postmark.js live test gets 1241 for a new stream; the dotnet and java live tests archive new streams (`docs/08` §6 Q15). | ErrorCode 1241 `refs/api_overview.md:146` DOC; `postmark.js/test/integration/MessageStreams.test.ts:66-78` SDK; `postmark-dotnet/src/Postmark.Tests/ClientMessageStreamTests.cs:114-127` SDK |
| Archived streams are hidden from the list unless `IncludeArchivedStreams=true`. | `refs/api_message-streams-api.md:33` DOC; `postmark-dotnet/src/Postmark.Tests/ClientMessageStreamTests.cs:101-111` SDK |

### 4.4 Stream error codes (all HTTP 422)

Source for every row: `refs/api_overview.md:127-146` DOC.

| ErrorCode | Message |
| --- | --- |
| 1220 | You do not have permission to use the message streams API. |
| 1221 | The `MessageStreamType` associated with this request was invalid. |
| 1222 | A valid `ID` must be provided. |
| 1223 | A valid `Name` must be provided. |
| 1224 | The `Name` is too long. |
| 1225 | You have reached the maximum number of message streams for this server. |
| 1226 | The message stream for the provided `ID` was not found. |
| 1227 | The `ID` must be a non-empty string starting with a letter, up to 30 characters. |
| 1228 | A server can only have one inbound stream. |
| 1229 | You cannot archive the default transactional and inbound streams. |
| 1230 | The `ID` provided already exists for this server. |
| 1231 | The `Description` is too long. |
| 1232 | You cannot unarchive this message stream anymore. |
| 1233 | The `ID` must not start with the `pm-` prefix. |
| 1234 | The `Description` must not contain HTML tags. |
| 1237 | The `ID` is reserved. |
| 1238 | You do not have permission to use Custom Unsubscribe Handling for this stream. |
| 1239 | The `UnsubscribeHandlingType` provided is not supported for this stream type. |
| 1240 | The `UnsubscribeHandlingType` associated with this request is invalid. |
| 1241 | Stream is unable to be archived at this time. |

Send-side stream errors: 1235 unknown stream, 1236 sending not supported for stream type — `refs/api_overview.md:78-79` DOC.
The real 1226 message quotes `'ID'` with single quotes — `postmark-php/tests/PostmarkClientSuppressionsTest.php:135` SDK. The overview table renders it as code; the SDK text wins for the wire.

### 4.5 Stream state

| Need | Reason |
| --- | --- |
| A set of streams per server with every §4.2 field | list/get/edit/create/archive/unarchive |
| `outbound` (Transactional), `inbound` (Inbound), `broadcast` (Broadcasts) seeded on a new server | §4.3; Q7 |
| Archived flag with `ArchivedAt` and `ExpectedPurgeDate` | list filter; 1232 after purge |
| Suppressions and bounces keyed by stream | §3 |
| Stream type per id | 1235/1236 on send; 1226 on suppressions; 1239 on handling type |

## 5. Data Removals API

Account-token API. Token rules are in `docs/02`.

| Method | Path | Token | Body | Response | Source |
| --- | --- | --- | --- | --- | --- |
| POST | `/data-removals` | `X-Postmark-Account-Token` | `{RequestedBy, RequestedFor, NotifyWhenCompleted}` | `{ID, Status: "Pending"\|"Done"}` | `refs/api_data-removals-api.md:12-70` DOC |
| GET | `/data-removals/{id}` | `X-Postmark-Account-Token` | none | `{ID, Status}` | `refs/api_data-removals-api.md:76-110` DOC |

Access needs a support request — `refs/api_data-removals-api.md:6` DOC.
`RequestedFor` must be a valid email address — `refs/api_data-removals-api.md:41` DOC.
`ID` is an integer — `refs/api_data-removals-api.md:58,98` DOC.

| ErrorCode | HTTP | Message | Source |
| --- | --- | --- | --- |
| 1300 | 422 | Empty request, or an invalid offset or count. | `refs/api_overview.md:203` DOC |
| 1301 | 422 | Missing or incorrect data removal request ID. | `refs/api_overview.md:204` DOC |
| 1302 | 422 | You don't have permission to process or review data removal requests through the API. | `refs/api_overview.md:205` DOC |

Error for an invalid `RequestedFor`, time from `Pending` to `Done`, and what data is erased: unknown (Q16).

## 6. postmark.js 5.1.0 wire map

Common wire facts:

| Fact | Source |
| --- | --- |
| Headers on every call: token header, `Accept: application/json`, `Content-Type: application/json`, `User-Agent: Postmark.JS - 5.1.0` | `postmark.js/src/client/BaseClient.ts:109-116` SDK |
| `processRequestWithBody` sends `JSON.stringify(body)`; `{}` becomes body `"{}"` | `postmark.js/src/client/HttpClient.ts:44` SDK |
| `processRequestWithoutBody` sends no body | `postmark.js/src/client/BaseClient.ts:52-55`; `HttpClient.ts:44` SDK |
| Query keys are the object's own property names; `undefined`/`null` values are dropped | `postmark.js/src/client/HttpClient.ts:85-101` SDK |
| Non-2xx rejects with `ErrorCode`/`Message` from the body | `postmark.js/src/client/HttpClient.ts:55-59,134-140` SDK |
| 404 → `PostmarkError`; 422 → `ApiInputError` subclasses | `postmark.js/src/client/errors/ErrorHandler.ts:37-41` SDK |

| Method | HTTP | Path | Query / body keys as sent | Source |
| --- | --- | --- | --- | --- |
| `getDeliveryStatistics()` | GET | `/deliveryStats` (camel case; doc is `/deliverystats`) | none | `postmark.js/src/client/ServerClient.ts:182-184` SDK |
| `getBounces(filter)` | GET | `/bounces` | `count` (default 100), `offset` (default 0), `type`, `inactive`, `emailFilter`, `tag`, `messageID`, `fromDate`, `toDate`, `messageStream` | `ServerClient.ts:193-196`; `BaseClient.ts:132-135`; `models/bounces/BounceFilteringParameters.ts:9-16` SDK |
| `getBounce(id)` | GET | `/bounces/{id}` | none | `ServerClient.ts:205-207` SDK |
| `getBounceDump(id)` | GET | `/bounces/{id}/dump` | none | `ServerClient.ts:216-218` SDK |
| `activateBounce(id)` | PUT | `/bounces/{id}/activate` | body `{}` | `ServerClient.ts:227-229` SDK |
| `getMessageStreams(filter)` | GET | `/message-streams` | `messageStreamType`, `includeArchivedStreams` | `ServerClient.ts:712-714`; `models/streams/MessageStreamsFilteringParameters.ts:5-6` SDK |
| `getMessageStream(id)` | GET | `/message-streams/{id}` | none | `ServerClient.ts:723-725` SDK |
| `editMessageStream(id, o)` | PATCH | `/message-streams/{id}` | body `Name`, `Description`, `SubscriptionManagementConfiguration` | `ServerClient.ts:735-737`; `models/streams/MessageStream.ts:49-59` SDK |
| `createMessageStream(o)` | POST | `/message-streams` | body `ID`, `Name`, `MessageStreamType`, `Description`, `SubscriptionManagementConfiguration` | `ServerClient.ts:746-748`; `MessageStream.ts:61-76` SDK |
| `archiveMessageStream(id)` | POST | `/message-streams/{id}/archive` | body `{}` (doc says `Content-Length: 0`) | `ServerClient.ts:757-759`; `postmark.js/test/unit/MessageStreams.test.ts:34-38` SDK |
| `unarchiveMessageStream(id)` | POST | `/message-streams/{id}/unarchive` | body `{}` | `ServerClient.ts:768-770` SDK |
| `getSuppressions(stream, filter)` | GET | `/message-streams/{stream}/suppressions/dump` | `suppressionReason`, `origin`, `toDate`, `fromDate`, `emailAddress`; plus `count`/`offset` only with the class default | `ServerClient.ts:779-782`; `models/suppressions/SuppressionFilteringParameters.ts:19-35` SDK |
| `createSuppressions(stream, o)` | POST | `/message-streams/{stream}/suppressions` | body `{Suppressions:[{EmailAddress}]}` | `ServerClient.ts:792-795`; `models/suppressions/Suppression.ts:22-26` SDK |
| `deleteSuppressions(stream, o)` | POST | `/message-streams/{stream}/suppressions/delete` | body `{Suppressions:[{EmailAddress}]}` | `ServerClient.ts:805-808`; `Suppression.ts:27` SDK |
| `requestDataRemoval(o)` (AccountClient) | POST | `/data-removals` | body `RequestedBy`, `RequestedFor`, `NotifyWhenCompleted` | `postmark.js/src/client/AccountClient.ts:314-316`; `models/data_removal/DataRemovals.ts:12-22` SDK |
| `getDataRemovalStatus(id)` (AccountClient) | GET | `/data-removals/{id}` | none | `AccountClient.ts:325-327` SDK |

Path casing: postmark.js calls `/deliveryStats`, other SDKs call `/deliverystats` — `postmark-php/src/Postmark/PostmarkClient.php:297` SDK; `postmark-python/postmark/models/bounces/manager.py:29` SDK.
Both work live, so Postmark routes paths case-insensitively — INFERRED.

## Mock must

State:

- [ ] Keep a stream table per server with every §4.2 field; seed `outbound` (Transactional), `inbound` (Inbound), `broadcast` (Broadcasts).
- [ ] Keep suppressions keyed by (server, stream, lower-cased email) with `SuppressionReason`, `Origin`, `CreatedAt`.
- [ ] Keep bounces with every §1.3 field, plus the stream, the raw dump, and a link to the suppression row they caused.
- [ ] Assign bounce `ID` as an integer, increasing.
- [ ] Keep data removal requests per account: integer `ID`, `Status`.
- [ ] Compare email addresses case-insensitively (INFERRED).
- [ ] Apply every §3.2 transition; answer an unknown effect (T10 text, T15, T17) per its capture, not by guess.

Creating state (one path, Postmark-native):

- [ ] Turn a send to `<type>@bounce-testing.postmarkapp.com` (or header `X-PM-Bounce-Type`) into a bounce of that type — `refs/user-guide_sandbox-mode_generate-fake-bounces.md:7-26` DOC.
- [ ] For `HardBounce`: set `Inactive: true`, `CanActivate: true`, add a `HardBounce`/`Recipient` suppression on the send stream.
- [ ] Map a `SpamComplaint` request on that domain to `HardBounce`, as Postmark does — `refs/support_article_1239-how-to-test-bounces.md:90` DOC. (Q2 covers how to seed a real spam complaint.)
- [ ] `POST .../suppressions` creates `ManualSuppression`/`Customer` rows (T6).

Send check (`/email` and every send path in `docs/03`):

- [ ] Resolve stream: absent → `outbound`; unknown → 422/1235; Inbound → 422/1236.
- [ ] If any recipient is suppressed on that stream → HTTP 422, `ErrorCode: 406`, message matching `/Found inactive addresses: (.+?)\.? Inactive/`. Still deliver to the active recipients (§3.3; INFERRED, Q6).

Suppressions:

- [ ] Match query keys case-insensitively (`emailAddress` = `EmailAddress`).
- [ ] Filter dump by `SuppressionReason`, `Origin`, `fromdate`, `todate` (inclusive), `EmailAddress` (match rule per Q5).
- [ ] Accept and ignore `count`/`offset` on dump.
- [ ] Unknown stream → 422 / 1226 `The message stream for the provided 'ID' was not found.`
- [ ] Bad `SuppressionReason` → 422/1404; bad `Origin` → 422/1405.
- [ ] Body missing or not `{Suppressions: [...]}` → 422/1409; > 50 items → 422/1410.
- [ ] Create: bad syntax → `Failed` + invalid-address message; existing row the customer cannot change → `Failed` + authority message; otherwise `Suppressed` + `Message: null`.
- [ ] Delete: bad syntax → `Failed` + invalid-address message; `SpamComplaint` → `Failed` + authority message; otherwise `Deleted` + `Message: null`, also when no row exists.
- [ ] Delete of a `HardBounce` row: set linked bounces `Inactive: false`.
- [ ] Return one result item per request item, same order.

Bounces:

- [ ] `GET /bounces`: require `count` (1..500) and `offset` (≥ 0), `count + offset` ≤ 10000, else 422/1000; illegal `type` → 422/1000.
- [ ] Filter by `type`, `inactive`, `emailFilter` (substring), `tag`, `messageID`, `fromdate`/`todate` (inclusive, Eastern Time), `messagestream` (default `outbound`).
- [ ] Return `{TotalCount, Bounces}`; `TotalCount` counts all matches, not the page (INFERRED).
- [ ] Keep activated bounces in the list with `Inactive: false`.
- [ ] `GET /bounces/{id}`: the bounce with `Content`; unknown id → 422/1001.
- [ ] `GET /bounces/{id}/dump`: `{Body}`; `""` when no dump; `DumpAvailable: false` after 30 days.
- [ ] Missing bounce id → HTTP 400 / 1002.
- [ ] `PUT /bounces/{id}/activate`: accept an empty body and `{}` (§3.4).
- [ ] Activate: unknown id → 422/1001; `CanActivate: false` → 422/1003; otherwise set `Inactive: false`, delete the linked suppression row, return `{Message: "OK", Bounce}` with `Content`.
- [ ] `GET /deliverystats`: `InactiveMails` plus `Bounces` with `{"Name": "All", Count}` first, then one `{Name, Count, Type}` per type present (INFERRED).
- [ ] Route `/deliveryStats` and `/deliverystats` to the same handler (INFERRED path case rule).
- [ ] Drop bounces past the retention period (45 days default); keep their suppression rows (T14).

Message streams:

- [ ] `GET /message-streams`: filter `MessageStreamType` (`All` default); hide archived unless `IncludeArchivedStreams=true`; return `{MessageStreams, TotalCount}`.
- [ ] `GET /message-streams/{id}`: unknown → 422/1226.
- [ ] `POST /message-streams`: `ID` rules → 1222/1227/1230/1233/1237; `Name` → 1223/1224; `Description` → 1231/1234; `MessageStreamType` not `Broadcasts`/`Transactional` → 1221; more than 10 streams → 1225; `UpdatedAt: null` and `ArchivedAt: null` on create.
- [ ] Default `UnsubscribeHandlingType`: `Postmark` for Broadcasts, `None` otherwise; `Custom` without permission → 1238; value not allowed for the type → 1239; unknown value → 1240.
- [ ] `PATCH /message-streams/{id}`: change only `Name`, `Description`, `UnsubscribeHandlingType`; set `UpdatedAt`.
- [ ] `POST .../archive`: default transactional or inbound → 1229; else return `{ID, ServerID, ExpectedPurgeDate}` with purge = archive + 45 days; accept an empty body and `{}`.
- [ ] `POST .../unarchive`: return the stream with `ArchivedAt: null`; after the purge date → 1232.
- [ ] An account switch returns 1220 (no API permission); a fault returns 1241 (unable to archive).

Data removals:

- [ ] Require `X-Postmark-Account-Token`; answer a missing or wrong token per `docs/02`.
- [ ] `POST /data-removals`: empty body → 422/1300; return `{ID, Status: "Pending"}`.
- [ ] `GET /data-removals/{id}`: unknown or bad id → 422/1301; return `{ID, Status}`; move to `Done` on the mock clock.
- [ ] An account-level switch returns 422/1302 for accounts without data removal access.

## Open questions for live capture

| # | Question | Why it matters |
| --- | --- | --- |
| Q1 | `GET /bounces?emailFilter=`: substring or exact? Case-sensitive? Does `a@x.com` match `aa@x.com`? | Unverified integrator report says substring; SDK docstring says "partial". Clients must post-filter. |
| Q2 | How does a test seed a `SpamComplaint` suppression and a `CanActivate: false` bounce? The bounce-testing domain maps `SpamComplaint` to `HardBounce`. | Needed to test the "cannot lift" branch of both §3.4 flows. |
| Q3 | Does a hard bounce or spam complaint on `outbound` also block `broadcast`? Does the 406 check use only the send stream? | Stream scoping of the whole state model. |
| Q4 | Can a customer delete a `ManualSuppression`/`Recipient` (unsubscribe) row? What `Status`/`Message` comes back? | §3.2 T10; PHP SDK docblock says no. |
| Q5 | Is dump `EmailAddress` an exact or a substring match? Case-sensitive? | A client that checks `.some(r => r.SuppressionReason === "HardBounce")` without an exact-address filter can act on the wrong row. |
| Q6 | Send with To active + Bcc suppressed: HTTP status, ErrorCode, `Message` form, and is `To` delivered? Mock default: deliver + 422/406 (§3.3). | Only an unverified integrator report. The SDK's second regex (`Errors.ts:100`, "these inactive addresses") suggests another `Message` form; its status is unknown. |
| Q7 | Default broadcast stream id on a new server: `broadcast` or `broadcasts`? `UnsubscribeHandlingType` casing: `None` or `none`? | Stream table seed. |
| Q8 | After `PUT /bounces/{id}/activate`, is the dump row gone at once, and does the bounce stay in `GET /bounces`? After deleting a `HardBounce` row, does the bounce show `Inactive: false`, and does `CanActivate` change? | T7/T11 link direction; "stays listed" is an unverified integrator report. |
| Q9 | Activate on a bounce that is already `Inactive: false`: 200 or error? Activate with no `Content-Type`: 415 or 200? | A webhook consumer that activates on each redelivery repeats the call; plain HTTP clients may omit the header. |
| Q10 | Delete for an address with no row: `Deleted` (doc) or `Failed` "Address not found." (Python fixture)? | A client that treats anything but `Deleted` as "not lifted" branches on it. |
| Q11 | Unknown stream on suppressions: exact `Message` text and quote style; HTTP 422 or 404? | Error wire parity. |
| Q12 | `BouncedAt` / `CreatedAt` format: `Z` or Eastern offset? | Timestamp formatting. |
| Q13 | Does `SoftBounce` ever set `Inactive: true`? If so, which `SuppressionReason` does the row get? Do `Transient` and `DnsError` ever deactivate? | Only three reasons exist; "never deactivate" is an unverified integrator report. |
| Q14 | Can a `HardBounce` have `CanActivate: false`? When? | Unverified integrator report; decides whether Flow A step 3 can fail for a hard bounce. |
| Q15 | Archived stream S: does a send to S return 1235, 1236, or succeed? Do suppressions and bounces on S stay readable? | §3.2 T15. |
| Q16 | Data removal: error for an invalid `RequestedFor`; time from `Pending` to `Done`; which messages, bounces and suppressions of the address are erased? | §3.2 T17; §5. |
