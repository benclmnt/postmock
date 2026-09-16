# 03 — Sending

Scope: the Postmark send endpoints, their validation, and what happens to a message after accept.
Marks: **DOC**, **SDK**, **LIB**, **CAPTURED**, **INFERRED** (see `AGENTS.md` rule 6).
No capture exists yet. Every "exact" string below comes from docs or SDK tests, not from the wire.

## 0. Surface

| SDK call (postmark.js) | Endpoint | Section |
| --- | --- | --- |
| `sendEmail` | `POST /email` | §1.2, §3 |
| `sendEmailBatch` | `POST /email/batch` | §1.3, §2 |
| `sendEmailWithTemplate` | `POST /email/withTemplate` | §1.4 |
| `sendEmailBatchWithTemplates` | `POST /email/batchWithTemplates` | §1.5, §2 |
| `sendBulkEmail` / `getBulkEmailStatus` | `POST /email/bulk`, `GET /email/bulk/{id}` | §1.6 |
| none (no official SDK calls it) | `GET /email/bulk` (list) | §1.6 |
| SMTP clients | `smtp.postmarkapp.com:587` | `docs/07` |

Template rendering rules (Mustachio syntax, `InlineCss`) belong to `docs/06`. This doc covers the send wire contract only.

## 1. Endpoints

### 1.1 Common HTTP contract

| Item | Rule | Source |
| --- | --- | --- |
| Base URL | `https://api.postmarkapp.com` | `refs/api_overview.md` **DOC** |
| Auth header | `X-Postmark-Server-Token`; name and value case-insensitive | `refs/api_overview.md` **DOC** |
| Missing/wrong token | HTTP 401, ErrorCode 10 | `refs/api_overview.md` **DOC** |
| Missing `Content-Type`/`Accept` | HTTP 415 | `refs/api_overview.md` **DOC** |
| Input errors | HTTP 422, body `{"ErrorCode": n, "Message": "..."}` | `refs/api_overview.md`; `refs/openapi/server.yml:885-889` **DOC** |
| Error header | `X-PM-ApiErrorCode: <ErrorCode>` echoed | `refs/api_overview.md` **DOC** |
| Too large | HTTP 413 (10 MB `/email`, 50 MB batch) | `refs/api_overview.md` **DOC** |
| Rate limit | HTTP 429 | `refs/api_overview.md` **DOC** |
| Maintenance | HTTP 503, ErrorCode 100 | `refs/api_overview.md` **DOC** |
| Test token | `POSTMARK_API_TEST` accepted as server token (see §4) | `refs/api_overview.md` **DOC** |

### 1.2 `POST /email`

Request body. Sources: `refs/api_email-api.md`, `refs/user-guide_send-email-with-api_send-a-single-email.md` **DOC**, `refs/openapi/server.yml:18-57` **DOC**.

| Field | Type | Required | Limit / rule | Source |
| --- | --- | --- | --- | --- |
| `From` | string | yes | Confirmed Sender Signature or verified domain. Max 255 chars (UTF-16 code units). `Name <addr>` allowed. | `refs/api_email-api.md`; `refs/user-guide_send-email-with-api_send-a-single-email.md` **DOC** |
| `To` | string | yes | Comma-separated. To+Cc+Bcc ≤ 50. | `refs/api_email-api.md` **DOC** |
| `Cc` | string | no | Comma-separated. Counts toward 50. | `refs/api_email-api.md` **DOC** |
| `Bcc` | string | no | Comma-separated. Counts toward 50. | `refs/api_email-api.md` **DOC** |
| `Subject` | string | no (see open Q) | Max 2000 chars (UTF-16 code units). | `refs/api_email-api.md`; `refs/user-guide_send-email-with-api_send-a-single-email.md` **DOC** |
| `Tag` | string | no | Max 1000 chars. One tag per message. | `refs/api_email-api.md` **DOC** |
| `HtmlBody` | string | one of Html/Text | Max 5 MB. | `refs/support_article_1056-what-are-the-attachment-and-email-size-limits.md` **DOC** |
| `TextBody` | string | one of Html/Text | Max 5 MB. | same **DOC** |
| `ReplyTo` | string | no | Comma-separated. Default from signature. | `refs/api_email-api.md` **DOC** |
| `Headers` | array of `{Name, Value}` | no | Both strings. | `refs/openapi/server.yml:838-846,862-865` **DOC** |
| `TrackOpens` | boolean | no | Default `false`; server setting forces `true`. | `refs/user-guide_tracking-opens_tracking-opens-per-email.md` **DOC** |
| `TrackLinks` | string enum | no | `None` `HtmlAndText` `HtmlOnly` `TextOnly`. Absent = server setting. | `refs/openapi/server.yml:50-53` **DOC** |
| `Metadata` | object string→string | no | ≤ 10 keys; key ≤ 20 chars; value ≤ 80 chars; no case-insensitive duplicate keys. | `refs/support_article_1125-custom-metadata-faq.md` **DOC** |
| `Attachments` | array | no | See §1.7. | `refs/api_email-api.md` **DOC** |
| `MessageStream` | string | no | Default `"outbound"`. | `refs/api_email-api.md` **DOC** |

The OpenAPI file omits `Metadata` and `MessageStream`. The HTML docs list both. `refs/openapi/server.yml:18-57` vs `refs/api_email-api.md` **DOC** (docs disagree; the SDK sends both, `sdk/postmark.js/src/client/models/message/Message.ts:11,21` **SDK**).

The SDK model marks `Subject` required and `To` optional. `sdk/postmark.js/src/client/models/message/Message.ts:8,12` **SDK**. The docs mark `To` required. The SDK types do not bind the server.

Response (HTTP 200):

