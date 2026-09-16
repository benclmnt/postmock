# 05 — Webhooks: what Postmark sends to the customer

Scope: the HTTP requests that Postmark makes to customer URLs.
Scope: the config API that points those requests at a URL.
Sources read: `refs/*.md` and `refs/openapi/*.yml` snapshots of 2026-09-16.
SDK versions: postmark.js 5.1.0, postmark-dotnet 5.4.1, postmark-gem v1.25.1, postmark-python 0.4.0.
No capture exists yet. No claim below is **CAPTURED**.

Marks: **DOC**, **SDK**, **LIB**, **CAPTURED**, **INFERRED** (see `AGENTS.md` rule 6).
"Unverified integrator report" = a claim from receiver code outside Postmark and its SDKs. It is **INFERRED** until a capture confirms it.

---

## 0. Event scope

The mock emits every event type below.

| Event | Config path | Payload | When it fires |
| --- | --- | --- | --- |
| Bounce | `/webhooks` `Triggers.Bounce`, legacy `BounceHookUrl` | §2.1 | §5 |
| SpamComplaint | `/webhooks` `Triggers.SpamComplaint` | §2.2 | §5 |
| Delivery | `/webhooks` `Triggers.Delivery`, legacy `DeliveryHookUrl` | §2.3 | §5 |
| Open | `/webhooks` `Triggers.Open`, legacy `OpenHookUrl` | §2.4 | §5 |
| Click | `/webhooks` `Triggers.Click`, legacy `ClickHookUrl` | §2.5 | §5 |
| SubscriptionChange | `/webhooks` `Triggers.SubscriptionChange` | §2.6 | §5 |
| Inbound | server `InboundHookUrl` only | §2.7, §4 | §5 |
| SMTP API Error | bounce hooks plus server `EnableSmtpApiErrorHooks` | §2.8 | §5 |

Config API endpoints (`/webhooks`, legacy hook fields, `/triggers/inboundrules`) are in scope too (§1).
Per-SDK call lines for these endpoints: `docs/08` §2.

---

## 1. Webhook config API

### 1.1 Endpoints

All endpoints need `X-Postmark-Server-Token`. `refs/api_webhooks-api.md:19` **DOC**
`refs/openapi/server.yml` has no `/webhooks` path and no webhook payload schema. **DOC** (absence)

| Method | Path | Body | Response | Source |
| --- | --- | --- | --- | --- |
| GET | `/webhooks?MessageStream=` | — | `{ "Webhooks": [Webhook] }` | `refs/api_webhooks-api.md:12-130` **DOC** |
| GET | `/webhooks/{Id}` | — | `Webhook` | `refs/api_webhooks-api.md:137-227` **DOC** |
| POST | `/webhooks` | `CreateWebhook` | `Webhook` or 422/1364 | `refs/api_webhooks-api.md:234-471` **DOC** |
| PUT | `/webhooks/{Id}` | `EditWebhook` | `Webhook` or 422/1364 | `refs/api_webhooks-api.md:478-672` **DOC** |
| POST | `/webhooks/{Id}/verify` | — | `VerifyResult` (HTTP 200 even when it fails) | `refs/api_webhooks-api.md:683-735` **DOC** |
| DELETE | `/webhooks/{Id}` | — | `{ "ErrorCode": 0, "Message": "Webhook 1234 removed." }` | `refs/api_webhooks-api.md:741-777` **DOC** |
| GET | `/webhooks/{Id}/statistics` | — | 24 h metrics | `refs/api_webhooks-api.md:786-881` **DOC** |

SDK coverage: postmark.js has list, get, create, edit, delete only (`sdk/postmark.js/src/client/ServerClient.ts:657-703`). **SDK**
No SDK calls `/verify` or `/statistics`. **SDK** (grep across js, python, dotnet, php)
postmark.js sends the list filter as `messageStream` (lower camel) (`sdk/postmark.js/src/client/models/webhooks/WebhookFilteringParameters.ts:5`). The doc uses `MessageStream`. **SDK** vs **DOC** conflict.

### 1.2 `Webhook` object

| Field | Type | Example | Notes | Source |
| --- | --- | --- | --- | --- |
| `ID` | integer | `1234567` | Server assigns | `refs/api_webhooks-api.md:159` **DOC** |
| `Url` | string | `https://www.example.com/webhook-test-tracking` | Required on create | `refs/api_webhooks-api.md:160,295` **DOC** |
| `MessageStream` | string | `outbound` | Default `outbound` on create. Cannot change on edit (1357) | `refs/api_webhooks-api.md:296`, `refs/api_overview.md:214` **DOC** |
| `Status` | string | `verified` \| `unverified` | Read-only (1363) | `refs/api_webhooks-api.md:184`, `refs/api_overview.md:220` **DOC** |
| `HttpAuth` | object \| absent | `{ "Username": "user", "Password": "pass" }` | Optional | `refs/api_webhooks-api.md:162-164` **DOC** |
| `HttpHeaders` | array \| absent | `[{ "Name": "name", "Value": "value" }]` | `Name` must be valid (1358) | `refs/api_webhooks-api.md:165-167`, `refs/api_overview.md:215` **DOC** |
| `Triggers.Open` | object | `{ "Enabled": true, "PostFirstOpenOnly": false }` | | `refs/api_webhooks-api.md:169-171` **DOC** |
| `Triggers.Click` | object | `{ "Enabled": true }` | | `refs/api_webhooks-api.md:172-173` **DOC** |
| `Triggers.Delivery` | object | `{ "Enabled": true }` | | `refs/api_webhooks-api.md:174-175` **DOC** |
| `Triggers.Bounce` | object | `{ "Enabled": false, "IncludeContent": false }` | `IncludeContent` adds `Content` | `refs/api_webhooks-api.md:176-178` **DOC** |
| `Triggers.SpamComplaint` | object | `{ "Enabled": false, "IncludeContent": false }` | `IncludeContent` adds `Content` | `refs/api_webhooks-api.md:179-181` **DOC** |
| `Triggers.SubscriptionChange` | object | `{ "Enabled": true }` | | `refs/api_webhooks-api.md:182-183` **DOC** |

Create and edit also accept `Verify` (boolean, default `true`). `refs/api_webhooks-api.md:306,548` **DOC**
Edit with a partial `Triggers` object changes only the given triggers. `refs/api_webhooks-api.md:541` **DOC**
Edit has no `MessageStream` field. `refs/api_webhooks-api.md:536-548` **DOC**

SDK models:

| SDK | `Status` | `Verify` | Trigger sub-fields | Source |
| --- | --- | --- | --- | --- |
| postmark.js | absent | absent | `PostFirstOpenOnly?`, `IncludeContent?` optional | `sdk/postmark.js/src/client/models/webhooks/Webhook.ts:3-70` **SDK** |
| postmark-python | absent | absent | all required | `sdk/postmark-python/postmark/models/webhooks/schemas.py:18-78` **SDK** |
| postmark-dotnet | absent | absent | — | `sdk/postmark-dotnet/src/Postmark/Model/Webhooks/WebhookConfiguration.cs` **SDK** |

The second list item in the doc example has no `Status` key. `refs/api_webhooks-api.md:90-126` **DOC** (doc inconsistency)

### 1.3 Verification

| Rule | Source |
| --- | --- |
| Create and edit test every enabled trigger. Each must answer 200. | `refs/api_webhooks-api.md:351,591` **DOC** |
| Any failure: HTTP 422, `X-PM-ApiErrorCode: 1364`, nothing saved. | `refs/api_webhooks-api.md:351,377-393` **DOC** |
| `Verify: false` saves the webhook as `unverified`. | `refs/api_webhooks-api.md:358,593` **DOC** |
| An unverified webhook gets no events. | `refs/api_webhooks-api.md:358` **DOC** |
| Persistent failures mark one trigger type unverified and pause only that type. | `refs/webhooks_webhooks-overview.md:16,181` **DOC** |
| Inbound hooks are not verified. | `refs/webhooks_webhooks-overview.md:26` **DOC** |

Verify failure body:

```json
{
  "Id": 354118,
  "Url": "https://example.com/webhooks",
  "Success": false,
  "Results": [
    { "TriggerType": "SpamComplaint", "Success": false, "StatusCode": 500, "Message": "Remote server returned an HTTP status code of 500." }
  ],
  "Message": "4/5 triggers verified successfully"
}
```