| Field | Type | Format | Source |
| --- | --- | --- | --- |
| `To` | string | The request `To` value | `refs/api_email-api.md` **DOC** |
| `SubmittedAt` | string | ISO 8601, 7 fractional digits, zone offset: `2014-02-17T07:25:01.4178645-05:00` | `refs/api_email-api.md` **DOC** |
| `MessageID` | string | lowercase UUID, 36 chars | `refs/api_email-api.md` **DOC**; `sdk/postmark-java/src/test/java/integration/MessageTest.java:36` **SDK** |
| `ErrorCode` | integer | `0` | `refs/api_email-api.md` **DOC** |
| `Message` | string | `"OK"` | `refs/api_email-api.md` **DOC** |

The SDK type also allows `Cc` and `Bcc` in the response. `sdk/postmark.js/src/client/models/message/Message.ts:44-50` **SDK**. No doc shows them.

### 1.3 `POST /email/batch`

| Item | Rule | Source |
| --- | --- | --- |
| Body | JSON array of §1.2 objects | `refs/api_email-api.md`; `refs/openapi/server.yml:138-141` **DOC** |
| Max items | 500 → ErrorCode 410 | `refs/api_overview.md` **DOC** |
| Max payload | 50 MB incl. attachments → HTTP 413 | `refs/api_email-api.md`; `refs/api_overview.md` **DOC** |
| Response | HTTP 200, array of §1.2 responses, same order as request | `refs/api_email-api.md` **DOC** |
| Per-item errors | §2 | §2 |

### 1.4 `POST /email/withTemplate`

Body = §1.2 fields, minus `Subject`/`HtmlBody`/`TextBody`, plus:

| Field | Type | Required | Rule | Source |
| --- | --- | --- | --- | --- |
| `TemplateId` | integer | if no `TemplateAlias` | | `refs/api_templates-api.md` **DOC** |
| `TemplateAlias` | string | if no `TemplateId` | | `refs/api_templates-api.md` **DOC** |
| `TemplateModel` | object | yes | Renders `Subject`, `HtmlBody`, `TextBody` | `refs/api_templates-api.md` **DOC** |
| `InlineCss` | boolean | no | Default `true` | `refs/openapi/server.yml:68-70` **DOC** |

OpenAPI lists both `TemplateId` and `TemplateAlias` as required. That is wrong; the prose says "one of". `refs/openapi/server.yml:98-103` vs `refs/api_templates-api.md` **DOC**.
If both are given, `TemplateId` wins (batch docs). `refs/api_templates-api.md` **DOC**.
Response = §1.2 response. `refs/api_templates-api.md` **DOC**.

### 1.5 `POST /email/batchWithTemplates`

| Item | Rule | Source |
| --- | --- | --- |
| Body | `{"Messages": [ §1.4 objects ]}` (object, not array) | `refs/api_templates-api.md`; `refs/openapi/server.yml:142-147` **DOC** |
| Max items | 500 → ErrorCode 410 | `refs/api_templates-api.md`; `refs/api_overview.md` **DOC** |
| Response | HTTP 200 array, same order | `refs/api_templates-api.md` **DOC** |

### 1.6 Bulk API

`POST /email/bulk` body. Source: `refs/api_bulk-email.md` **DOC**; not in `refs/openapi/server.yml`.

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `From` | string | yes | Confirmed signature |
| `ReplyTo`, `Subject`, `HtmlBody`, `TextBody` | string | content or template | Mustache `{{var}}` from `TemplateModel` |
| `TemplateId` / `TemplateAlias` | int / string | alt. to content | |
| `InlineCss` | boolean | no | |
| `Tag` | string | no | Max 1000 |
| `Metadata` | object | no | Message-level wins |
| `MessageStream` | string | no | Default: "outbound broadcast stream" |
| `TrackOpens`, `TrackLinks` | | no | As §1.2 |
| `Attachments`, `Headers` | array | no | Message-level `Headers` win |
| `Messages[]` | array | yes | No count limit; 50 MB payload |
| `Messages[].To`/`Cc`/`Bcc` | string | `To` yes | Max 50 each |
| `Messages[].TemplateModel`, `.Metadata`, `.Headers` | | no | |

Responses:

| Case | HTTP | Body | Source |
| --- | --- | --- | --- |
| Accepted | 200 | `{Id, SubmittedAt, Status:"Accepted", TotalMessages, PercentageCompleted, ReleasedCount, FailedCount, Subject?}` | `refs/api_bulk-email.md` **DOC** |
| Any malformed field in any message | 422, whole request rejected, no `Id` | `ErrorCode 11` + `Errors: {Field: [{ErrorCode, Message}]}` | `refs/api_bulk-email.md` **DOC** |
| Account not approved | 422 | `ErrorCode 14`, `"This endpoint requires approval to access. Contact support to use the Bulk API postmarkapp.com/contact"` | `refs/api_bulk-email.md` **DOC** |
| Unknown stream | 422 | ErrorCode 1226 | `refs/api_bulk-email.md` **DOC** |
| Suppressed / render failure | 200 at submit; counted in `FailedCount` later | | `refs/api_bulk-email.md` **DOC** |

`GET /email/bulk` (list): `{Requests: status[], PaginationKey?}`, newest first, this server only. Query `count`, `paginationKey`. Pass the key back unchanged; `PaginationKey` is absent on the last page. A malformed key → HTTP 422, ErrorCode 13. `refs/api_bulk-email.md:318-395,404` **DOC**. No official SDK calls it (no `paginationKey` in `sdk/`). Its `count` range and default are undocumented (Q20).
Account not approved → all three bulk endpoints return 422 / 14. `refs/api_bulk-email.md:409-421` **DOC**
A single validation error returns its own code, not 11. `refs/api_bulk-email.md:406-407` **DOC**
`FailedCount` counts messages with every recipient suppressed, and messages that failed to render. `refs/api_bulk-email.md:303-308` **DOC**. A message with some recipients suppressed: unknown (Q21).

`GET /email/bulk/{id}`: same status object. Other server or unknown id → HTTP 404, ErrorCode 12. Absent values are omitted, not `null`. `Subject` absent if none. `refs/api_bulk-email.md` **DOC**
Status values: `Accepted` `Processing` `Completed` `Cancelled`. `refs/api_bulk-email.md` **DOC**
Invariant: `ReleasedCount + FailedCount ≤ TotalMessages`; equal once `Completed`. `refs/api_bulk-email.md` **DOC**

Disagreements:

| Topic | Docs | SDK |
| --- | --- | --- |
| Status enum | `Cancelled` | `Failed` — `sdk/postmark.js/src/client/models/message/BulkEmail.ts:89-94`; `sdk/postmark-python/postmark/models/outbound/enums.py:36-40` **SDK** |
| POST response fields | full status object | `Id, Status, SubmittedAt` only — `sdk/postmark.js/src/client/models/message/BulkEmail.ts:99-103` **SDK** |
| POST id key | `Id` | python reads `ID` on POST, `Id` on GET — `sdk/postmark-python/postmark/models/outbound/schemas.py:264,276` **SDK** |
| Status counters | `ReleasedCount`, `FailedCount` | absent in postmark.js type — `BulkEmail.ts:109-116` **SDK** |

Resolution (`docs/11` B3): the POST answers the full status object with key `Id`.
The live tests read `Id` and `TotalMessages` from the POST answer: `sdk/postmark.js/test/integration/Sending.test.ts:48-49`; `sdk/postmark-dotnet/src/Postmark.Tests/ClientBulkSendingTests.cs:55-58` **SDK**.
postmark-python's `ID` on POST stays unserved. postmock emits `Cancelled`, the doc value.

### 1.7 Attachments

| Field | Type | Rule | Source |
| --- | --- | --- | --- |
| `Name` | string | File name shown to recipient; extension checked | `refs/user-guide_send-email-with-api_send-a-single-email.md` **DOC** |
| `Content` | string | Base64 | same **DOC** |
| `ContentType` | string | MIME type | same **DOC** |
| `ContentID` | string | `cid:...`; marks inline image; must match `<img src="cid:...">` | same **DOC** |

| Rule | Value | Source |
| --- | --- | --- |
| Forbidden extensions | `vbs exe bin bat chm com cpl crt hlp hta inf ins isp jse lnk mdb pcd pif reg scr sct shs vbe vba wsf wsh wsl msc msi msp mst` | `refs/user-guide_send-email-with-api_send-a-single-email.md` **DOC** |
| Forbidden → | ErrorCode 411 "Attachment file type not allowed", HTTP 422 | `refs/api_overview.md` **DOC** |
| Message size | ≤ 10 MB incl. attachments, measured after base64 | `refs/support_article_1056-what-are-the-attachment-and-email-size-limits.md` **DOC** |
| Stored size | Messages API keeps ≤ 1 MB; longer is truncated | same **DOC** |
| Retrieval | Attachment bytes never returned by API/webhooks | same **DOC** |

The python SDK maps ErrorCode 701 to "Illegal attachment type". `sdk/postmark-python/postmark/exceptions.py:120` **SDK**. The docs say 411, and 701 is "message not found". Trust the docs.

The postmark.js `Attachment` constructor defaults `ContentID` to `null`, so `"ContentID": null` goes on the wire. `sdk/postmark.js/src/client/models/message/SupportingTypes.ts:43,47` **SDK**. The type is `string | null`, so a caller that builds a plain object can send `""`. `SupportingTypes.ts:38` **SDK**. Mock must accept `null`, `""`, and absent as "not inline". **INFERRED**

### 1.8 Address format

| Form | Example | Source |
| --- | --- | --- |
| Bare | `a@b.com` | `refs/api_email-api.md` **DOC** |
| Named | `John Doe <a@b.com>` | `refs/user-guide_send-email-with-api_send-a-single-email.md` **DOC** |
| Quoted name with punctuation | `"\"Joe Receiver, Jr.\" <a@b.com>"` | same **DOC** |
| List | comma-separated; a comma inside quotes is not a separator | same **DOC** (quote rule); separator parse **INFERRED** |

Mock parse rule: split on commas outside double quotes; trim; accept `addr` or `[name] <addr>`. **INFERRED** (python SDK uses regex `<([^>]+)>|([^\s<>"]+@[^\s<>"]+)`, `sdk/postmark-python/postmark/utils/message_utils.py:30` **SDK**).

### 1.9 Non-ASCII content

| Item | Value | Source |
| --- | --- | --- |
| Example input | `Subject: "Café ✓ 【test】"`, `From: "Tëst Sender <sender@example.com>"` | illustration |
| Wire | postmark.js sends `JSON.stringify(body)` as a string body; `fetch` encodes it as UTF-8. `Content-Type: application/json` has no charset. | `sdk/postmark.js/src/client/HttpClient.ts:44`; `BaseClient.ts:109-116` **SDK**; UTF-8 encoding **INFERRED** |
| Length unit | `Subject` ≤ 2000 and `From` ≤ 255 count UTF-16 code units | §1.2 **DOC** |
| Delivered MIME encoding (encoded-word form) | not documented | Q19 |

Mock rule: decode every request body as UTF-8. Count limits in UTF-16 code units. Store and return strings unchanged. Emit response JSON as UTF-8. **INFERRED**

## 2. Batch semantics

Applies to `/email/batch` and `/email/batchWithTemplates`.


| Question | Answer | Source |
| --- | --- | --- |
| HTTP status with per-item errors | 200 | `refs/api_email-api.md`; `refs/api_templates-api.md` **DOC** |
| Result order | Same as request | same **DOC** |
| Error item shape | `{ErrorCode, Message}`; no `MessageID`, `SubmittedAt`, `To`. postmock keeps this shape (`docs/08` E14). | `refs/api_email-api.md` (406 example) **DOC**; `sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:246-249` (MessageID empty GUID) **SDK** |
| Per-item errors seen | 300, 406, 1101 | `refs/api_email-api.md` **DOC**; `ClientTemplateTests.cs:247` **SDK** |
| Whole-request errors | 401 token, 402 invalid JSON, 410 > 500 items, 413 > 50 MB | `refs/api_overview.md` **DOC**; split rule **INFERRED** |
| Stream error 1235 in a batch | Unknown: per item or whole request. postmock answers 501 and sends nothing; no SDK live test asserts either. | open question (Q14) |