Source: `refs/api_webhooks-api.md:381-393` **DOC**
Conflict: the 1364 error text says "send `?verify=false`" (query string). `refs/api_overview.md:221` **DOC**
Conflict: the webhooks page says `Verify` is a body field. `refs/api_webhooks-api.md:306` **DOC**

### 1.4 Errors

| Code | HTTP | Meaning | Source |
| --- | --- | --- | --- |
| 606 | 422 | A legacy hook URL is not valid | `refs/api_overview.md:101` **DOC** |
| 1350 | 422 | Archived `MessageStream` | `refs/api_overview.md:207` **DOC** |
| 1351 | 422 | Inbound stream (use `InboundHookUrl`) | `refs/api_overview.md:208` **DOC** |
| 1352 | 422 | Webhook `ID` not found | `refs/api_overview.md:209` **DOC** |
| 1353 | 422 | Trigger not supported on this stream | `refs/api_overview.md:210` **DOC** |
| 1354 | 422 | `Url` missing or invalid | `refs/api_overview.md:211` **DOC** |
| 1355 | 422 | Empty body | `refs/api_overview.md:212` **DOC** |
| 1356 | 422 | `ID` given on create | `refs/api_overview.md:213` **DOC** |
| 1357 | 422 | `ID` or `MessageStream` changed on edit | `refs/api_overview.md:214` **DOC** |
| 1358 | 422 | Invalid `HttpHeader` `Name` | `refs/api_overview.md:215` **DOC** |
| 1359 | 422 | Maximum webhooks for this stream reached | `refs/api_overview.md:216` **DOC** |
| 1360 | 422 | Cannot update the integration | `refs/api_overview.md:217` **DOC** |
| 1361 | 422 | Invalid field value | `refs/api_overview.md:218` **DOC** |
| 1362 | 422 | Invalid `status` value | `refs/api_overview.md:219` **DOC** |
| 1363 | 422 | `Status` given on create or edit | `refs/api_overview.md:220` **DOC** |
| 1364 | 422 | Verification failed | `refs/api_overview.md:221` **DOC** |

The numeric limit behind 1359 is not in any ref. Open question Q9.
A server has up to 10 streams and one inbound stream. `refs/api_message-streams-api.md:4` **DOC**

### 1.5 Legacy server-level hook URLs

Server token: `GET/PUT /server`. Account token: `/servers/{id}`. `refs/api_server-api.md:10,93`, `refs/api_servers-api.md:10,228` **DOC**

| Field | Type | Event | Status | Source |
| --- | --- | --- | --- | --- |
| `InboundHookUrl` | string | Inbound | Current. The only config path for inbound | `refs/api_server-api.md:41`, `refs/webhooks_inbound-webhook.md:14-18` **DOC** |
| `BounceHookUrl` | string | Bounce | Deprecated on create server | `refs/api_server-api.md:42`, `refs/api_servers-api.md:127` **DOC** |
| `OpenHookUrl` | string | Open | Deprecated on create server | `refs/api_server-api.md:43`, `refs/api_servers-api.md:128` **DOC** |
| `DeliveryHookUrl` | string | Delivery | Deprecated on create server | `refs/api_server-api.md:44`, `refs/api_servers-api.md:129` **DOC** |
| `ClickHookUrl` | string | Click | Deprecated on create server | `refs/api_server-api.md:52`, `refs/api_servers-api.md:136` **DOC** |
| `PostFirstOpenOnly` | boolean | Open | Legacy open filter | `refs/api_server-api.md:45` **DOC** |
| `IncludeBounceContentInHook` | boolean | Bounce | Legacy `Content` switch | `refs/api_server-api.md:51` **DOC** |
| `EnableSmtpApiErrorHooks` | boolean | SMTP API Error | Adds SMTP API errors to bounce hooks | `refs/api_server-api.md:53` **DOC** |
| `RawEmailEnabled` | boolean | Inbound | Adds `RawEmail` to inbound payload | `refs/api_server-api.md:37` **DOC** |
| `InboundSpamThreshold` | integer | Inbound | Blocks inbound above this score | `refs/api_server-api.md:48` **DOC** |

No legacy URL exists for SpamComplaint or SubscriptionChange. `refs/api_server-api.md:30-53` **DOC** (absence)
The relation between legacy URLs and `/webhooks` rows is not documented. Open question Q10.
One inbound stream has one inbound webhook URL. `refs/webhooks_inbound-webhook.md:14` **DOC**

### 1.6 Inbound rules triggers

Rules block inbound mail by sender address or domain. `refs/api_inbound-rules-triggers-api.md:4` **DOC**

| Method | Path | Body / query | Response | Source |
| --- | --- | --- | --- | --- |
| GET | `/triggers/inboundrules` | `count`, `offset` required | `{ "TotalCount": 3, "InboundRules": [{ "ID": 3, "Rule": "someone@example.com" }] }` | `refs/api_inbound-rules-triggers-api.md:10-64` **DOC** |
| POST | `/triggers/inboundrules` | `{ "Rule": "someone@example.com" }` | `{ "ID": 15, "Rule": "someone@example.com" }` | `refs/api_inbound-rules-triggers-api.md:71-124` **DOC** |
| DELETE | `/triggers/inboundrules/{triggerid}` | — | `{ "ErrorCode": 0, "Message": "Rule someone@example.com removed." }` | `refs/api_inbound-rules-triggers-api.md:131-162` **DOC** |

Errors: 800 (over 500 per call), 809 (no trigger data). `refs/api_overview.md:121-122` **DOC**
A blocked sender produces no inbound webhook. **INFERRED**
postmark.js sends the path as `/triggers/inboundRules` (capital R). `sdk/postmark.js/src/client/ServerClient.ts:624,635,647` **SDK**. Other SDK spellings: `docs/08` §2.1.

---

## 2. Payloads per RecordType

### 2.0 Common rules

| Rule | Source |
| --- | --- |
| Outbound event dates are ISO 8601. | `refs/webhooks_webhooks-overview.md:8` **DOC** |
| Doc examples use 7 fraction digits and `Z`: `2026-11-05T16:33:54.9070259Z`. | `refs/webhooks_bounce-webhook.md:82` **DOC** |
| Inbound `Date` is the sender's RFC 2822 `Date` header, not ISO 8601. | `refs/webhooks_inbound-webhook.md:10`, `refs/user-guide_inbound_parse-an-email.md:261` **DOC** |
| `MessageID` is a UUID string: `883953f4-6105-42a2-a16a-77a8eac79483`. | `refs/webhooks_bounce-webhook.md:72` **DOC**; dotnet types it `Guid` (`sdk/postmark-dotnet/src/Postmark/Model/PostmarkBounce.cs:68`) **SDK** |
| `Metadata` values are always strings. | `refs/support_article_1125-custom-metadata-faq.md:75` **DOC** |
| `Metadata` limits: 10 keys, key ≤ 20 chars, value ≤ 80 chars. | `refs/support_article_1125-custom-metadata-faq.md:70-74` **DOC** |
| Every outbound payload has `RecordType` and `MessageStream`. Inbound has no `RecordType`. | §2.1–2.7 examples **DOC** |
| Postmark does not sign payloads. No HMAC. | `refs/webhooks_webhooks-overview.md:102` **DOC** |

Type legend: `?` = key may be absent. `| null` = key present with null.

### 2.1 Bounce

Example: `refs/webhooks_bounce-webhook.md:64-88` **DOC**

```json
{
  "RecordType": "Bounce",
  "MessageStream": "outbound",
  "ID": 692560173,
  "Type": "HardBounce",
  "TypeCode": 1,
  "Name": "Hard bounce",
  "Tag": "Test",
  "MessageID": "883953f4-6105-42a2-a16a-77a8eac79483",
  "Metadata": { "PropA": "some value", "PropB": "some value" },
  "ServerID": 23,
  "Description": "The server was unable to deliver your message (ex: unknown user, mailbox not found).",
  "Details": "Test bounce details",
  "Email": "margareth@nasa.com",
  "From": "alanturing@computers.com",
  "BouncedAt": "2026-11-05T16:33:54.9070259Z",
  "DumpAvailable": true,
  "Inactive": true,
  "CanActivate": true,
  "Subject": "Saying Hello!",
  "Content": "<Full dump of bounce>"
}
```