## 3. Validation errors

### 3.1 Code table for send endpoints

| ErrorCode | HTTP | Trigger | Exact `Message` (best source) | Source |
| --- | --- | --- | --- | --- |
| 10 | 401 | Bad/missing token | not documented | `refs/api_overview.md` **DOC** |
| 11 | 422 | Bulk: more than one validation error | `Multiple errors occurred. Inspect the Errors property for more information.` | `refs/api_bulk-email.md` **DOC** |
| 300 | 422 | Invalid `From` | `Invalid 'From' address: 'test'.` | `refs/api_bulk-email.md` **DOC** |
| 300 | 422 | Invalid `To` | `Invalid 'To' address: 'test'.` | `refs/api_bulk-email.md` **DOC** |
| 300 | 422 | No `TextBody` and no `HtmlBody` | not documented; SDK integration test sees 300 | `sdk/postmark.js/test/integration/Sending.test.ts:61-71` **SDK** |
| 300 | 422 | Zero recipients; > 50 recipients; metadata, attachment size, header limits | not documented | `refs/api_overview.md` **DOC** |
| 400 | — | Sender signature not found | Not in current code table | open question |
| 401 | — | Sender signature not confirmed | Not in current code table; 401 is an HTTP status for auth | open question |
| 402 | 422 | Invalid JSON | `Invalid JSON.` (table text) | `refs/api_overview.md` **DOC** |
| 403 | 422 | Unknown/invalid field | `Invalid request field(s): 'From'.` | `refs/api_overview.md` **DOC** |
| 406 | 422 | Every recipient inactive | see §3.2 | §3.2 |
| 409 | — | "JSON required" | Not in current code table; HTTP 415 covers missing headers | open question |
| 410 | 422 | Batch > 500 | `You may only send up to 500 messages in a single batched request.` | `refs/api_overview.md` **DOC** |
| 411 | 422 | Forbidden attachment extension | `Attachment file type not allowed.` (table text) | `refs/api_overview.md` **DOC** |
| 412 | 422 | Account pending approval, recipient domain ≠ From domain | `While your account is pending approval, all recipient addresses must share the same domain as the From address.` | `refs/api_overview.md` **DOC** |
| 413 | 422 | Account not approved to send | `This account is not approved to send email.` | `refs/api_overview.md` **DOC** |
| — | 413 | Payload > 10 MB / 50 MB | not documented (HTTP status only) | `refs/api_overview.md` **DOC** |
| 422 | 422 | Invalid server or account | `Invalid Server or Account.` | `refs/api_overview.md` **DOC** |
| 1101 | 422 | No `TemplateId`/`TemplateAlias`, or not found | `The Template's 'Alias' associated with this request is not valid or was not found.` | `sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:248` **SDK** |
| 1109 | 422 | No template data | | `refs/api_overview.md` **DOC** |
| 1120 | 422 | Missing `TemplateModel` etc. | | `refs/api_overview.md` **DOC** |
| 1122 | 422 | Reserved top-level `TemplateModel` key | | `refs/api_overview.md` **DOC** |
| 1123 | 422 | Templated vs non-templated mix | | `refs/api_overview.md` **DOC** |
| 1235 | 422 | Unknown `MessageStream` | `The stream provided: 'unknown-stream' does not exist on this server.` | `sdk/postmark-php/tests/PostmarkClientEmailTest.php:92-93` **SDK**; code `refs/api_overview.md` **DOC** |
| 1236 | 422 | Stream type cannot send (e.g. inbound) | `Sending is not supported for this stream type.` (table text) | `refs/api_overview.md` **DOC** |
| 1480 | 422 | IP not allowlisted | `You are not authorized to send emails from your current IP address: 'IP Address'.` | `refs/api_overview.md` **DOC** |

The fetched code table has no 400, 401, or 409 entries. `refs/api_overview.md` **DOC**. Older Postmark docs used 400 "Sender signature not found", 401 "Sender signature not confirmed", 409 "JSON required". **INFERRED** (memory, no ref). The live code is unknown. Capture it (§8).

"Table text" means the one-line code description. The real `Message` may be longer. **INFERRED**

postmock `Message` texts for the undocumented 300 cases (`src/pipeline/submit.ts`). All **INFERRED** until Q4:

| Case | postmock `Message` |
| --- | --- |
| `From` absent, malformed, or more than one address | `Invalid 'From' address: '<value>'.` (form of the documented `To` text) |
| `To` absent or with no address (also when `Cc` or `Bcc` has one) | `Invalid 'To' address: '<value>'.` |
| `Cc`, `Bcc`, `ReplyTo` malformed | `Invalid '<field>' address: '<value>'.` |
| More than 50 recipients | `Exceeded the maximum of 50 recipients per message.` |
| No `TextBody` and no `HtmlBody` | `Provide either email TextBody or HtmlBody or both.` |
| `From` > 255, `Subject` > 2000, `Tag` > 1000 | `The '<field>' field exceeds the maximum length of <n> characters.` |
| Metadata: > 10 fields, key > 20, value > 80, duplicate key without case | `Metadata may contain at most 10 fields.` and similar, naming the key |

### 3.2 ErrorCode 406 — inactive recipients

| Case | HTTP | ErrorCode | Message | Source |
| --- | --- | --- | --- | --- |
| All recipients inactive (single send) | 422 | 406 | `You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: a@x.com, b@x.com. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression.` | `sdk/postmark.js/test/unit/ErrorHandler.test.ts:113-116`; `sdk/postmark-gem/spec/unit/postmark/error_spec.rb:254-257` **SDK** |
| One batch item, recipient inactive | 200 (item) | 406 | `You tried to send to a recipient that has been marked as inactive. Found inactive addresses: example@example.com. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression. ` (trailing space) | `refs/api_email-api.md` **DOC** |
| Some recipients inactive | unknown | unknown | `Message OK, but will not deliver to these inactive addresses: a@x.com, b@x.com.` | `sdk/postmark-gem/spec/unit/postmark/error_spec.rb:250-252`; `sdk/postmark.js/test/unit/ErrorHandler.test.ts:136` **SDK** |