| Field | Type | Example | Meaning | Source |
| --- | --- | --- | --- | --- |
| `RecordType` | `"Bounce"` | `Bounce` | Discriminator | `refs/webhooks_bounce-webhook.md:65` **DOC** |
| `MessageStream` | string | `outbound` | Stream of the original send | `:66` **DOC** |
| `ID` | integer | `692560173` | Bounce ID for Bounce API calls | `:42,67` **DOC** |
| `Type` | string | `HardBounce` | Bounce type name | `:44,68` **DOC** |
| `TypeCode` | integer | `1` | Bounce type code | `:43,69` **DOC** |
| `Name` | string | `Hard bounce` | Human label | `:70` **DOC** |
| `Tag` | string? | `Test` | Send tag | `:71` **DOC**; optional in `sdk/postmark.js/src/client/models/bounces/Bounce.ts:7` **SDK** |
| `MessageID` | string (UUID) | see example | Original message | `:72` **DOC** |
| `Metadata` | object<string,string> | see example | Send metadata | `:45,73-76` **DOC** |
| `ServerID` | integer | `23` | Server | `:77` **DOC** |
| `Description` | string | canned text | Same text for every bounce of one type | `:78` **DOC**; type table `refs/api_bounce-api.md:393-418` **DOC** |
| `Details` | string | `Test bounce details` | Remote SMTP diagnostic | `:79` **DOC** |
| `Email` | string | `margareth@nasa.com` | Bounced address | `:46,80` **DOC** |
| `From` | string | `alanturing@computers.com` | Original sender | `:47,81` **DOC** |
| `BouncedAt` | string (ISO 8601) | `2026-11-05T16:33:54.9070259Z` | Bounce time | `:48,82` **DOC** |
| `DumpAvailable` | boolean | `true` | Raw dump exists | `:83` **DOC** |
| `Inactive` | boolean | `true` | Address now suppressed | `:49,84` **DOC** |
| `CanActivate` | boolean | `true` | Address can be reactivated | `:50,85` **DOC** |
| `Subject` | string | `Saying Hello!` | Original subject | `:86` **DOC** |
| `Content` | string? | `<Full dump of bounce>` | Only when `IncludeContent` is on | `:51,87` **DOC** |

TypeCode table (full list): `refs/api_bounce-api.md:393-418` **DOC**; enum in `sdk/postmark.js/src/client/models/bounces/Bounce.ts:23-71` **SDK**.
Key codes: 1 HardBounce, 2 Transient, 4096 SoftBounce, 100001 SpamComplaint, 100006 Blocked, 100007 SMTPApiError, 100008 InboundError. **DOC** / **SDK**

Conflicts:

| # | Conflict | Sources |
| --- | --- | --- |
| B1 | Doc shows `CanActivate` always. An unverified integrator report says some payloads omit it. php defaults an absent value to `false`; python requires the key. | `refs/webhooks_bounce-webhook.md:85` **DOC**; `sdk/postmark-php/src/Postmark/Models/PostmarkBounce.php:45`, `sdk/postmark-python/postmark/models/bounces/schemas.py:26` **SDK**; report **INFERRED**; Q14 |
| B2 | dotnet `PostmarkBounceWebhookMessage` has no `MessageStream` and no `Content`. | `sdk/postmark-dotnet/src/Postmark/Model/PostmarkBounceWebhookMessage.cs:9-20`, `PostmarkBounce.cs:8-101` **SDK** |
| B3 | dotnet `ID` is `long`. Doc and JS use integer. | `PostmarkBounce.cs:15` **SDK** |
| B4 | Doc, js and python type `ID` as integer. The mock sends a JSON number. An unverified integrator report says a receiver drops a string `ID`. | `refs/webhooks_bounce-webhook.md:67` **DOC**; `sdk/postmark.js/src/client/models/bounces/Bounce.ts:3`, `sdk/postmark-python/postmark/models/bounces/schemas.py:11` **SDK**; report **INFERRED** |

### 2.2 SpamComplaint

Example: `refs/webhooks_spam-complaint-webhook.md:37-61` **DOC**

```json
{
  "RecordType": "SpamComplaint",
  "MessageStream": "outbound",
  "ID": 692560174,
  "Type": "SpamComplaint",
  "TypeCode": 100001,
  "Name": "Spam complaint",
  "Tag": "welcome-email",
  "MessageID": "883953f4-6105-42a2-a16a-77a8eac79483",
  "Metadata": { "PropA": "some value", "PropB": "some value" },
  "ServerID": 23,
  "Description": "The subscriber explicitly marked this message as spam.",
  "Details": "Test spam complaint details",
  "Email": "margareth@nasa.com",
  "From": "alanturing@computers.com",
  "BouncedAt": "2026-11-05T16:33:54.9070259Z",
  "DumpAvailable": true,
  "Inactive": true,
  "CanActivate": false,
  "Subject": "Saying Hello!",
  "Content": "<Abuse report dump>"
}
```

Fields: identical to Bounce (§2.1). `sdk/postmark.js/src/client/models/webhooks/payload/SpamComplaintWebhook.ts:3-24` **SDK**

| Field | Fixed value | Source |
| --- | --- | --- |
| `RecordType` | `SpamComplaint` | `refs/webhooks_spam-complaint-webhook.md:38` **DOC** |
| `Type` | `SpamComplaint` | `:41` **DOC** |
| `TypeCode` | `100001` | `:42` **DOC** |
| `Inactive` | `true` | `:57` **DOC** |
| `CanActivate` | `false`. Postmark never reactivates a complaint address. | `:6,58` **DOC** |
| `BouncedAt` | complaint time | `:30` **DOC** |
| `Content` | abuse report, only with `IncludeContent` | `:60` **DOC**; `sdk/postmark-dotnet/src/Postmark/Model/PostmarkSpamComplaintWebhookMessage.cs:18-21` **SDK** |

dotnet fixture uses `"Name": "Spam Complaint"` (capital C). Doc uses `Spam complaint`. `sdk/postmark-dotnet/src/Postmark.Tests/WebhookMessageDeserializationTests.cs:67` **SDK** vs **DOC**

### 2.3 Delivery

Example: `refs/webhooks_delivery-webhook.md:40-53` **DOC**

```json
{
  "RecordType": "Delivery",
  "MessageStream": "outbound",
  "ServerID": 23,
  "MessageID": "883953f4-6105-42a2-a16a-77a8eac79483",
  "Recipient": "margareth@nasa.com",
  "Tag": "welcome-email",
  "DeliveredAt": "2026-11-05T16:33:54.9070259Z",
  "Details": "250 2.0.0 OK  1762360434 x12-20020a05 - gsmtp",
  "Metadata": { "PropA": "some value", "PropB": "some value" }
}
```

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `RecordType` | `"Delivery"` | Discriminator | `:41` **DOC** |
| `MessageStream` | string | Stream | `:42` **DOC** |
| `ServerID` | integer | Server | `:43` **DOC** |
| `MessageID` | string (UUID) | Message | `:44` **DOC** |
| `Recipient` | string | One recipient per event | `:8,31,45` **DOC** |
| `Tag` | string? | Send tag | `:32,46` **DOC**; `DeliveryWebhook.ts:9` **SDK** |
| `DeliveredAt` | string (ISO 8601) | Accept time at remote MTA | `:33,47` **DOC** |
| `Details` | string | Remote SMTP response line | `:34,48` **DOC** |
| `Metadata` | object<string,string> | Send metadata | `:35,49-52` **DOC** |

Conflict D1: dotnet maps `ServerID` from JSON key `ServerId`. `sdk/postmark-dotnet/src/Postmark/Model/PostmarkDeliveryWebhookMessage.cs:16-17` **SDK**. Doc key is `ServerID`. Case-sensitive System.Text.Json gets 0. **DOC** vs **SDK**
dotnet Delivery model has no `RecordType` and no `MessageStream`. `PostmarkDeliveryWebhookMessage.cs:11-47` **SDK**

### 2.4 Open

Example: `refs/webhooks_open-tracking-webhook.md:39-74` **DOC**