Notes:

- The doc text "a recipient that has been" is a batch item result (`refs/api_email-api.md:301-313` **DOC**). No doc shows the single-send text. The mock uses the SDK fixture text "recipient(s) that have been" until a capture decides.
- Address list separator is `", "`. postmark.js also accepts `","`. `sdk/postmark.js/test/unit/ErrorHandler.test.ts:160-166` **SDK**
- postmark.js parses with `/Found inactive addresses: (.+?)\.? Inactive/` then `/these inactive addresses: (.+?)\.?$/`, split on `,`, trim. `sdk/postmark.js/src/client/errors/Errors.ts:98-127` **SDK**
- The mock message must match one of these regexes. Otherwise a client that reads `InactiveRecipientsError.recipients` gets an empty list. `sdk/postmark.js/src/client/errors/Errors.ts:109,112-127` **SDK**
- Partial suppression (active `To`, suppressed `Bcc`): HTTP 422 + 406, and the message still goes to the active recipients. **INFERRED**: reported by an application integrator; unverified. The `Message` form ("Found inactive addresses" or "Message OK, but will not deliver…") is open (Q2).
- Each stream has its own suppression list. `refs/user-guide_sandbox-mode_generate-fake-bounces.md:15` ("Stream's Suppression list") **DOC**
- The 406 check reads only the send stream's list. **INFERRED** (`docs/04` Q3).

### 3.3 Check order

No source gives the order. Proposed mock order: token (401) → headers (415) → size (413) → JSON (402) → unknown fields (403) → batch count (410) → per-message: stream (1235/1236) → From signature → address syntax (300) → recipient count (300) → body present (300) → metadata/tag/subject limits (300) → attachments (411, 300) → template (11xx) → suppression (406). **INFERRED**

postmock order (`src/pipeline/submit.ts`): token (401) → JSON (402) → batch count (410) → batch size (413) → per message: field types (403) → size (413) → stream (1235, 1236) → `From` (300) → `To`, `Cc`, `Bcc`, `ReplyTo` syntax (300) → `To` present (300) → recipient count (300) → body present (300) → `From`/`Subject`/`Tag`/metadata limits (300) → attachment extension (411) → end of `validateOutbound`; test token stops here → account approval (413, 412) → suppression (406). postmock does not check `From` against sender signatures (Q3). **INFERRED**

## 4. Test token and sandbox

| Mode | Behavior | Source |
| --- | --- | --- |
| `X-Postmark-Server-Token: POSTMARK_API_TEST` | Validates, never delivers. | `refs/api_overview.md` **DOC** |
| same, success body | `ErrorCode: 0`, `Message: "Test job accepted"`, `MessageID` 36 chars | `sdk/postmark-java/src/test/java/integration/MessageTest.java:27,34-36` **SDK** |
| same, on other endpoints | used for send in gem/rails/java/python test suites | `sdk/postmark-gem/spec/integration/api_client_messages_spec.rb:5`; `sdk/postmark-python/postmark/django/backend.py:33` **SDK** |
| Sandbox server (`DeliveryType: Sandbox`) | Never delivers. Messages show as **Delivered** in UI, webhooks, API. Counts toward volume. Type is fixed at creation. | `refs/user-guide_sandbox-mode_server-sandbox-mode.md` **DOC** |
| Messages API flag | `Sandboxed: true/false`, from server type | `refs/api_messages-api.md` **DOC** |

Black-hole bounce domain `bounce-testing.postmarkapp.com`. Source: `refs/support_article_1239-how-to-test-bounces.md`, `refs/user-guide_sandbox-mode_generate-fake-bounces.md` **DOC**.

| Rule | Value |
| --- | --- |
| Trigger by local part | `<BounceType>@bounce-testing.postmarkapp.com` |
| Trigger by header | `Headers: [{"Name":"X-PM-Bounce-Type","Value":"SoftBounce"}]`, To on the same domain |
| Case | insensitive; `snake_case` works (`hard_bounce`, `soft_bounce`) |
| Default | Unknown local part (e.g. `test@`) → HardBounce |
| HardBounce side effect | Address added to the stream's suppression list; later sends → 406 |
| SpamComplaint | Not supported; becomes HardBounce |
| Timing | "immediately"; still posts webhooks and shows in stats |
| Bounce limits | Not counted |

Supported types: `HardBounce Transient Unsubscribe Subscribe AutoResponder AddressChange DnsError SpamNotification OpenRelayTest Unknown SoftBounce VirusNotification ChallengeVerification BadEmailAddress ManuallyDeactivated Unconfirmed Blocked SMTPApiError InboundError DMARCPolicy TemplateRenderingFailed`. `refs/support_article_1239-how-to-test-bounces.md` **DOC**

The .NET suite also uses `@blackhole.postmarkapp.com` for Cc/Bcc. `sdk/postmark-dotnet/src/Postmark.Tests/ClientSendingTests.cs:120-121` **SDK**. No doc describes that domain.

## 5. After accept

### 5.1 Status and events

| Stage | Values | Source |
| --- | --- | --- |
| Message `Status` (outbound) | `Queued` → `Sent` (= `Processed`) | `refs/api_messages-api.md` **DOC** |
| `MessageEvents[].Type` | `Delivered` `Transient` `Opened` `LinkClicked` `Bounced` `SubscriptionChanged` | `refs/api_messages-api.md` **DOC** |
| Webhook `RecordType` | `Delivery` `Bounce` `Open` `Click` `SpamComplaint` `SubscriptionChange` | `refs/webhooks_*-webhook.md` **DOC** |
| Metadata on events | Returned as strings in webhooks | `refs/support_article_1125-custom-metadata-faq.md` **DOC** |
| Metadata in mail | Never reaches the recipient | same **DOC** |
| Hard bounce → suppression | `SubscriptionChange` with `SuppressionReason: HardBounce`, `Origin: Recipient` | `refs/webhooks_subscription-change-webhook.md` **DOC** |
| Unsubscribe → suppression | `SuppressionReason: ManualSuppression` | same **DOC** |
| Message storage | Body ≤ 1 MB kept; opens kept 45 days | `refs/support_article_1056-what-are-the-attachment-and-email-size-limits.md`; `refs/user-guide_tracking-opens.md` **DOC** |