```json
{
  "RecordType": "Open",
  "MessageStream": "outbound",
  "FirstOpen": true,
  "Client": { "Name": "Chrome 140.0.7339.80", "Company": "Google", "Family": "Chrome" },
  "OS": { "Name": "macOS 26 Tahoe", "Company": "Apple Computer, Inc.", "Family": "macOS" },
  "Platform": "WebMail",
  "UserAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.80 Safari/537.36",
  "ReadSeconds": 5,
  "Geo": {
    "CountryISOCode": "US", "Country": "United States",
    "RegionISOCode": "TX", "Region": "Texas",
    "City": "Houston", "Zip": "77058",
    "Coords": "29.5502,-95.0973", "IP": "203.0.113.42"
  },
  "MessageID": "883953f4-6105-42a2-a16a-77a8eac79483",
  "Metadata": { "PropA": "some value", "PropB": "some value" },
  "ReceivedAt": "2026-11-05T16:33:54.9070259Z",
  "Tag": "welcome-email",
  "Recipient": "margareth@nasa.com"
}
```

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `RecordType` | `"Open"` | Discriminator | `:40` **DOC** |
| `MessageStream` | string | Stream | `:41` **DOC** |
| `FirstOpen` | boolean | First open by this recipient | `:31,42` **DOC** |
| `Client` | `{Name,Company,Family}` strings | Mail client | `:43-47` **DOC**; `sdk/postmark.js/src/client/models/messages/OutboundMessageOpen.ts:1-5` **SDK** |
| `OS` | `{Name,Company,Family}` strings | OS | `:48-52` **DOC** |
| `Platform` | string | e.g. `WebMail` | `:53` **DOC** |
| `UserAgent` | string | Reader UA | `:54` **DOC** |
| `ReadSeconds` | integer | Read duration | `:55` **DOC** |
| `Geo` | object, every key optional | From request IP. May be partial. | `:32,56-65` **DOC**; `OutboundMessageOpen.ts:7-16` **SDK** |
| `MessageID` | string (UUID) | Message | `:66` **DOC** |
| `Metadata` | object<string,string> | Send metadata | `:33,67-70` **DOC** |
| `ReceivedAt` | string (ISO 8601) | Open time | `:34,71` **DOC** |
| `Tag` | string | Send tag | `:72` **DOC** |
| `Recipient` | string | Reader address | `:30,73` **DOC** |

Open has no `ServerID` in doc or JS model. `OutboundMessageOpen.ts:18-31` **SDK**. Asymmetry with Bounce and Delivery.
JS types `Tag` as required `string` for Open and Click. JS types it optional for Delivery. `OutboundMessageOpen.ts:28`, `DeliveryWebhook.ts:9` **SDK**

### 2.5 Click

Example: `refs/webhooks_click-webhook.md:51-86` **DOC**

```json
{
  "RecordType": "Click",
  "MessageStream": "outbound",
  "ClickLocation": "HTML",
  "Client": { "Name": "Chrome 140.0.7339.80", "Company": "Google", "Family": "Chrome" },
  "OS": { "Name": "macOS 26 Tahoe", "Company": "Apple Computer, Inc.", "Family": "macOS" },
  "Platform": "Desktop",
  "UserAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.80 Safari/537.36",
  "OriginalLink": "https://example.com/confirm-your-address",
  "Geo": { "CountryISOCode": "US", "Country": "United States", "RegionISOCode": "TX", "Region": "Texas", "City": "Houston", "Zip": "77058", "Coords": "29.5502,-95.0973", "IP": "203.0.113.42" },
  "MessageID": "883953f4-6105-42a2-a16a-77a8eac79483",
  "Metadata": { "PropA": "some value", "PropB": "some value" },
  "ReceivedAt": "2026-11-05T16:33:54.9070259Z",
  "Tag": "welcome-email",
  "Recipient": "margareth@nasa.com"
}
```

Fields equal Open (§2.4) minus `FirstOpen` and `ReadSeconds`, plus:

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `ClickLocation` | `"HTML"` \| `"Text"` | Body part of the link | `:45,54` **DOC**; `sdk/postmark.js/src/client/models/message/SupportingTypes.ts:8-11` **SDK** |
| `OriginalLink` | string | Link before tracking rewrite | `:44,67` **DOC** |

Click has no `ServerID`. `sdk/postmark.js/src/client/models/messages/OutboundMessageClick.ts:4-18` **SDK**

### 2.6 SubscriptionChange

Example: `refs/webhooks_subscription-change-webhook.md:45-60` **DOC**

```json
{
  "RecordType": "SubscriptionChange",
  "MessageID": "883953f4-6105-42a2-a16a-77a8eac79483",
  "ServerID": 23,
  "MessageStream": "outbound",
  "ChangedAt": "2026-11-05T16:33:54.9070259Z",
  "Recipient": "margareth@nasa.com",
  "Origin": "Recipient",
  "SuppressSending": true,
  "SuppressionReason": "HardBounce",
  "Tag": "welcome-email",
  "Metadata": { "PropA": "some value", "PropB": "some value" }
}
```

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `RecordType` | `"SubscriptionChange"` | Discriminator | `:46` **DOC** |
| `MessageID` | string \| null | null for manual suppression by Customer or Admin, and for reactivation | `:35,47` **DOC** |
| `ServerID` | integer | Server | `:48` **DOC** |
| `MessageStream` | string | Stream | `:49` **DOC** |
| `ChangedAt` | string (ISO 8601) | Change time | `:12,40,50` **DOC** |
| `Recipient` | string | Address | `:51` **DOC** |
| `Origin` | `Recipient` \| `Customer` \| `Admin` | Change origin | `:39,52` **DOC** |
| `SuppressSending` | boolean | `true` = suppressed; `false` = reactivated | `:34,53` **DOC** |
| `SuppressionReason` | `HardBounce` \| `SpamComplaint` \| `ManualSuppression` \| null | null on reactivation. Unsubscribe → `ManualSuppression` | `:36-38,54` **DOC** |
| `Tag` | string \| null | null on reactivation | `:38,55` **DOC** |
| `Metadata` | object<string,string> | `{}` on reactivation | `:38,56-59` **DOC** |

Conflict S1: postmark.js types `MessageID` and `SuppressionReason` as non-null `string`. `sdk/postmark.js/src/client/models/webhooks/payload/SubscriptionChangeWebhook.ts:4,12` **SDK** vs **DOC**
dotnet fixture for reactivation: `SuppressionReason: null`, `Tag: null`, `Metadata: {}`. `sdk/postmark-dotnet/src/Postmark.Tests/WebhookMessageDeserializationTests.cs:136-149` **SDK** (agrees with DOC)

### 2.7 Inbound

Example: `refs/webhooks_inbound-webhook.md:31-101` **DOC**. Longer example: `refs/user-guide_inbound_parse-an-email.md:65-163` **DOC**.

```json
{
  "FromName": "Alan Turing",
  "MessageStream": "inbound",
  "From": "alanturing@computers.com",
  "FromFull": { "Email": "alanturing@computers.com", "Name": "Alan Turing", "MailboxHash": "" },
  "To": "\"Margaret Hamilton\" <yourhash+SampleHash@inbound.postmarkapp.com>",
  "ToFull": [{ "Email": "yourhash+SampleHash@inbound.postmarkapp.com", "Name": "Margaret Hamilton", "MailboxHash": "SampleHash" }],
  "Cc": "\"Katherine Johnson\" <katherine@nasa.com>, <dorothy@nasa.com>",
  "CcFull": [
    { "Email": "katherine@nasa.com", "Name": "Katherine Johnson", "MailboxHash": "" },
    { "Email": "dorothy@nasa.com", "Name": "", "MailboxHash": "" }
  ],
  "Bcc": "\"Mary Jackson\" <mary@nasa.com>",
  "BccFull": [{ "Email": "mary@nasa.com", "Name": "Mary Jackson", "MailboxHash": "" }],
  "OriginalRecipient": "yourhash+SampleHash@inbound.postmarkapp.com",
  "Subject": "Saying Hello!",
  "MessageID": "883953f4-6105-42a2-a16a-77a8eac79483",
  "ReplyTo": "alanturing@computers.com",
  "MailboxHash": "SampleHash",
  "Date": "Thu, 5 Nov 2026 16:33:54 -0500",
  "TextBody": "This is a test text body.",
  "HtmlBody": "<html><body><p>This is a test html body.</p></body></html>",
  "StrippedTextReply": "This is the reply text",
  "Tag": "welcome-email",
  "Headers": [
    { "Name": "X-Spam-Status", "Value": "No" },
    { "Name": "X-Spam-Score", "Value": "-0.1" },
    { "Name": "X-Spam-Tests", "Value": "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU,SPF_PASS" }
  ],
  "Attachments": [
    { "Name": "test.txt", "Content": "VGhpcyBpcyBhdHRhY2htZW50IGNvbnRlbnRzLCBiYXNlLTY0IGVuY29kZWQu", "ContentType": "text/plain", "ContentLength": 45 }
  ]
}
```

See §4 for field detail and inbound rules.

### 2.8 SMTP API Error

| Fact | Source |
| --- | --- |
| Postmark raises it when an SMTP send targets a suppressed recipient. | `refs/webhooks_smtp-api-error.md:6` **DOC** |
| SMTP only. API sends return the error in the API response. | `refs/webhooks_smtp-api-error.md:8` **DOC** |
| Enable per server with `EnableSmtpApiErrorHooks: true` (account token, `PUT /servers/{id}`). | `refs/webhooks_smtp-api-error.md:12-24` **DOC** |
| The setting "includes SMTP API Errors with bounce webhooks". | `refs/api_server-api.md:53` **DOC** |
| The doc page shows no JSON payload. | `refs/webhooks_smtp-api-error.md:27-31` **DOC** (absence) |
| Payload is a Bounce payload with `Type: "SMTPApiError"`, `TypeCode: 100007`. | `refs/api_bounce-api.md:415` **DOC** + **INFERRED** |

---

## 3. Delivery mechanics

### 3.1 Request shape

| Item | Value | Source |
| --- | --- | --- |
| Method | `POST` | `refs/webhooks_webhooks-overview.md:6` **DOC** |
| Body | one JSON object | every example; `refs/webhooks_delivery-webhook.md:8` **DOC** |
| `Content-Type` | `application/json` (charset unknown) | curl examples, `refs/webhooks_bounce-webhook.md:100` **DOC**; exact header value: Q1 |
| `User-Agent` | not documented | Q2 |
| Batching | none. One event per request. | `refs/webhooks_delivery-webhook.md:8`, `refs/webhooks_click-webhook.md:10` **DOC** + **INFERRED** |
| `X-PM-Retries-Remaining` | integer, attempts left. On every request. | `refs/webhooks_webhooks-overview.md:177` **DOC** |
| `X-PM-Webhook-Trace-Id` | stable across retries of one event | `refs/webhooks_webhooks-overview.md:185` **DOC** |
| Trace-Id presence | "when available" | `refs/webhooks_bounce-webhook.md:134` **DOC** (conflicts with "each delivery carries", overview:185) |
| Signature | none | `refs/webhooks_webhooks-overview.md:102` **DOC** |
| Custom headers | each `HttpHeaders[]` item as a header | `refs/api_webhooks-api.md:165-167,298` **DOC** |

### 3.2 Authentication

| Method | Behavior | Source |
| --- | --- | --- |
| Userinfo in URL | `https://<username>:<password>@example.com/webhook` | `refs/webhooks_webhooks-overview.md:38-42` **DOC** |
| `HttpAuth` object | username and password on the webhook row | `refs/api_webhooks-api.md:162-164,297` **DOC** |
| Wire form | `Authorization: Basic base64(user:pass)` | RFC 7617 **INFERRED**; Q18 |
| Query token | Postmark keeps the query string of the URL, e.g. `https://example.com/hook?token=<secret>` | unverified integrator report **INFERRED**; Q18 |
| Both userinfo and `HttpAuth` | precedence not documented | Q3 |

### 3.3 Network

| Item | Value | Source |
| --- | --- | --- |
| Source IPs | listed in support article 800. The article is not in `refs/`. | `refs/webhooks_webhooks-overview.md:24,34` **DOC**; Q4 |
| Source IP per attempt | can change | `refs/webhooks_webhooks-overview.md:34` **DOC** |
| Redirects | followed, up to 10 hops. Final response decides. | `refs/webhooks_webhooks-overview.md:164` **DOC** (outbound page) |
| Timeout, inbound | 2 minutes | `refs/user-guide_inbound_parse-an-email.md:12` **DOC** |
| Timeout, outbound | not documented | Q5 |
| Timeout, outbound, integrator belief | ~10 s | unverified integrator report **INFERRED**; Q5 |

### 3.4 Response classes — outbound events

Scope: Delivery, Bounce, SpamComplaint, Open, Click, SubscriptionChange. `refs/webhooks_webhooks-overview.md:149` **DOC**

| Response | Result | Source |
| --- | --- | --- |
| 2xx | success | "return a non-2xx status so Postmark retries" `refs/webhooks_webhooks-overview.md:106`; `refs/webhooks_bounce-webhook.md:134` **DOC** |
| 3xx | follow redirect (≤ 10) | `refs/webhooks_webhooks-overview.md:164` **DOC** |
| 408, 429 | retry | `refs/webhooks_webhooks-overview.md:156-157` **DOC** |
| 5xx | retry | `refs/webhooks_webhooks-overview.md:155` **DOC** |
| timeout, connect failure | retry | `refs/webhooks_webhooks-overview.md:158` **DOC** |
| other 4xx (400, 401, 403, 404, 405, 410, 422) | drop. No retry. | `refs/webhooks_webhooks-overview.md:160-162` **DOC** |

Verification needs exactly 200 per trigger. `refs/webhooks_webhooks-overview.md:12`, `refs/api_webhooks-api.md:351` **DOC**
Conflict R1: live events accept 2xx. Verification wants 200. Does 204 pass verification? Q6.

### 3.5 Retry schedule — outbound events

Source: `refs/webhooks_webhooks-overview.md:166-175` **DOC**. Same for every outbound type.

| Retry | Delay after previous | Cumulative after first failure |
| --- | --- | --- |
| 1 | 1 min | 1 min |
| 2 | 5 min | 6 min |
| 3 | 10 min | 16 min |
| 4 | 10 min | 26 min |
| 5 | 10 min | 36 min |
| 6 | 15 min | 51 min |

After retry 6 fails, Postmark drops the event. `refs/webhooks_webhooks-overview.md:166` **DOC**
The doc says the back-off "escalates" and is quick for a webhook "that has been delivering normally". The table has no second tier. `refs/webhooks_webhooks-overview.md:166` **DOC**; Q7
The six rows equal the first six inbound rows (§3.6). The outbound table may be truncated. **INFERRED**; Q7
An unverified integrator report says outbound retries continue "over hours". **INFERRED** (conflicts with 51 min); Q7
First value of `X-PM-Retries-Remaining` is 6. **INFERRED** from table; Q8

Persistent failure across many events pauses one trigger type. Threshold not documented. `refs/webhooks_webhooks-overview.md:181` **DOC**; Q11

### 3.6 Response classes and retries — inbound

| Response | Result | Source |
| --- | --- | --- |
| 200 | success | `refs/webhooks_inbound-webhook.md:189` **DOC** |
| 403 | stop retries | `refs/webhooks_inbound-webhook.md:189`, `refs/user-guide_inbound_parse-an-email.md:12` **DOC** |
| any other non-200 (includes 201, 204, 400, 401, 404, 5xx) | retry | `refs/user-guide_inbound_parse-an-email.md:12` "when a hook returns a non-200 code" **DOC** |

Conflict R2: inbound text says non-200 retries. A receiver that answers 204 on success is then retried 10 times, if Postmark reads the text literally. **INFERRED**; Q6 (top priority).
Conflict R3: outbound drops 400/401/404. Inbound retries them. Only 403 stops inbound. **DOC** vs **DOC**

Inbound schedule: 10 retries. `refs/webhooks_inbound-webhook.md:189-198` **DOC**

| Retry | Delay after previous | Cumulative after first failure |
| --- | --- | --- |
| 1 | 1 min | 1 min |
| 2 | 5 min | 6 min |
| 3 | 10 min | 16 min |
| 4 | 10 min | 26 min |
| 5 | 10 min | 36 min |
| 6 | 15 min | 51 min |
| 7 | 30 min | 1 h 21 min |
| 8 | 1 h | 2 h 21 min |
| 9 | 2 h | 4 h 21 min |
| 10 | 6 h | 10 h 21 min |

After retry 10 fails, the message shows as "Inbound Error". `refs/webhooks_inbound-webhook.md:200` **DOC**
Bounce type `InboundError` (100008) means "Unable to deliver inbound message to destination inbound hook". `refs/api_bounce-api.md:416` **DOC**
Manual retry: `PUT /messages/inbound/{messageid}/retry`. `refs/api_messages-api.md:562-566` **DOC**
Whether `X-PM-Retries-Remaining` and `X-PM-Webhook-Trace-Id` appear on inbound requests: not documented. Q8