Payload shapes for events belong to the webhook doc. This doc names only the triggers.

### 5.2 Link tracking

Source: `refs/user-guide_tracking-links.md` **DOC** unless marked.

| Rule | Value |
| --- | --- |
| Values | `None` (default) `HtmlAndText` `HtmlOnly` `TextOnly` |
| Precedence | Message `TrackLinks` overrides server `TrackLinks` |
| Rewrite target | `https://click.pstmrk.it/...` (path format undocumented) |
| Schemes tracked | `http`, `https` only |
| Skip | Malformed / badly URL-encoded links; closing-tag `href`; `<a data-pm-no-track>` (also skips the same URL in TextBody) |
| HTML decoding | Postmark HTML-decodes `href` in HtmlBody before rewrite |
| Account | Unapproved accounts: no links rewritten |
| Click event | `ClickLocation`: `HTML` or `Text`; identical links in both parts = one unique link |
| Server default | `refs/api_server-api.md` (`TrackLinks`) |

### 5.3 Open tracking

Source: `refs/user-guide_tracking-opens.md`, `refs/user-guide_tracking-opens_tracking-opens-per-email.md` **DOC**.

| Rule | Value |
| --- | --- |
| Mechanism | Invisible pixel inserted in HtmlBody |
| No HtmlBody | No pixel, no opens |
| Default | `TrackOpens: false` |
| Server on | Forces `true`; message cannot turn it off |
| Pixel URL / position | Undocumented — capture |

### 5.4 Unsubscribe on broadcast streams

| Rule | Source |
| --- | --- |
| Broadcast streams require unsubscribe handling; default `UnsubscribeHandlingType: Postmark` | `refs/api_message-streams-api.md` **DOC** |
| Transactional streams default `None` | same **DOC** |
| Template placeholder `{{{ pm:unsubscribe }}}`, or `<a href="{{{ pm:unsubscribe }}}">` | `refs/support_article_1077-template-syntax.md` **DOC** |
| Postmark adds a `List-Unsubscribe` header on broadcast sends | not in refs — **INFERRED**; capture |
| Placeholder replaced in non-template `HtmlBody` too | not in refs — **INFERRED**; capture |

A sender on a transactional stream can set its own `List-Unsubscribe` and `List-Unsubscribe-Post` headers through `Headers`. The mock must keep custom headers as given. It must not add its own on a transactional stream. **INFERRED** (Q18)

### 5.5 Other header behavior

| Rule | Source |
| --- | --- |
| Custom `Message-ID` via `Headers` is honored | `refs/user-guide_send-email-with-api_send-a-single-email.md` **DOC** |
| Postmark adds `X-PM-Message-Id: <MessageID>`, `X-PM-Tag: <Tag>` to the raw source | `refs/api_messages-api.md` (dump example) **DOC** |
| `X-PM-Metadata-*`, `X-PM-TrackOpens`, `X-PM-TrackLinks` are SMTP-only controls | `refs/support_article_1125-custom-metadata-faq.md`; `refs/user-guide_tracking-links.md` **DOC** |

## 6. postmark.js 5.1.0 on the wire

Checked-out SDK: `sdk/postmark.js/package.json:12` version `5.1.0`.

| Call | Method + path | Body | Source |
| --- | --- | --- | --- |
| `sendEmail(m)` | `POST /email` | `m` | `sdk/postmark.js/src/client/ServerClient.ts:111-113` **SDK** |
| `sendEmailBatch(ms)` | `POST /email/batch` | `ms` (bare array) | `ServerClient.ts:122-124` **SDK** |
| `sendEmailWithTemplate(t)` | `POST /email/withTemplate` | `t` | `ServerClient.ts:133-135` **SDK** |
| `sendEmailBatchWithTemplates(ts)` | `POST /email/batchWithTemplates` | `{Messages: ts}` (SDK wraps) | `ServerClient.ts:144-147` **SDK** |
| `sendBulkEmail(b)` | `POST /email/bulk` | `b` | `ServerClient.ts:161-163` **SDK** |
| `getBulkEmailStatus(id)` | `GET /email/bulk/${id}` (not URL-encoded), no body | | `ServerClient.ts:172-174` **SDK** |

Transport:

| Item | Behavior | Source |
| --- | --- | --- |
| HTTP stack | global `fetch`, or `clientOptions.fetch` | `sdk/postmark.js/src/client/HttpClient.ts:20-25` **SDK** |
| URL | `${useHttps?"https":"http"}://${requestHost}${path}`; default `https://api.postmarkapp.com` | `sdk/postmark.js/src/client/models/client/HttpClient.ts:9-13,23-26` **SDK** |
| Headers | `X-Postmark-Server-Token`, `Accept: application/json`, `Content-Type: application/json`, `User-Agent: Postmark.JS - 5.1.0` | `sdk/postmark.js/src/client/BaseClient.ts:109-116` **SDK** |
| Body | `JSON.stringify(body)`; `undefined` fields drop; `null` fields stay | `HttpClient.ts:44` **SDK** |
| Timeout | default 180 s via `AbortSignal.timeout`; `clientOptions.timeout` overrides | `models/client/HttpClient.ts:12`; `HttpClient.ts:167-179` **SDK** |
| Token | client throws before any request if empty; value is trimmed | `BaseClient.ts:22-23,123-127` **SDK** |

Client-side validation: none on message fields. No recipient count, size, enum, or 500-item check. `sdk/postmark.js/src/client/ServerClient.ts:111-174` **SDK**. The mock is the only validator.

Model quirks that change the wire:

| Quirk | Wire effect | Source |
| --- | --- | --- |
| `new Message(...)` never assigns `MessageStream` | field absent → server default `outbound` | `sdk/postmark.js/src/client/models/message/Message.ts:22-41` **SDK** |
| `new TemplatedMessage(from, idOrAlias, model, ...)` picks `TemplateId` if number, else `TemplateAlias` | only one key sent | `sdk/postmark.js/src/client/models/templates/Template.ts:137-147` **SDK** |
| `TemplatedMessage` ctor never assigns `Metadata`, `MessageStream`, `InlineCss` | absent unless set after | `Template.ts:137-157` **SDK** |
| `new Attachment(...)` default `ContentID = null`, `ContentLength`/`Disposition` undefined | `"ContentID": null` sent | `sdk/postmark.js/src/client/models/message/SupportingTypes.ts:36-50` **SDK** |
| `Attachment.Disposition`, `ContentLength` typed but undocumented for send | mock must ignore, not 403 | `SupportingTypes.ts:41-42` **SDK**; ignore rule **INFERRED** |

Response handling:

| Server reply | SDK result | Source |
| --- | --- | --- |
| 2xx | parsed JSON; empty body → `{}`; non-JSON → raw text | `sdk/postmark.js/src/client/HttpClient.ts:52-57,113-123` **SDK** |
| non-2xx | `code = body.ErrorCode ?? 0`; `message = body.Message ?? "Request returned status code N"` | `HttpClient.ts:134-140` **SDK** |
| 401 | `InvalidAPIKeyError` | `sdk/postmark.js/src/client/errors/ErrorHandler.ts:34-35` **SDK** |
| 404 | `PostmarkError` | `ErrorHandler.ts:37-38` **SDK** |
| 422 + 406 | `InactiveRecipientsError` (with `.recipients`) | `ErrorHandler.ts:40-41`; `Errors.ts:85-94` **SDK** |
| 422 + 300 | `InvalidEmailRequestError` | same **SDK** |
| 422 other | `ApiInputError` | same **SDK** |
| 429 / 500 / 503 | `RateLimitExceededError` / `InternalServerError` / `ServiceUnavailablerError` | `ErrorHandler.ts:43-50` **SDK** |
| 413, 415, other | `UnknownError` | `ErrorHandler.ts:52-53` **SDK** |
| Network/abort | `PostmarkError`, `statusCode 0` | `HttpClient.ts:47-50,150-156` **SDK** |

The SDK class depends on HTTP status first, ErrorCode second. A 406 with HTTP 200 would not throw, so a client never sees `InactiveRecipientsError` on a single send. `ErrorHandler.ts:32-41` **SDK**

## 7. Mock must

`POST /email`:

- [ ] Serve `POST /email` with the §1.2 request schema and response shape.
- [ ] Return 401 / ErrorCode 10 for a missing or unknown `X-Postmark-Server-Token`; accept `POSTMARK_API_TEST`.
- [ ] Return `Message: "Test job accepted"` and a 36-char UUID for `POSTMARK_API_TEST`; store nothing and fire no events.
- [ ] Return `SubmittedAt` as ISO 8601 with 7 fractional digits and an offset.
- [ ] Return `MessageID` as a fresh lowercase v4 UUID.
- [ ] Default `MessageStream` to `outbound`; return 1235 with `The stream provided: '<id>' does not exist on this server.` for an unknown stream; 1236 for an Inbound stream.
- [ ] Validate `From` against configured signatures/domains; return the capture-confirmed code (§3.1 open).
- [ ] Parse `Name <addr>`, quoted names, and comma lists; return 300 `Invalid 'To' address: '<value>'.` on a bad address.
- [ ] Enforce To+Cc+Bcc ≤ 50, Subject ≤ 2000, From ≤ 255 (UTF-16 units), Tag ≤ 1000 → 300.
- [ ] Require `HtmlBody` or `TextBody` → 300.
- [ ] Enforce Metadata: ≤ 10 keys, key ≤ 20, value ≤ 80, no case-insensitive duplicates → 300.
- [ ] Reject `TrackLinks` outside the enum (code unknown; capture).
- [ ] Check attachment extensions → 411; accept `ContentID` as `null`, `""`, or absent.
- [ ] Enforce body ≤ 5 MB each, message ≤ 10 MB → HTTP 413.
- [ ] Keep a per-stream suppression list; when all recipients are suppressed return HTTP 422, ErrorCode 406, message matching `Found inactive addresses: a, b. Inactive recipients are ...`.
- [ ] For partial suppression, send to active recipients and return the capture-confirmed 406 shape (INFERRED default: 422 / 406).
- [ ] Emit `X-PM-ApiErrorCode` on every error.
- [ ] Apply the §3.3 check order.

`POST /email/batch`:

- [ ] Accept a bare JSON array of §1.2 objects.
- [ ] More than 500 items → whole request 422 / 410.
- [ ] Payload > 50 MB → HTTP 413.
- [ ] Validate each item as `/email`; return HTTP 200 with one result per item, same order.
- [ ] Error item: `{ErrorCode, Message}` only; 406 item uses the batch text "a recipient that has been" (§3.2).
- [ ] Store and fire events only for accepted items.

`POST /email/withTemplate`:

- [ ] Accept §1.2 fields minus `Subject`/`HtmlBody`/`TextBody`, plus `TemplateId` or `TemplateAlias`, `TemplateModel`, `InlineCss` (default `true`).
- [ ] Neither `TemplateId` nor `TemplateAlias`, or no match on this server → 422 / 1101.
- [ ] Both given → use `TemplateId`.
- [ ] Missing `TemplateModel` → 1120; reserved top-level key → 1122; templated plus `Subject`/`HtmlBody`/`TextBody` → 1123 (exact triggers need capture, §3.1).
- [ ] Render `Subject`, `HtmlBody`, `TextBody` with the `docs/06` rules; store the rendered result.
- [ ] Return the §1.2 response.

`POST /email/batchWithTemplates`:

- [ ] Accept `{"Messages": [...]}`; a bare array is a body error (402 or 403; capture).
- [ ] More than 500 items → 422 / 410.
- [ ] Validate each item as `/email/withTemplate`; return HTTP 200 with one result per item, same order (§2).

Bulk:

- [ ] `POST /email/bulk`: validate the whole request first; any malformed field → 422 and no `Id`. One error → its own code; more than one → ErrorCode 11 with `Errors: {Field: [{ErrorCode, Message}]}`.
- [ ] Unknown `MessageStream` → 422 / 1226; absent → the server's default broadcast stream.
- [ ] Merge request-level and message-level `Metadata` and `Headers`; message level wins.
- [ ] Render `{{var}}` from each `Messages[].TemplateModel` for content or hosted template.
- [ ] Return HTTP 200 with the status object: `Id` (UUID string), `SubmittedAt`, `Status: "Accepted"`, `TotalMessages`, `PercentageCompleted: 0`, `ReleasedCount: 0`, `FailedCount: 0`, `Subject` if present.
- [ ] Omit absent properties; never return `null`.
- [ ] Process asynchronously: `Accepted` → `Processing` → `Completed`; a suppressed or unrenderable message counts in `FailedCount`; others in `ReleasedCount`.
- [ ] Keep `ReleasedCount + FailedCount ≤ TotalMessages`; equal once `Completed`.
- [ ] `GET /email/bulk/{id}`: status object; unknown id or another server's id → HTTP 404 / ErrorCode 12.
- [ ] `GET /email/bulk`: newest first; opaque unpadded base64 `PaginationKey`; absent on the last page; a changed key → 422 / 13.
- [ ] Account-level "bulk not approved" switch → 422 / 14 with the §1.6 message on all three endpoints.
- [ ] Allow a test to set `Status: "Cancelled"` (docs) and keep the SDK `Failed` value as open (Q15).

After accept (all send paths):

- [ ] Route `*@bounce-testing.postmarkapp.com` and `X-PM-Bounce-Type` to fake bounces; HardBounce adds a suppression and a `SubscriptionChange`.
- [ ] Move each message `Queued` → `Sent`, then emit `Delivered` (sandbox/default) unless a bounce rule applies.
- [ ] Record `Tag`, `Metadata`, `TrackOpens`, `TrackLinks`, `Headers` on the stored message for the Messages API and webhooks.
- [ ] Rewrite `http(s)` links per `TrackLinks` and insert an open pixel when `TrackOpens` and `HtmlBody`, so opens/clicks APIs have data.
- [ ] On broadcast streams, handle `{{{ pm:unsubscribe }}}` and `List-Unsubscribe` per the Q13 capture.
- [ ] Keep custom headers (for example `List-Unsubscribe`, `List-Unsubscribe-Post`, `Content-Class`) unchanged on transactional streams (until Q18 says otherwise).
- [ ] Decode the body as UTF-8 and count `Subject`/`From` limits in UTF-16 code units (§1.9).
- [ ] Ignore unknown-but-SDK-typed attachment keys (`ContentLength`, `Disposition`).

## 8. Open questions for a live capture

Use the `POSTMARK_API_TEST` token first; use a sandbox server where the test token cannot answer.

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | Exact 406 text for single send. SDK fixture: "recipient(s) that have been"; DOC shows "a recipient that has been" only for a batch item. | Regex in postmark.js fills `InactiveRecipientsError.recipients` |
| 2 | Partial suppression (active To, suppressed Bcc): HTTP status, ErrorCode, Message, and does it still return `MessageID`? | Only an unverified integrator report; SDK has a second regex for "Message OK, but will not deliver" |
| 3 | Codes and messages for unknown `From` and unconfirmed `From` (old 400/401?) | Not in current table |
| 4 | Message text for: no body, zero recipients, > 50 recipients, Subject > 2000, Tag > 1000, Metadata key/value/count, duplicate metadata key | 300 texts undocumented |
| 5 | Invalid `TrackLinks` value on `/email`: 300, 403, or 612? | Code table lists 612 under Servers |
| 6 | Unknown JSON field: ignored or 403? `Content-Type` missing: 415 body? | Field tolerance |
| 7 | Does `POSTMARK_API_TEST` check signature, stream, suppression? What `To` and `SubmittedAt` does it return? Is `MessageID` random? | Mock test-token branch |
| 8 | Response `To` with multiple recipients or a named address: echoed raw? | Response fidelity |
| 9 | `SubmittedAt` zone: server local offset or `Z`? Bulk shows `Z`, email shows `-05:00` | Format |
| 10 | 413 body: JSON with ErrorCode or empty? | SDK message fallback |
| 11 | Attachment `.exe` error message text; is a missing `ContentType` a 300? | 411 text |
| 12 | Pixel URL and insert position; tracked link URL format | Rewrite fidelity |
| 13 | Does a broadcast-stream non-template send get `List-Unsubscribe` added, and is `{{{pm:unsubscribe}}}` replaced in raw `HtmlBody`? | §5.4 |
| 14 | Batch: is 1235 per item or whole request? Does the error item carry `To`? | §2 |
| 15 | Bulk POST response: full status object or `Id/Status/SubmittedAt` only? `Cancelled` vs `Failed`? | §1.6 |
| 16 | Time from accept to `Delivered` / fake `Bounced` webhook on a sandbox server | Mock event timing |
| 17 | Is the `X-PM-ApiErrorCode` header present on 401? | Header rule |
| 18 | Custom `Headers` `Content-Class`, `List-Unsubscribe`, `List-Unsubscribe-Post` on `outbound`: does Postmark keep them as given, rewrite them, or reject the send? Which header names are reserved? | Common sender headers; §5.4 rule is INFERRED |
| 19 | Non-ASCII `Subject` (`Café ✓ 【test】`): accepted as is? Length counted in UTF-16 units? Returned unchanged by the Messages API? Encoded-word form in the delivered MIME? | §1.9 |
| 20 | `GET /email/bulk`: `count` range and default; error for an out-of-range `count` | §1.6; no SDK calls it |
| 21 | Bulk message with some recipients suppressed: counted as released or failed? Active recipients delivered? | §1.6 `FailedCount` rule covers only "every recipient suppressed" |