### 3.7 Ordering and duplicates

| Item | Value | Source |
| --- | --- | --- |
| Duplicates | yes. Retries and slow-but-successful responses cause repeats. | `refs/webhooks_webhooks-overview.md:185` **DOC** |
| Dedup key, doc advice | `X-PM-Webhook-Trace-Id`, else `MessageID` | `refs/webhooks_webhooks-overview.md:185` **DOC** |
| Dedup key, Delivery | `MessageID` is not unique. Use `MessageID`+`Recipient`+`DeliveredAt`. | `refs/webhooks_delivery-webhook.md:88` **DOC** |
| Dedup key, Bounce | `MessageID`+`Email`+`BouncedAt` | `refs/webhooks_bounce-webhook.md:136` **DOC** |
| Ordering | not documented. A retried event can arrive after a later event. | **INFERRED**; Q12 |

### 3.8 Test sends

| Mechanism | Payload | Source |
| --- | --- | --- |
| Verify on create or edit, or `POST /webhooks/{Id}/verify` | one request per enabled trigger. Body not documented. | `refs/webhooks_webhooks-overview.md:12-22`, `refs/api_webhooks-api.md:677` **DOC**; Q13 |
| UI "Verify webhook" button | same as verify | `refs/webhooks_webhooks-overview.md:20` **DOC** |
| UI "Send test" button | not in any ref | Q13 |
| Inbound test | none from Postmark. Doc tells the customer to run curl. | `refs/webhooks_inbound-webhook.md:18,104-185` **DOC** |
| Fake bounce | send to `<type>@bounce-testing.postmarkapp.com` or header `X-PM-Bounce-Type`. Real Bounce webhook fires. | `refs/user-guide_sandbox-mode_generate-fake-bounces.md:5-17`, `refs/support_article_1239-how-to-test-bounces.md:3` **DOC** |
| Fake spam complaint | not supported. Falls back to HardBounce. | `refs/support_article_1239-how-to-test-bounces.md:77` **DOC** |
| Sandbox server | messages show as Delivered in webhooks | `refs/user-guide_sandbox-mode_server-sandbox-mode.md:3` **DOC** |

---

## 4. Inbound

### 4.1 Configuration and trigger

| Fact | Source |
| --- | --- |
| Config: `InboundHookUrl` on the server, or inbound stream Settings in UI. | `refs/webhooks_inbound-webhook.md:14-18` **DOC** |
| `/webhooks` cannot target an inbound stream (1351). | `refs/api_overview.md:208` **DOC** |
| Address: `<InboundHash>@inbound.postmarkapp.com`, or an inbound domain via MX. | `refs/user-guide_inbound_parse-an-email.md:4`, `refs/webhooks_inbound-webhook.md:6` **DOC** |
| Postmark POSTs "immediately" on receipt. | `refs/user-guide_inbound_parse-an-email.md:8` **DOC** |
| Inbound rules block senders by address or domain. | `refs/api_inbound-rules-triggers-api.md:4` **DOC** |
| `InboundSpamThreshold` blocks messages above that score. | `refs/api_server-api.md:48` **DOC** |
| Blocked mail gets no webhook. | **INFERRED** |
| Inbound has no `HttpAuth` field. Receiver auth is URL userinfo or a query token, e.g. `https://example.com/inbound?token=<secret>`. | `refs/api_server-api.md:41` **DOC** (absence); query token **INFERRED**; Q18 |

### 4.2 Fields

| Field | Type | Example | Meaning | Source |
| --- | --- | --- | --- | --- |
| `From` | string | `alanturing@computers.com` | Legacy sender string | `refs/webhooks_inbound-webhook.md:34`; legacy note `refs/user-guide_inbound_parse-an-email.md:186-190` **DOC** |
| `FromName` | string | `Alan Turing` | Sender name | `refs/webhooks_inbound-webhook.md:32` **DOC** |
| `FromFull` | `{Email, Name, MailboxHash}` | see §2.7 | Parsed sender | `refs/user-guide_inbound_parse-an-email.md:168-181` **DOC** |
| `To` | string | `"Margaret Hamilton" <yourhash+SampleHash@…>` | Legacy, comma-separated | `refs/user-guide_inbound_parse-an-email.md:188-190` **DOC** |
| `ToFull` | array of `{Email, Name, MailboxHash}` | see §2.7 | Parsed To list | `refs/user-guide_inbound_parse-an-email.md:172` **DOC** |
| `Cc` | string | `"Katherine Johnson" <katherine@nasa.com>, <dorothy@nasa.com>` | Legacy Cc | `refs/webhooks_inbound-webhook.md:48` **DOC** |
| `CcFull` | array of `{Email, Name, MailboxHash}` | see §2.7 | Parsed Cc | `refs/webhooks_inbound-webhook.md:49-60` **DOC** |
| `Bcc` | string | `"Mary Jackson" <mary@nasa.com>` | Only in rules below | `refs/webhooks_inbound-webhook.md:61` **DOC** |
| `BccFull` | array | see §2.7 | Only in rules below | `refs/user-guide_inbound_parse-an-email.md:265-270` **DOC** |
| `OriginalRecipient` | string | `yourhash+SampleHash@inbound.postmarkapp.com` | RCPT TO for this delivery | `refs/webhooks_inbound-webhook.md:69`; `refs/api_messages-api.md:412` **DOC** |
| `Subject` | string | `Saying Hello!` | Subject | `:70` **DOC** |
| `MessageID` | string (UUID) | `883953f4-…` | Postmark inbound message ID | `:71` **DOC** |
| `ReplyTo` | string | `alanturing@computers.com` | Reply-To header | `:72` **DOC** |
| `MailboxHash` | string | `SampleHash` | Text after `+` in the local part. `""` if none. | `refs/webhooks_inbound-webhook.md:24,73`; `refs/user-guide_inbound_parse-an-email.md:58-60` **DOC** |
| `Date` | string (RFC 2822) | `Thu, 5 Nov 2026 16:33:54 -0500` | Sender `Date` header, sender time zone | `refs/user-guide_inbound_parse-an-email.md:261` **DOC** |
| `TextBody` | string | `This is a test text body.` | Plain part | `:75` **DOC** |
| `HtmlBody` | string | `<html>…</html>` | HTML part | `:76` **DOC** |
| `StrippedTextReply` | string | `This is the reply text` | Reply text only. Needs `In-Reply-To` or `References` and a plain part. English only. | `refs/user-guide_inbound_parse-an-email.md:52-56` **DOC** |
| `Tag` | string | `""` or `welcome-email` | Tag | `refs/user-guide_inbound_parse-an-email.md:112`, `refs/webhooks_inbound-webhook.md:78` **DOC** |
| `MessageStream` | string | `inbound` | Inbound stream ID | `refs/webhooks_inbound-webhook.md:33` **DOC** |
| `Headers` | array of `{Name, Value}` | see below | All original headers plus spam and SPF headers | `refs/user-guide_inbound_parse-an-email.md:10,113-146` **DOC** |
| `Attachments` | array, always present | see below | Base64 content | `refs/user-guide_inbound_parse-an-email.md:200-206` **DOC** |
| `RawEmail` | string? | — | Only when server `RawEmailEnabled` | `refs/api_server-api.md:37` **DOC**; `sdk/postmark.js/src/client/models/webhooks/payload/InboundWebhook.ts:22` **SDK** |

Bcc rules. `refs/user-guide_inbound_parse-an-email.md:265-270` **DOC**

| Case | Bcc in JSON |
| --- | --- |
| Inbound address is Bcc only | yes |
| Inbound address is both To and Bcc | no, To only |
| Inbound address is To, another address is Bcc | no |
| Bcc is the inbound forwarding address or domain, different from To | yes |

Attachment object:

| Field | Type | Example | Source |
| --- | --- | --- | --- |
| `Name` | string | `myimage.png` | `refs/user-guide_inbound_parse-an-email.md:149` **DOC** |
| `Content` | string (base64) | `VGhpcyBp…` | `:150`, `refs/webhooks_inbound-webhook.md:96` **DOC** |
| `ContentType` | string | `image/png` | `:151` **DOC** |
| `ContentLength` | integer (decoded bytes) | `4096` | `:152` **DOC**; `45` for a 45-byte file, `refs/webhooks_inbound-webhook.md:96-98` **DOC** |
| `ContentID` | string | `myimage.png@01CE7342.75E71F80` or `""` | `:153,160` **DOC** |

Total inbound attachment size ≤ 35 MB. `refs/user-guide_inbound_parse-an-email.md:206` **DOC**

Spam and SPF headers. `refs/user-guide_inbound_parse-an-email.md:208-257` **DOC**

| Header | Value form |
| --- | --- |
| `X-Spam-Checker-Version` | `SpamAssassin 3.3.1 (2010-03-16) on <host>` |
| `X-Spam-Status` | `Yes` \| `No` |
| `X-Spam-Score` | decimal string, e.g. `-0.1`. Above 5 is spam by default. |
| `X-Spam-Tests` | comma list, e.g. `DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU,SPF_PASS` |
| `Received-SPF` | `neutral` \| `pass` \| `softfail` \| `fail`, with detail text |

Spam headers can be absent or partial. `refs/user-guide_inbound_parse-an-email.md:219` **DOC**

### 4.3 Inbound conflicts

| # | Conflict | Sources |
| --- | --- | --- |
| I1 | `ContentID` absent in inbound-webhook example. Present in parse-an-email example. | `refs/webhooks_inbound-webhook.md:94-99` vs `refs/user-guide_inbound_parse-an-email.md:153` **DOC** |
| I2 | JS `Attachment` has `ContentID: string \| null`, `ContentLength?`, `Disposition?`. | `sdk/postmark.js/src/client/models/message/SupportingTypes.ts:36-42` **SDK** |
| I3 | dotnet inbound model has `Metadata`. Docs and JS do not. | `sdk/postmark-dotnet/src/Postmark/Model/PostmarkInboundWebhookMessage.cs:126` **SDK** |
| I4 | Attachment example in parse-an-email has top-level `"Dump": null` and `From` as `"Name" <addr>`. | `refs/user-guide_inbound_parse-an-email.md:235-238` **DOC** |
| I5 | gem defaults `from_full`, `to_full`, `cc_full`, `headers`, `attachments` when absent, not `bcc_full`. Absence is tolerated by the gem. | `sdk/postmark-gem/lib/postmark/inbound.rb:8-12` **SDK** |
| I6 | gem fixture `FromFull`/`ToFull` items have no `MailboxHash`. | `sdk/postmark-gem/spec/unit/postmark/inbound_spec.rb:5` **SDK** |
| I7 | Inbound retry: non-200 retries, 403 stops. Outbound: non-2xx retries, all 4xx drop. | §3.4 vs §3.6 **DOC** |

---

## 5. When each event fires

| Event | Fires when | Gate on the message | Gate on the webhook | Source |
| --- | --- | --- | --- | --- |
| Delivery | Remote MTA returns OK. One event per recipient. | none | `Triggers.Delivery.Enabled` | `refs/webhooks_delivery-webhook.md:8-10` **DOC** |
| Delivery (sandbox server) | Message goes to black hole. Shows as Delivered. | server `DeliveryType: Sandbox` | same | `refs/user-guide_sandbox-mode_server-sandbox-mode.md:3` **DOC** |
| Bounce | Postmark processes the bounce report. | none | `Triggers.Bounce.Enabled`; `IncludeContent` adds `Content` | `refs/webhooks_bounce-webhook.md:8,51` **DOC** |
| Bounce (test) | Send to `bounce-testing.postmarkapp.com`. Bounces "immediately". | recipient domain or `X-PM-Bounce-Type` | same | `refs/support_article_1239-how-to-test-bounces.md:3,33` **DOC** |
| SpamComplaint | Recipient marks the message as spam. Address becomes inactive. | none | `Triggers.SpamComplaint.Enabled`; `IncludeContent` | `refs/webhooks_spam-complaint-webhook.md:6` **DOC** |
| Open | Recipient client loads the tracking pixel. | `TrackOpens: true` on message, or server `TrackOpens`. HTML body only. Images not blocked. | `Triggers.Open.Enabled` | `refs/user-guide_tracking-opens.md:4,14-18`, `refs/user-guide_tracking-opens_tracking-opens-per-email.md:4-5` **DOC** |
| Open, repeat | Every open when `PostFirstOpenOnly: false`. First open only when `true`. | same | `Triggers.Open.PostFirstOpenOnly` | `refs/webhooks_open-tracking-webhook.md:8`, `refs/api_webhooks-api.md:171` **DOC** |
| Open, server override | Server `TrackOpens` on forces `TrackOpens: true` on every message. | server | — | `refs/user-guide_tracking-opens_tracking-opens-per-email.md:5` **DOC** |
| Open, Apple Mail MPP | False-positive opens occur. | — | — | `refs/user-guide_tracking-opens.md:22` **DOC** |
| Click | First click of one link by one recipient within retention (default 45 days). | `TrackLinks` ≠ `None` (message overrides server). Link is `http`/`https`, well-formed, no `data-pm-no-track`. Account approved. | `Triggers.Click.Enabled` | `refs/webhooks_click-webhook.md:10-16`, `refs/user-guide_tracking-links.md:12-40` **DOC** |
| Click, `HtmlAndText` | Same link in both parts counts as one unique click. | `TrackLinks: HtmlAndText` | same | `refs/user-guide_tracking-links.md:29` **DOC** |
| SubscriptionChange | Address added to or removed from a stream suppression list. | none | `Triggers.SubscriptionChange.Enabled` | `refs/webhooks_subscription-change-webhook.md:6-8` **DOC** |
| SubscriptionChange after HardBounce or SpamComplaint | Suppression add also fires SubscriptionChange. | none | both triggers | `refs/webhooks_subscription-change-webhook.md:6,16` **DOC** + **INFERRED** order; Q12 |
| Inbound | Mail arrives at the inbound address. | not blocked by rule or spam threshold | `InboundHookUrl` set | `refs/user-guide_inbound_parse-an-email.md:8` **DOC** |
| SMTP API Error | SMTP send to a suppressed recipient. | SMTP only | server `EnableSmtpApiErrorHooks` | `refs/webhooks_smtp-api-error.md:6-12` **DOC** |

No event fires for an unverified webhook or a paused trigger type. `refs/api_webhooks-api.md:358`, `refs/webhooks_webhooks-overview.md:16` **DOC**
Postmark stores only the first open. Webhook with `PostFirstOpenOnly: false` is the only source of every open. `refs/webhooks_open-tracking-webhook.md:8`, `refs/api_messages-api.md:753` **DOC**

---

## 6. Mock must

The mock emits every event type in §0. A control-API command creates the event; the mock then sends it.
The mock never waits on a wall clock. A control command advances a virtual clock for retries.

Config API (`/webhooks`, §1.1–1.4):
- [ ] Serve list, get, create, edit, delete, `verify` and `statistics` with server-token auth.
- [ ] Match the list filter as `MessageStream` and `messageStream` (§1.1 conflict).
- [ ] Default `MessageStream` to `outbound` on create. Reject an inbound stream (1351), an archived stream (1350), a missing or bad `Url` (1354).
- [ ] Reject `ID` on create (1356), `ID` or `MessageStream` change on edit (1357), `Status` on create or edit (1363), a bad header `Name` (1358), an unknown `ID` (1352).
- [ ] Edit with a partial `Triggers` object changes only the given triggers.
- [ ] Verify on create and edit unless `Verify: false`: one probe per enabled trigger; any non-200 → HTTP 422, 1364, nothing saved. Q6, Q13, Q16.
- [ ] Save `Verify: false` rows as `unverified`. Send no events to an unverified row.
- [ ] `POST /webhooks/{Id}/verify` answers HTTP 200 with the §1.3 body, also on failure.
- [ ] `GET /webhooks/{Id}/statistics` counts attempts from the attempt log over the last 24 virtual hours. Slow thresholds: Q19.
- [ ] 1359 limit: crash until Q9 gives the number.

Legacy hook fields (`GET/PUT /server`, `/servers/{id}`, §1.5):
- [ ] Store `InboundHookUrl`, `BounceHookUrl`, `OpenHookUrl`, `DeliveryHookUrl`, `ClickHookUrl`, `PostFirstOpenOnly`, `IncludeBounceContentInHook`, `EnableSmtpApiErrorHooks`, `RawEmailEnabled`, `InboundSpamThreshold`.
- [ ] Reject an invalid legacy URL with 606.
- [ ] Send events to legacy URLs as well as to `/webhooks` rows. Whether one shows up as the other: Q10.

Inbound rules (`/triggers/inboundrules`, §1.6):
- [ ] Serve list (`count`, `offset` required), create, delete. Match the path case-insensitively (`inboundRules`).
- [ ] Errors 800 and 809.
- [ ] Drop inbound mail from a blocked address or domain. Send nothing.

Request shape (every emit):
- [ ] Method `POST`. Body is one JSON object. No batching.
- [ ] `Content-Type: application/json`. Exact value: Q1.
- [ ] Move URL userinfo into `Authorization: Basic base64(user:pass)`. Strip userinfo from the request URL. Send `HttpAuth` the same way. Q3, Q18.
- [ ] Keep the URL query string exactly (`?token=…`). Q18.
- [ ] Send each `HttpHeaders[]` item.
- [ ] Send `X-PM-Webhook-Trace-Id` (UUID), stable across retries of one event.
- [ ] Send `X-PM-Retries-Remaining` on outbound events (6 on first attempt, then 5 … 0). Q8.
- [ ] Serialize JSON once per event and resend the same bytes on retry.

Outbound payloads (§2.1–2.6, §2.8):
- [ ] Every event: `RecordType`, `MessageStream`, `MessageID`, `Metadata` (strings; `{}` when the send had none), `Tag` from the original send.
- [ ] Dates as `YYYY-MM-DDTHH:MM:SS.fffffffZ`.
- [ ] Bounce: `ID` is a JSON integer, unique per bounce. All §2.1 keys present. `Content` only when `IncludeContent` (or `IncludeBounceContentInHook`) is on.
- [ ] Bounce: `Description` is the fixed text per `Type` from `refs/api_bounce-api.md:397-418`. `Details` carries the command's SMTP line.
- [ ] HardBounce sets `Inactive: true` and adds the address to the stream suppression list.
- [ ] SpamComplaint sets `Type: SpamComplaint`, `TypeCode: 100001`, `Inactive: true`, `CanActivate: false`.
- [ ] Record each bounce so `GET /bounces` and `PUT /bounces/{id}/activate` see it (`docs/04`).
- [ ] Delivery: one event per recipient, with `Recipient`, `DeliveredAt`, `Details`, `ServerID`.
- [ ] Open: only for `TrackOpens` messages with an HTML body. Honor `PostFirstOpenOnly`. Set `FirstOpen`. No `ServerID`.
- [ ] Click: only for tracked links (§5). First click per recipient per link. `ClickLocation`, `OriginalLink`. No `ServerID`.
- [ ] Record opens and clicks so `docs/06` §1.7 reads see them.
- [ ] SubscriptionChange: on every suppression add or remove, including after HardBounce and SpamComplaint. Nulls per §2.6 on reactivation. Order vs Bounce: Q12.
- [ ] SMTP API Error: a Bounce payload with `Type: SMTPApiError`, `TypeCode: 100007`, only when `EnableSmtpApiErrorHooks` is on.

Inbound payload (§2.7, §4):
- [ ] All §4.2 keys present, with `""` or `[]` for empty values. `RawEmail` only when `RawEmailEnabled`.
- [ ] Attachment `Content` is base64 of the bytes. `ContentLength` is the decoded byte count.
- [ ] `ToFull[].MailboxHash` and top-level `MailboxHash` from `+hash` in the local part.
- [ ] `Date` in RFC 2822 form.
- [ ] Add `X-Spam-Status`, `X-Spam-Score`, `X-Spam-Tests` headers. Drop mail above `InboundSpamThreshold`.
- [ ] Apply the §4.2 Bcc rules.
- [ ] Record the message so `docs/06` §1.2 inbound reads, `bypass` and `retry` see it.

Responses and retries:
- [ ] Outbound: 2xx success; 408, 429, 5xx, timeout, connect error retry; other 4xx drop.
- [ ] Outbound retry delays 1, 5, 10, 10, 10, 15 min. Then drop. Q7 may add a slower tier.
- [ ] Inbound: 200 success; 403 stop; other codes retry. Q6 may change 2xx handling.
- [ ] Inbound retry delays 1, 5, 10, 10, 10, 15, 30, 60, 120, 360 min. Then mark `InboundError`.
- [ ] `PUT /messages/inbound/{id}/retry` sends the inbound event again.
- [ ] Follow up to 10 redirects. Treat an 11th as a failure.
- [ ] Timeout: inbound 120 s. Outbound: use the Q5 capture result. Until then, crash on an outbound timeout config read.
- [ ] Pause one trigger type after persistent failure. Threshold: Q11; crash until known.
- [ ] Log every attempt (URL, headers, body, status, virtual time) for test assertions through the control API.

Test sends (§3.8):
- [ ] A send to `<type>@bounce-testing.postmarkapp.com` or with `X-PM-Bounce-Type` fires a real Bounce event.
- [ ] A sandbox server fires Delivery for every message.

---

## 7. Open questions for live capture

Priority order. Capture plan goes in `docs/10`.

| # | Question | Why it matters | How to capture |
| --- | --- | --- | --- |
| Q6 | Does a 204 count as success for inbound? For outbound? For verification? | Inbound docs say retry unless 200. A receiver that answers 204 may get 10 duplicate deliveries. | Point an inbound hook and a Bounce webhook at a bin that answers 204. Count requests over 20 min. |
| Q5 | Outbound webhook timeout. | Undocumented. An unverified integrator report assumes ~10 s. | Bin that sleeps 5, 10, 15, 30 s. Watch for retry. |
| Q1 | Exact `Content-Type` value (charset?). | Byte-level parity. | Capture headers at a bin. |
| Q2 | `User-Agent` value. | Header parity. | Same capture. |
| Q3 | Precedence when URL userinfo and `HttpAuth` both exist. | Receivers may use either form. | Create one webhook with both. |
| Q8 | Are `X-PM-Retries-Remaining` and `X-PM-Webhook-Trace-Id` on inbound requests? First value of Retries-Remaining? | Header parity. | Inbound to a bin that answers 500 once. |
| Q7 | Full outbound retry schedule. Is there a slower tier past 51 min? | Doc table may be truncated. An unverified integrator report says "hours". | Bounce webhook to a bin that always answers 500. Log for 12 h. |
| Q13 | Verify probe bodies. Any UI "Send test" payload. | Mock sends probes on create and edit. | Create webhook with `Verify: true` against a bin. |
| Q4 | Webhook source IP ranges (support article 800). | Documentation only. | Fetch article 800 into `refs/`. |
| Q9 | Max webhooks per stream (error 1359). | Config API parity. | Create webhooks until 1359. |
| Q10 | Do legacy `BounceHookUrl` values appear as `/webhooks` rows, and vice versa? | Config API parity. | Set one, list the other. |
| Q11 | Threshold that pauses a trigger type. | Mock pauses triggers. | Long failing run in Q7. |
| Q12 | Order of Bounce vs SubscriptionChange for one hard bounce. Order under retries. | Receivers that need both. | Hard bounce with both triggers on. |
| Q14 | Is `CanActivate` ever absent on a Bounce payload? | Unverified integrator report; python requires the key (B1). | Capture several bounce types from `bounce-testing.postmarkapp.com`. |
| Q15 | Is the dotnet `ServerId` key (conflict D1) a real payload variant? | SDK vs doc key case. | Capture one Delivery payload. |
| Q16 | `?verify=false` query vs `Verify` body field. | Doc conflict (§1.3). | Try both on create. |
| Q17 | Inbound attachment keys (`ContentType`, `Name`, `ContentID`, `Disposition`) for mail from Outlook, Gmail and Apple Mail, incl. inline images and a `text/calendar` part. Does a calendar part also land in `TextBody`? | Receivers select parts by these keys (§4.3 I1, I2). | Send the same multipart mail from each client to the inbound address. |
| Q18 | Does Postmark keep the URL query string? Does it send URL userinfo as `Authorization: Basic`, and strip it from the request line? | Common receiver auth forms (§3.2). | Webhook URL `https://u:p@<bin>/hook?token=x`. Capture request line and headers. |
| Q19 | Thresholds behind `SlowCount` and `VerySlowCount` in `/webhooks/{Id}/statistics`. | Statistics parity. | Bin that answers after 1, 5, 10 s; read statistics. |
