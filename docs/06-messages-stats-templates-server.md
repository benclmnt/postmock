# 06 — Messages, Stats, Templates, Server, Servers, Domains, Signatures

Scope: the read and admin APIs around sending.
Sending (`/email`, `/email/batch`) and suppressions belong to other docs.

Every endpoint below is in scope. Server token: §1–§3 and §4.1. Account token: §4.2–§4.4 and `PUT /templates/push`.

Marks: **DOC**, **SDK**, **LIB**, **CAPTURED**, **INFERRED** (see `AGENTS.md` rule 6). No claim below is **CAPTURED**.

## 0. SDK coverage

The tables below name the postmark.js method per endpoint.
The call line for every official SDK (js, python, dotnet, php, gem, java, cli, mcp) is in `docs/08` §2.1 (server token) and §2.2 (account token).
Paths an SDK spells differently (`emailClients`, `browserFamilies`, `inboundRules`, `verifyDKIM`, trailing `/`) are in `docs/08` §2.5.

## 1. Messages API

### 1.1 Common rules

| Rule | Value | Source |
| --- | --- | --- |
| Auth header | `X-Postmark-Server-Token` | `refs/api_messages-api.md:19` **DOC**; `sdk/postmark.js/src/client/models/client/ClientOptions.ts:38` **SDK** |
| `count` | Required. Max 500. | `refs/api_messages-api.md:34`, `:630` **DOC** |
| `offset` | Required. `count + offset` must be ≤ 10 000 on messages and opens search. | `refs/api_messages-api.md:35`, `:631` **DOC** |
| `offset` on clicks search | Required. The page does not state the 10 000 cap; the mock applies it. | `refs/api_messages-api.md:839-840` **DOC**; cap **INFERRED** |
| Paging error | ErrorCode 700, HTTP 422, "Paging/parameter validation for messages, opens, clicks, and activity". | `refs/api_overview.md:112` **DOC** |
| Message not found / cannot bypass or retry | ErrorCode 701, HTTP 422 | `refs/api_overview.md:113` **DOC** |
| Bypass failed / retry failed | ErrorCode 702 / 703, HTTP 422 | `refs/api_overview.md:114-115` **DOC** |
| postmark.js default paging | `count = count \|\| 100`, `offset = offset \|\| 0`. So `count: 0` is sent as 100. | `sdk/postmark.js/src/client/BaseClient.ts:132-135` **SDK** |
| postmark.js query encoding | Filter object keys are sent verbatim (`URLSearchParams`); `undefined`/`null` are dropped. | `sdk/postmark.js/src/client/HttpClient.ts:85-101` **SDK** |
| Retention | Content, events and metadata: 45 days default, 7–365 with add-on. Stats: forever. | `refs/support_article_how-long-are-inbound-and-outbound-messages-stored-in-activity.md:4` **DOC**; `refs/api_messages-api.md:4` **DOC** |
| Timestamps in responses | ISO 8601 with 7 fraction digits and an Eastern offset, e.g. `2014-02-20T07:25:02.8782715-05:00`. | `refs/api_messages-api.md:77` **DOC** |

Query-name casing disagreement:
- Docs use lowercase `fromemail`, `todate`, `fromdate`, `messagestream`. `refs/api_messages-api.md:37-43` **DOC**
- postmark.js sends camelCase `fromEmail`, `fromDate`, `toDate`, `messageStream`. `sdk/postmark.js/src/client/models/messages/MessageFilteringParameters.ts:24-30` **SDK**
- postmark-python sends `clientName`, `osName` (camelCase) for the snake_case doc names `client_name`, `os_name`. `sdk/postmark-python/postmark/models/outbound/manager.py:337-356` **SDK**
- So Postmark must match query names case-insensitively, and probably ignores underscores. **INFERRED**. Capture needed (Q1).

### 1.2 Endpoint table

| Method + path | postmark.js method | Response top-level | Source |
| --- | --- | --- | --- |
| GET `/messages/outbound` | `getOutboundMessages(filter)` | `{TotalCount, Messages[]}` | `refs/api_messages-api.md:10-51` **DOC**; `sdk/postmark.js/src/client/ServerClient.ts:330-333` **SDK** |
| GET `/messages/outbound/{id}/details` | `getOutboundMessageDetails(id)` | message + `TextBody`, `HtmlBody`, `Body`, `MessageEvents[]` | `refs/api_messages-api.md:98-139` **DOC**; `ServerClient.ts:343-345` **SDK** |
| GET `/messages/outbound/{id}/dump` | `getOutboundMessageDump(id)` | `{Body}`; empty string when no dump | `refs/api_messages-api.md:245-267` **DOC**; `ServerClient.ts:355-357` **SDK** |
| GET `/messages/inbound` | `getInboundMessages(filter)` | `{TotalCount, InboundMessages[]}` | `refs/api_messages-api.md:284-334` **DOC**; `ServerClient.ts:367-370` **SDK** |
| GET `/messages/inbound/{id}/details` | `getInboundMessageDetails(id)` | inbound message + `TextBody`, `HtmlBody`, `Headers`, `BlockedReason` | `refs/api_messages-api.md:382-423` **DOC**; `ServerClient.ts:380-381` **SDK** |
| PUT `/messages/inbound/{id}/bypass` | `bypassBlockedInboundMessage(id)` | `{ErrorCode: 0, Message}` | `refs/api_messages-api.md:525-559` **DOC**; `ServerClient.ts:391-392` **SDK** |
| PUT `/messages/inbound/{id}/retry` | `retryInboundHookForMessage(id)` | `{ErrorCode: 0, Message}` | `refs/api_messages-api.md:566-601` **DOC**; `ServerClient.ts:402-403` **SDK** |
| GET `/messages/outbound/opens` | `getMessageOpens(filter)` | `{TotalCount, Opens[]}` | `refs/api_messages-api.md:608-655` **DOC**; `ServerClient.ts:413-416` **SDK** |
| GET `/messages/outbound/opens/{id}` | `getMessageOpensForSingleMessage(id, filter)` | `{TotalCount, Opens[]}` | `refs/api_messages-api.md:720-754` **DOC**; `ServerClient.ts:426-430` **SDK** |
| GET `/messages/outbound/clicks` | `getMessageClicks(filter)` | `{TotalCount, Clicks[]}` | `refs/api_messages-api.md:817-864` **DOC**; `ServerClient.ts:440-443` **SDK** |
| GET `/messages/outbound/clicks/{id}` | `getMessageClicksForSingleMessage(id, filter)` | `{TotalCount, Clicks[]}` | `refs/api_messages-api.md:930-964` **DOC**; `ServerClient.ts:454-458` **SDK** |

Wrong inbound key in docs:
- The inbound search table says `Messages`, but the example body uses `InboundMessages`. `refs/api_messages-api.md:324` vs `:334` **DOC**
- Trust the example until a capture says otherwise. **INFERRED**

### 1.3 Outbound search filters

| Param (doc name) | Meaning | Source |
| --- | --- | --- |
| `recipient` | Recipient address | `refs/api_messages-api.md:36` **DOC** |
| `fromemail` | Sender address | `:37` **DOC** |
| `tag` | Tag | `:38` **DOC** |
| `status` | `queued`, `sent`, `processed`. `sent` and `processed` return the same set. | `:39` **DOC** |
| `todate` / `fromdate` | Inclusive. Date or date-time, e.g. `2021-01-01T12:00:00`. Eastern Time. | `:40-41` **DOC** |
| `subject` | Subject | `:42` **DOC** |
| `messagestream` | Stream ID. Default: `outbound`. | `:43` **DOC** |
| `metadata_<key>` | One metadata field per search. | `:44` **DOC**; `MessageFilteringParameters.ts:32-33` **SDK** |

Disagreements:
- OpenAPI lists `status` enum `queued`, `sent` only, and `format: date` for dates. `refs/openapi/server.yml:1150-1163` **DOC** (older)
- OpenAPI omits `subject`, `messagestream`, `metadata_`. `refs/openapi/server.yml:1113-1172` **DOC**
- Eastern Time means America/New_York with DST. The doc does not say EST vs EDT. **INFERRED** (Q2)

### 1.4 Status value sets

| Field | Values | Source |
| --- | --- | --- |
| Outbound filter `status` | `queued`, `sent`, `processed` | `refs/api_messages-api.md:39` **DOC**; `MessageFilteringParameters.ts:3-7` **SDK** |
| Outbound response `Status` | `Sent`, `Processed`, `Queued` (capitalized) | `refs/api_messages-api.md:134`, `:81` **DOC** |
| Inbound filter `status` | `blocked`, `processed`, `queued`, `failed`, `scheduled`. Default `processed`. | `refs/api_messages-api.md:315` **DOC** |
| postmark.js inbound enum | adds `sent` | `MessageFilteringParameters.ts:9-16` **SDK** |
| Inbound response `Status` | e.g. `Blocked` | `refs/api_messages-api.md:372` **DOC** |
| `MessageEvents[].Type` | `SubscriptionChanged`, `Delivered`, `Transient`, `Opened`, `LinkClicked`, `Bounced` | `refs/api_messages-api.md:139` **DOC** |

### 1.5 Outbound message schema

| Field | Type | Source |
| --- | --- | --- |
| `MessageID` | string (UUID) | `refs/api_messages-api.md:64` **DOC** |
| `Tag` | string | `:63` **DOC** |
| `MessageStream` | string | `:65` **DOC** |
| `To`, `Cc`, `Bcc` | `[{Email, Name}]`; `Name` may be `null` | `:66-73` **DOC** |
| `Recipients` | string[] | `:74-76` **DOC** |
| `ReceivedAt` | string (date-time) | `:77` **DOC** |
| `From` | string, e.g. `"\"Joe\" <joe@domain.com>"` | `:78` **DOC** |
| `Subject` | string | `:79` **DOC** |
| `Attachments` | string[] of file names (example) | `:80`, `:168-171` **DOC** |
| `Status` | string | `:81` **DOC** |
| `TrackOpens` | boolean | `:82` **DOC** |
| `TrackLinks` | `None`, `HtmlAndText`, `HtmlOnly`, `TextOnly` | `:83`, `:136` **DOC** |
| `Metadata` | object of string values | `:84-87` **DOC** |
| `Sandboxed` | boolean | `:88` **DOC** |
| `TotalCount` (search) | integer | `:50` **DOC** |

Disagreements:
- postmark.js types `OutboundMessages.TotalCount` as `string`. `sdk/postmark.js/src/client/models/messages/OutboundMessage.ts:40-42` **SDK**. Docs say integer. Docs win.
- OpenAPI types `Attachments` as attachment objects. `refs/openapi/server.yml:770-771` **DOC**. The doc example uses names. Capture needed (Q3).

### 1.6 `MessageEvents[]` (details)

Each event: `{Recipient, Type, ReceivedAt, Details}`. `refs/api_messages-api.md:181-236` **DOC**; `sdk/postmark.js/src/client/models/messages/OutboundMessageEvents.ts:3-8` **SDK**

| `Type` | `Details` keys | Source |
| --- | --- | --- |
| `Delivered` | `DeliveryMessage`, `DestinationServer`, `DestinationIP` | `refs/api_messages-api.md:183-189` **DOC** |
| `Transient` | `DeliveryMessage`, `DestinationServer`, `DestinationIP` | `:193-198` **DOC** |
| `Opened` | `Summary` | `:203-206` **DOC** |
| `Bounced` | `Summary`, `BounceID` (string in doc example, number in SDK) | `:211-215` **DOC**; `OutboundMessageEvents.ts:34-39` **SDK** |
| `SubscriptionChanged` | `Origin`, `SuppressSending` (`"True"` as string) | `:220-224` **DOC** |
| `LinkClicked` | `Summary`, `Link`, `ClickLocation` (`HTML`/`Text`) | `:229-234` **DOC** |

### 1.7 Opens and clicks

Filters for the list endpoints:

| Param | Opens | Clicks | Source |
| --- | --- | --- | --- |
| `count`, `offset` | yes | yes | `refs/api_messages-api.md:630-631`, `:839-840` **DOC** |
| `recipient` (To, Cc, Bcc) | yes | yes | `:632`, `:841` **DOC** |
| `tag` | yes | yes | `:633`, `:842` **DOC** |
| `messagestream` (default `outbound`) | yes | yes | `:634`, `:853` **DOC** |
| `client_name`, `client_company`, `client_family` | yes | yes | `:635-637`, `:843-845` **DOC** |
| `os_name`, `os_family`, `os_company` | yes | yes | `:638-640`, `:846-848` **DOC** |
| `platform`, `country`, `region`, `city` | yes | yes | `:641-644`, `:849-852` **DOC** |
| `fromdate`, `todate` | not in docs | not in docs | postmark-python sends them. `sdk/postmark-python/postmark/models/outbound/manager.py:359-362` **SDK** |

Single-message endpoints take only `count` (max 500) and `offset`. `refs/api_messages-api.md:742-743`, `:952-953` **DOC**

Open event fields:

| Field | Always present | Source |
| --- | --- | --- |
| `RecordType` = `"Open"` | yes | `refs/api_messages-api.md:656`, `:672` **DOC** |
| `UserAgent` | yes | `:657` **DOC** |
| `MessageID` | yes | `:658` **DOC** |
| `MessageStream` | yes | `:659` **DOC** |
| `ReceivedAt` | yes | `:660` **DOC** |
| `Tag`, `Recipient` | in example | `:698-699` **DOC** |
| `Client {Name, Company, Family}` | may be absent | `:711` **DOC** |
| `OS {Name, Company, Family}` | may be absent | `:712` **DOC** |
| `Platform` (`WebMail`, `Desktop`, `Mobile`, `Unknown`) | may be absent | `:713` **DOC** |
| `Geo {CountryISOCode, Country, RegionISOCode, Region, City, Zip, Coords, IP}` | may be absent | `:714` **DOC** |
| `FirstOpen` boolean | OpenAPI only | `refs/openapi/server.yml:664-668` **DOC** |
| `ReadSeconds` number | postmark.js only | `sdk/postmark.js/src/client/models/messages/OutboundMessageOpen.ts:24` **SDK** |

Click event fields: the same as open, minus `ReadSeconds`/`FirstOpen`, plus these:

| Field | Source |
| --- | --- |
| `RecordType` = `"Click"` | `refs/api_messages-api.md:880` **DOC** |
| `ClickLocation` (`HTML` / `Text`) | `:881` **DOC**; `OutboundMessageClick.ts:6` **SDK** |
| `OriginalLink` | `:894` **DOC** |

Rules:
- Single-message opens: Postmark stores only the first open. `TotalCount` is always 1. `refs/api_messages-api.md:753` **DOC**
- One open entry binds to one recipient. `refs/api_messages-api.md:655` **DOC**
- One click entry binds to one recipient and one unique link. `refs/api_messages-api.md:864` **DOC**
- The doc example shows `"MessageStream": "Outbound"` (capital O) on one click. `refs/api_messages-api.md:906` **DOC**. Treat as a doc typo. **INFERRED**
- Single-message responses omit `RecordType` in the examples. `refs/api_messages-api.md:769-797`, `:978-1009` **DOC**

## 2. Stats API

### 2.1 Common rules

| Rule | Value | Source |
| --- | --- | --- |
| Auth | `X-Postmark-Server-Token` | `refs/api_stats-api.md:19` **DOC** |
| Params | `tag`, `fromdate`, `todate` (date, inclusive, e.g. `2014-01-01`), `messagestream` | `refs/api_stats-api.md:34-37` **DOC** |
| Default stream | All streams on the server | `refs/api_stats-api.md:37` **DOC** |
| Default range | All time | `refs/api_stats-api.md:4` **DOC** |
| Timezone | EST | `refs/api_stats-api.md:4` **DOC** |
| Retention | Forever | `refs/api_stats-api.md:4` **DOC** |
| Days with no data | Omitted from `Days` | `refs/api_stats-api.md:121` **DOC** |
| Zero keys inside a day | Omitted (e.g. a day with only `Transient`) | `refs/api_stats-api.md:216-218` **DOC** |
| Errors | 614 not entitled, 900 bad date, 1226 stream not found, 1500 `FromDate` older than 1 year | `refs/api_overview.md:196-199` **DOC** |
| postmark.js params | `tag`, `fromDate`, `toDate`, `messageStream`; no paging | `sdk/postmark.js/src/client/models/stats/StatsFilteringParameters.ts:1-13` **SDK** |

### 2.2 Endpoints and shapes

Response shape: `{Days: [{Date: "YYYY-MM-DD", <keys>}], <same keys as totals>}`.

| Path | postmark.js method | Keys | Source |
| --- | --- | --- | --- |
| `/stats/outbound` | `getOutboundOverview` | No `Days`. `Sent`, `Bounced`, `SMTPApiErrors`, `BounceRate`, `SpamComplaints`, `SpamComplaintsRate`, `Opens`, `UniqueOpens`, `Tracked`, `WithLinkTracking`, `WithOpenTracking`, `TotalTrackedLinksSent`, `UniqueLinksClicked`, `TotalClicks`, `WithClientRecorded`, `WithPlatformRecorded` | `refs/api_stats-api.md:10-83` **DOC**; `ServerClient.ts:468-470` **SDK** |
| `/stats/outbound/sends` | `getSentCounts` | `Sent` | `refs/api_stats-api.md:90-126` **DOC**; `ServerClient.ts:480-482` **SDK** |
| `/stats/outbound/bounces` | `getBounceCounts` | `HardBounce`, `SoftBounce`, `SMTPApiError`, `Transient` | `refs/api_stats-api.md:161-200` **DOC**; `ServerClient.ts:492-494` **SDK** |
| `/stats/outbound/spam` | `getSpamComplaintsCounts` | `SpamComplaint` | `refs/api_stats-api.md:240-276` **DOC**; `ServerClient.ts:504-506` **SDK** |
| `/stats/outbound/tracked` | `getTrackedEmailCounts` | `Tracked` | `refs/api_stats-api.md:307-343` **DOC**; `ServerClient.ts:516-518` **SDK** |
| `/stats/outbound/opens` | `getEmailOpenCounts` | `Opens`, `Unique` | `refs/api_stats-api.md:382-419` **DOC**; `ServerClient.ts:528-530` **SDK** |
| `/stats/outbound/opens/platforms` | `getEmailOpenPlatformUsage` | `Desktop`, `Mobile`, `WebMail`, `Unknown` | `refs/api_stats-api.md:464-503` **DOC**; `ServerClient.ts:540-542` **SDK** |
| `/stats/outbound/opens/emailclients` | `getEmailOpenClientUsage` (sends `emailClients`) | dynamic client names, e.g. `"Apple Mail"` | `refs/api_stats-api.md:540-576` **DOC**; `ServerClient.ts:552-554` **SDK** |
| `/stats/outbound/opens/readTimes` | `getEmailOpenReadTimes` | dynamic | not in docs; `ServerClient.ts:563-565` **SDK** |
| `/stats/outbound/clicks` | `getClickCounts` | `Clicks`, `Unique` | `refs/api_stats-api.md:611-648` **DOC**; `ServerClient.ts:575-577` **SDK** |
| `/stats/outbound/clicks/browserfamilies` | `getClickBrowserUsage` (sends `browserFamilies`) | dynamic browser names | `refs/api_stats-api.md:693-729` **DOC**; `ServerClient.ts:586-588` **SDK** |
| `/stats/outbound/clicks/platforms` | `getClickPlatformUsage` | `Desktop`, `Mobile`, `Unknown` | `refs/api_stats-api.md:764-802` **DOC**; `ServerClient.ts:598-600` **SDK** |
| `/stats/outbound/clicks/location` | `getClickLocation` | `HTML`, `Text` | `refs/api_stats-api.md:836-873` **DOC**; `ServerClient.ts:611-613` **SDK** |

Disagreements:
- Path casing: docs use `emailclients` and `browserfamilies`; postmark.js uses `emailClients` and `browserFamilies`. So routing is case-insensitive. **INFERRED**
- OpenAPI names the overview key `SMTPAPIErrors` and types rates as integer. `refs/openapi/server.yml:579-589` **DOC**. The HTML doc says `SMTPApiErrors`, double. `refs/api_stats-api.md:45-48` **DOC**
- postmark.js adds `WithReadTimeRecorded` to the overview. `sdk/postmark.js/src/client/models/stats/Stats.ts:18` **SDK**
- Stats count a multi-recipient message once per recipient. The Messages API counts it once. `refs/api_messages-api.md:50` **DOC**

## 3. Templates API

### 3.1 Endpoints

| Method + path | postmark.js | Token | Source |
| --- | --- | --- | --- |
| GET `/templates?Count&Offset&TemplateType&LayoutTemplate` | `getTemplates` (sends `count`, `offset`, `templateType`, `layoutTemplate`) | server | `refs/api_templates-api.md:672-704` **DOC**; `ServerClient.ts:238-241`, `models/templates/Template.ts:164-173` **SDK** |
| GET `/templates/{idOrAlias}` | `getTemplate` | server | `refs/api_templates-api.md:437-468` **DOC**; `ServerClient.ts:251-252` **SDK** |
| POST `/templates` | `createTemplate` (posts to `/templates/`) | server | `refs/api_templates-api.md:506-570` **DOC**; `ServerClient.ts:273-274` **SDK** |
| PUT `/templates/{idOrAlias}` | `editTemplate` | server | `refs/api_templates-api.md:592-651` **DOC**; `ServerClient.ts:285-286` **SDK** |
| DELETE `/templates/{idOrAlias}` | `deleteTemplate` | server | `refs/api_templates-api.md:738-771` **DOC**; `ServerClient.ts:262-263` **SDK** |
| POST `/templates/validate` | `validateTemplate` | server | `refs/api_templates-api.md:779-844` **DOC**; `ServerClient.ts:297-299` **SDK** |
| PUT `/templates/push` | `AccountClient.pushTemplates` | **account** | `refs/api_templates-api.md:357-411` **DOC**; `sdk/postmark.js/src/client/AccountClient.ts:304` **SDK** |
| POST `/email/withTemplate` | `sendEmailWithTemplate` | server | `refs/api_templates-api.md:12-128` **DOC**; `ServerClient.ts:133-134` **SDK** |
| POST `/email/batchWithTemplates` | `sendEmailBatchWithTemplates` (wraps array in `{Messages}`) | server | `refs/api_templates-api.md:136-278` **DOC**; `ServerClient.ts:144-146` **SDK** |

### 3.2 Template object

| Field | Notes | Source |
| --- | --- | --- |
| `TemplateId` | integer | `refs/api_templates-api.md:459` **DOC** |
| `Name` | required on create | `:539` **DOC** |
| `Alias` | optional; `[A-Za-z][A-Za-z0-9._-]*`; `null` when unset | `:466`, `:568` **DOC** |
| `Subject` | required for Standard; forbidden for Layout | `:543` **DOC** |
| `HtmlBody`, `TextBody` | at least one required | `:541-542` **DOC** |
| `TemplateType` | `Standard` (default) or `Layout`; immutable after create | `:544` **DOC** |
| `LayoutTemplate` | layout alias or `null`; error if set on a Layout; `""` clears it | `:545`, `:628` **DOC** |
| `Active` | boolean | `:465` **DOC** |
| `AssociatedServerId` | integer | `:464` **DOC** |
| Limit | 100 templates per server | `:6` **DOC** |

Behavior notes:
- Create response: `{TemplateId, Name, Active, Alias, TemplateType, LayoutTemplate}` only. `refs/api_templates-api.md:565-570` **DOC**
- Delete response: `{ErrorCode: 0, Message: "Template 1234 removed."}`. `refs/api_templates-api.md:769-771` **DOC**
- A deleted template stays readable with `Active: false`. `sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:112-115` **SDK** (live-API test)
- List response `Templates[]` has `Active`, `TemplateId`, `Name`, `Alias`, `TemplateType`, `LayoutTemplate`. `refs/api_templates-api.md:712-731` **DOC**
- The Get example returns two objects side by side, which is not valid JSON. It also shows `"LayoutTemplate": "null"` as a string. `refs/api_templates-api.md:476-499` **DOC**. Treat both as doc errors. **INFERRED**

### 3.3 Validate

Request: `Subject`, `HtmlBody`, `TextBody` (one required), `TestRenderModel`, `InlineCssForHtmlTestRender` (default true), `TemplateType`, `LayoutTemplate`. `refs/api_templates-api.md:813-819` **DOC**

Response:

| Field | Meaning | Source |
| --- | --- | --- |
| `AllContentIsValid` | all parts parse | `refs/api_templates-api.md:840` **DOC** |
| `HtmlBody` / `TextBody` / `Subject` | each `{ContentIsValid, ValidationErrors[], RenderedContent}` | `:841-843`, `:854-872` **DOC** |
| `ValidationErrors[]` | never null; `{Message, Line, CharacterPosition}`, 1-based; `Line`/`CharacterPosition` may be null | `:842` **DOC**; `refs/openapi/server.yml:876-884` **DOC** |
| `RenderedContent` | render with `SuggestedTemplateModel` merged with `TestRenderModel` | `:843` **DOC** |
| `SuggestedTemplateModel` | every key found in the template; placeholder value `<key>_Value`; merged with `TestRenderModel` | `:844`, `:873-878` **DOC** |

Validate with a layout: `RenderedContent` is the layout with `{{{ @content }}}` replaced by the template. `sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:219-221` **SDK**

The doc example shows `ContentIsValid: true` beside a non-empty `ValidationErrors`. `refs/api_templates-api.md:860-865` **DOC**. This looks inconsistent. **INFERRED** (Q7)

### 3.4 Push

| Item | Value | Source |
| --- | --- | --- |
| Body | `SourceServerID`, `DestinationServerID`, `PerformChanges` (false = dry run) | `refs/api_templates-api.md:388-390` **DOC** |
| Response | `{TotalCount, Templates: [{Action: Create\|Edit, TemplateId, Alias, Name, TemplateType}]}` | `:406-430` **DOC** |
| Match rule | by alias; templates without alias are not pushed | `:359` **DOC**; `refs/api_overview.md:91` **DOC** |
| Errors | 601 server not found; 1124 nothing to push; 1125 type mismatch | `refs/api_overview.md:82`, `:91-92` **DOC** |

### 3.5 Mustachio syntax

| Rule | Example | Source |
| --- | --- | --- |
| Interpolate, dot path | `{{ person.first_name }}` | `refs/support_article_1077-template-syntax.md:22-30` **DOC** |
| Whitespace inside braces allowed | `{{ name }}` = `{{name}}` | `:23`, `:40` **DOC** |
| HTML-escape by default | `{{x}}` escapes `<`, `>` | `:284-303` **DOC** |
| No escape | `{{{ x }}}` or `{{& x }}` | `:306-316` **DOC** |
| Scope section | `{{#person}}…{{/person}}` | `:38-44` **DOC** |
| Collection | `{{#each employees}}…{{/each}}` | `:66-83` **DOC** |
| Reach up | `{{../name}}`; one `../` per level. The doc example uses `../../` inside `each`. | `:98-107` **DOC** |
| Current value | `{{.}}` | `:137`, `:152` **DOC** |
| Missing, null, false, empty array in a section | section is skipped | `:111`, `:264` **DOC** |
| Inverted group | `{{^ x}}…{{/x}}` renders when `x` is absent | `:264-278` **DOC** |
| Missing value in plain `{{x}}` | renders empty string | **INFERRED** (the article does not say it) |
| Layout placeholder | `{{{ @content }}}`; exactly once in a layout body | `:320-326` **DOC**; `refs/api_templates-api.md:541` **DOC** |
| Unsubscribe placeholder | `{{{ pm:unsubscribe }}}` | `:334-343` **DOC** |

The article's example output drops the colon after "Employees" and closes `<ul>` differently from its template. `refs/support_article_1077-template-syntax.md:67-82` **DOC**. Do not use it as a byte-exact fixture.

### 3.6 `/email/withTemplate` errors

| Case | HTTP | ErrorCode | Message | Source |
| --- | --- | --- | --- | --- |
| Neither `TemplateId` nor `TemplateAlias` | 422 | 1101 | — | `refs/api_overview.md:84` **DOC** |
| Template/alias/layout not found | 422 | 1101 | "The Template's 'Alias' associated with this request is not valid or was not found." (alias case, batch body) | `refs/api_overview.md:84` **DOC**; `sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:246-248` **SDK** |
| `TemplateModel` missing | 422 | 1120 | — | `refs/api_overview.md:87` **DOC** |
| Model too long | 422 | 1121 | — | `refs/api_overview.md:88` **DOC** |
| Reserved top-level `TemplateModel` key | 422 | 1122 | — | `refs/api_overview.md:89` **DOC** |
| Templated and non-templated fields mixed (e.g. `HtmlBody` + `TemplateId`) | 422 | 1123 | — | `refs/api_overview.md:90` **DOC** |
| `TemplateId` and `TemplateAlias` both set | 200 | — | `TemplateId` wins (batch doc) | `refs/api_templates-api.md:181-182` **DOC** |
| Batch | 200 | per item | per-message `ErrorCode` in array | `refs/api_templates-api.md:250` **DOC** |
| Template list paging / bad `TemplateType` | 422 | 1100 | — | `refs/api_overview.md:83` **DOC** |
| Layout in use on delete | 422 | 1130 | — | `refs/api_overview.md:93` **DOC** |
| Layout placeholder rules | 422 | 1131 | — | `refs/api_overview.md:94` **DOC** |
| Model value missing for a used key | 200 | 0 | renders empty; not an error | **INFERRED** (Mustachio is permissive, `refs/support_article_1077-template-syntax.md:111`) |

## 4. Server, Servers, Domains, Sender Signatures

### 4.1 Server API (server token)

| Method + path | postmark.js | Source |
| --- | --- | --- |
| GET `/server` | `getServer` | `refs/api_server-api.md:10` **DOC**; `ServerClient.ts:308-309` **SDK** |
| PUT `/server` | `editServer` | `refs/api_server-api.md:93` **DOC**; `ServerClient.ts:319-320` **SDK** |

Fields (GET response; PUT response is the same):

| Field | Editable by PUT | Source |
| --- | --- | --- |
| `ID`, `ApiTokens[]`, `ServerLink`, `InboundAddress`, `InboundHash` | no | `refs/api_server-api.md:32-47` **DOC** |
| `DeliveryType` (`Live`/`Sandbox`) | no; fixed at create | `:38` **DOC** |
| `Name`, `Color` (`Purple` `Blue` `Turquoise` `Green` `Red` `Yellow` `Grey` `Orange`) | yes | `:35`, `:121-122` **DOC** |
| `SmtpApiActivated`, `RawEmailEnabled` | yes | `:36-37`, `:123-125` **DOC** |
| `InboundHookUrl`, `BounceHookUrl`, `OpenHookUrl`, `DeliveryHookUrl`, `ClickHookUrl` | yes | `:41-44`, `:52`, `:124-132` **DOC** |
| `PostFirstOpenOnly` | yes | `:45`, `:129` **DOC** |
| `InboundDomain`, `InboundSpamThreshold` (0–30) | yes | `:46-48`, `:133-134` **DOC**; `refs/api_overview.md:106` **DOC** |
| `TrackOpens`, `TrackLinks` | yes | `:49-50`, `:130-131` **DOC** |
| `IncludeBounceContentInHook`, `EnableSmtpApiErrorHooks` | yes | `:51-53`, `:135-136` **DOC** |

Disagreements:
- OpenAPI lists lowercase colors and misspells `turqoise`. `refs/openapi/server.yml:109-110` **DOC**
- The PUT response table types `DeliveryType` as boolean. `refs/api_server-api.md:171` **DOC**. The GET table says string. Trust string. **INFERRED**

### 4.2 Servers API (account token)

| Method + path | postmark.js `AccountClient` | Source |
| --- | --- | --- |
| GET `/servers?count&offset&name` | `getServers` | `refs/api_servers-api.md:361-385` **DOC**; `AccountClient.ts:53` **SDK** |
| GET `/servers/{id}` | `getServer` | `refs/api_servers-api.md:10` **DOC**; `AccountClient.ts:64` **SDK** |
| POST `/servers` | `createServer` | `refs/api_servers-api.md:93` **DOC**; `AccountClient.ts:75` **SDK** |
| PUT `/servers/{id}` | `editServer` | `refs/api_servers-api.md:228` **DOC**; `AccountClient.ts:87` **SDK** |
| DELETE `/servers/{id}` | `deleteServer` | `refs/api_servers-api.md:487` **DOC**; `AccountClient.ts:98` **SDK** |

- Header: `X-Postmark-Account-Token`. `refs/api_servers-api.md:17` **DOC**
- A server token on an account endpoint gives 401, ErrorCode 10. `refs/api_overview.md:60` **DOC**
- `name` is a substring match. `refs/api_servers-api.md:385` **DOC**
- Errors 600–615. `refs/api_overview.md:96-110` **DOC**

### 4.3 Domains API (account token)

| Method + path | postmark.js | Source |
| --- | --- | --- |
| GET `/domains?count&offset` (max 500) | `getDomains` | `refs/api_domains-api.md:10`, `:34-35` **DOC**; `AccountClient.ts:110` **SDK** |
| GET/PUT/DELETE `/domains/{id}` | `getDomain`/`editDomain`/`deleteDomain` | `refs/api_domains-api.md:83`, `:252`, `:344` **DOC**; `AccountClient.ts:121-156` **SDK** |
| POST `/domains` | `createDomain` | `refs/api_domains-api.md:157` **DOC**; `AccountClient.ts:132` **SDK** |
| PUT `/domains/{id}/verifyDkim`, `/verifyReturnPath` | `verifyDomainDKIM`, `verifyDomainReturnPath` | `refs/api_domains-api.md:385`, `:460` **DOC**; `AccountClient.ts:167-178` **SDK** |
| POST `/domains/{id}/verifyspf`, `/rotatedkim` | `verifyDomainSPF`, `rotateDomainDKIM` | `refs/api_domains-api.md:534`, `:585` **DOC**; `AccountClient.ts:189-200` **SDK** |

List fields: `Name`, `SPFVerified` (deprecated), `DKIMVerified`, `WeakDKIM`, `ReturnPathDomainVerified`, `ID`. `refs/api_domains-api.md:43-48` **DOC**
Errors 510–523. `refs/api_overview.md:170-180` **DOC**

### 4.4 Sender Signatures API (account token)

| Method + path | postmark.js | Source |
| --- | --- | --- |
| GET `/senders?count&offset` (max 500) | `getSenderSignatures` | `refs/api_signatures-api.md:10`, `:34-35` **DOC**; `AccountClient.ts:224` **SDK** |
| GET/PUT/DELETE `/senders/{id}` | `getSenderSignature`/`editSenderSignature`/`deleteSenderSignature` | `refs/api_signatures-api.md:83`, `:281`, `:391` **DOC**; `AccountClient.ts:211-260` **SDK** |
| POST `/senders` (`FromEmail`, `Name` required) | `createSenderSignature` | `refs/api_signatures-api.md:168`, `:198-199` **DOC**; `AccountClient.ts:235` **SDK** |
| POST `/senders/{id}/resend`, `/verifyspf`, `/requestnewdkim` | `resendSenderSignatureConfirmation`, … | `refs/api_signatures-api.md:432`, `:474`, `:563` **DOC**; `AccountClient.ts:271-293` **SDK** |

List fields: `Domain`, `EmailAddress`, `Name`, `Confirmed`, `ID`. `refs/api_signatures-api.md:43-48` **DOC**
Errors 500–508, 520–523. `refs/api_overview.md:161-180` **DOC**

### 4.5 Sender verification and `/email`

| Rule | Source |
| --- | --- |
| `From` must be a registered and confirmed Sender Signature (or a verified domain). | `refs/api_email-api.md:42`, `:176` **DOC** |
| An account pending approval may send only to recipients on the `From` domain: ErrorCode 412, HTTP 422. | `refs/api_overview.md:75` **DOC** |
| An unapproved account: ErrorCode 413, HTTP 422. | `refs/api_overview.md:76` **DOC** |
| Unregistered sender: ErrorCode 400, HTTP 422, "The 'From' address you supplied (…) is not a Sender Signature on your account." | **INFERRED** from past Postmark behavior. The current error table has no 400 or 401 rows. |
| Unconfirmed sender: ErrorCode 401, HTTP 422, "Sender signature not confirmed". | **INFERRED**. Not in `refs/api_overview.md`. |
| HTTP 401 (not ErrorCode 401) means a bad token: ErrorCode 10. | `refs/api_overview.md:28`, `:60` **DOC** |
| postmark.js maps HTTP 422 to `ApiInputError`, and ErrorCode 406/300 to subclasses. ErrorCode 400/401 on HTTP 422 become plain `ApiInputError`. | `sdk/postmark.js/src/client/errors/ErrorHandler.ts:32-41`, `sdk/postmark.js/src/client/errors/Errors.ts:73-94` **SDK** |

The send doc owns the decision on whether the mock checks senders.

## 5. Opens and clicks: wire detail

### 5.1 Full-scan paging pattern

A client that reads every open or click for a tag pages with a fixed `count` and a growing `offset`.

| Item | Value | Source |
| --- | --- | --- |
| Page size | 500, the maximum | `refs/api_messages-api.md:630`, `:839` **DOC** |
| Loop | `offset = 0, 500, 1000, …` until `offset + count >= TotalCount` | **INFERRED** (client pattern) |
| Default stream | `outbound` when no `messagestream` filter is sent | `refs/api_messages-api.md:634`, `:853` **DOC** |
| Data age | events older than the retention window (45 days default) leave the result | `refs/support_article_how-long-are-inbound-and-outbound-messages-stored-in-activity.md:4` **DOC** |
| Data source | only messages sent with `TrackOpens: true` (opens) or `TrackLinks` ≠ `None` (clicks) | `docs/05` §5 |

### 5.2 `getMessageOpens` (postmark.js)

| Step | Value | Source |
| --- | --- | --- |
| Call | `client.getMessageOpens({tag, count: 500, offset})` | `sdk/postmark.js/src/client/ServerClient.ts:413-416` **SDK** |
| Paging default | `count: 0` or absent becomes 100; absent `offset` becomes 0 | `sdk/postmark.js/src/client/BaseClient.ts:132-135` **SDK** |
| HTTP | `GET https://api.postmarkapp.com/messages/outbound/opens?tag=<tag>&count=500&offset=<n>` | `ServerClient.ts:413-416`; `sdk/postmark.js/src/client/HttpClient.ts:67-101` **SDK** |
| Headers | `X-Postmark-Server-Token`, `Accept: application/json`, `Content-Type: application/json`, `User-Agent: Postmark.JS - 5.1.0` | `sdk/postmark.js/src/client/BaseClient.ts:109-116` **SDK** |
| Body | none | `ServerClient.ts:416` (`processRequestWithoutBody`) **SDK** |

Other SDKs' query names and casing: `docs/08` §1.4.

### 5.3 `getMessageClicks` (postmark.js)

| Step | Value | Source |
| --- | --- | --- |
| Call | `client.getMessageClicks({tag, count: 500, offset})` | `sdk/postmark.js/src/client/ServerClient.ts:440-443` **SDK** |
| HTTP | `GET https://api.postmarkapp.com/messages/outbound/clicks?tag=<tag>&count=500&offset=<n>` | `ServerClient.ts:440-443` **SDK** |
| Headers, body | same as opens (§5.2) | `BaseClient.ts:109-116` **SDK** |

### 5.4 Edge case at the paging cap

- The §5.1 loop with `TotalCount > 10 000` sends `offset=10000&count=500` as its last page.
- `count + offset` is then 10 500, which breaks the 10 000 rule on opens. `refs/api_messages-api.md:630-631` **DOC**
- The clicks page does not state the rule. The same rejection on clicks is **INFERRED** (`refs/api_messages-api.md:839-840`).
- Postmark should answer HTTP 422, ErrorCode 700. `refs/api_overview.md:112` **DOC**
- postmark.js then rejects with `ApiInputError`. `sdk/postmark.js/src/client/errors/ErrorHandler.ts:32-41` **SDK**
- The mock must reproduce this rejection. It must not clamp the page.

### 5.5 SDK error behavior on these reads

- A non-2xx status rejects the promise. `sdk/postmark.js/src/client/HttpClient.ts:54-59` **SDK**
- A non-JSON body is kept as text; `ErrorCode` then reads as 0. `HttpClient.ts:113-122`, `:134-140` **SDK**
- An empty body parses as `{}`. `HttpClient.ts:116` **SDK**

## 6. Mock must

Common (every endpoint in §1–§4):
- [ ] Serve every endpoint in §1.2, §2.2, §3.1, §4.1–§4.4.
- [ ] Server-token endpoints: HTTP 401, ErrorCode 10 for a missing or unknown `X-Postmark-Server-Token`.
- [ ] Account-token endpoints: HTTP 401, ErrorCode 10 for a server token or a missing `X-Postmark-Account-Token`.
- [ ] Match paths case-insensitively and ignore a trailing slash (`docs/08` §2.5). Match `PUT /templates/push` before `PUT /templates/{idOrAlias}`.
- [ ] Match query parameter names case-insensitively (§1.1). Underscore handling: Q1.
- [ ] Always answer JSON with `Content-Type: application/json`, and set `X-PM-ApiErrorCode` on errors. `refs/api_overview.md:43` **DOC**
- [ ] Any path outside the docs and SDKs crashes the test loudly (`AGENTS.md` rule 5).

Messages (§1):
- [ ] Require `count` and `offset` as integers on every list. Reject a missing or bad value, `count > 500`, or `count + offset > 10 000` with HTTP 422, ErrorCode 700. DOC for messages and opens; **INFERRED** for clicks (§5.4).
- [ ] Outbound search: filter by `recipient`, `fromemail`, `tag`, `status`, `fromdate`/`todate` (inclusive, Eastern Time), `subject`, `messagestream` (default `outbound`), `metadata_<key>`.
- [ ] Inbound search: filter per `refs/api_messages-api.md:307-317`; `status` default `processed`. Answer with key `InboundMessages` (§1.2).
- [ ] Return `TotalCount` as the full match count, not the page length.
- [ ] Details: add `TextBody`, `HtmlBody`, `Body`, `MessageEvents[]` (§1.6). Dump: `{Body}`, `""` when no dump.
- [ ] Unknown message ID: HTTP 422, ErrorCode 701.
- [ ] Inbound `bypass` releases a blocked message and fires its inbound webhook (`docs/05` §4). `retry` re-sends a failed inbound webhook. Failures: 702, 703.
- [ ] Opens and clicks come only from messages sent with `TrackOpens: true` or a `TrackLinks` mode other than `None`.
- [ ] Opens and clicks list filters per §1.7. Single-message reads take only `count` and `offset`.
- [ ] Return one open per recipient per message on single-message reads (`TotalCount` 1). List endpoint row rule: Q5.
- [ ] Return one click per recipient per unique link.
- [ ] Emit `RecordType`, `MessageID`, `MessageStream`, `ReceivedAt`, `Tag`, `Recipient`, `UserAgent` on every list event. Omit `Client`, `OS`, `Platform`, `Geo` when unknown; never send them as `null`.
- [ ] Add `ClickLocation` and `OriginalLink` on clicks.
- [ ] Format `ReceivedAt` with an Eastern offset, e.g. `-04:00` (§1.1, Q2).
- [ ] Drop messages and events older than the retention window (45 days default).
- [ ] Give the test harness a way to record an open or click for a sent message. Postmark has no public API for this. The same record fires the Open or Click webhook (`docs/05` §2.4–2.5).

Stats (§2):
- [ ] Derive every count from stored messages, bounces, complaints, opens and clicks. Count a multi-recipient message once per recipient.
- [ ] Filter by `tag`, `fromdate`/`todate` (date, inclusive, EST), `messagestream` (default: all streams).
- [ ] Omit days with no data from `Days`. Omit zero keys inside a day.
- [ ] `/stats/outbound` has no `Days`. Rate keys are doubles; key name `SMTPApiErrors` (§2.2 conflict).
- [ ] Serve `/stats/outbound/opens/readtimes`. Its shape is not documented: crash until a capture gives it (`docs/08` §6).
- [ ] Errors 900 (bad date), 1226 (unknown stream), 1500 (`FromDate` older than 1 year).

Templates (§3):
- [ ] CRUD by numeric ID or alias. Validate `Alias` pattern, required fields, `TemplateType` immutability, `LayoutTemplate` rules, 100 templates per server.
- [ ] Create answers the short shape (§3.2). Delete answers `Template <id> removed.`; a deleted template reads back with `Active: false`.
- [ ] List filters `Count`, `Offset`, `TemplateType` (default `All`), `LayoutTemplate`. Bad paging or type: 1100.
- [ ] Render with a Mustachio engine per §3.5: escape `{{x}}`, raw `{{{x}}}` and `{{& x}}`, sections, `#each`, `../`, `{{.}}`, inverted groups, missing value → `""`.
- [ ] Layouts: replace `{{{ @content }}}` once. Reject a layout without exactly one placeholder (1131). Reject delete of a layout in use (1130).
- [ ] Leave `{{{ pm:unsubscribe }}}` to the send path (`docs/03`).
- [ ] `/templates/validate`: per-part `{ContentIsValid, ValidationErrors[], RenderedContent}`, `AllContentIsValid`, `SuggestedTemplateModel` with `<key>_Value` placeholders merged with `TestRenderModel`. Inline CSS unless `InlineCssForHtmlTestRender: false`. Q7.
- [ ] `/email/withTemplate` and `/email/batchWithTemplates`: render, then send through the `/email` path. Errors per §3.6. `TemplateId` wins over `TemplateAlias`.
- [ ] `PUT /templates/push` (account token): match by alias, skip templates without alias, honor `PerformChanges: false`. Errors 601, 1124, 1125.

Server and Servers (§4.1–§4.2):
- [ ] `GET/PUT /server` with the §4.1 field set. Reject writes to read-only fields. `InboundSpamThreshold` 0–30. Colors per the HTML doc (capitalized).
- [ ] Hook URL and tracking fields drive `docs/05` §1.5 and §5.
- [ ] `DeliveryType` is fixed at create. `Sandbox` servers accept mail but deliver nothing (`docs/07`).
- [ ] `/servers` CRUD with the account token. `name` filter is a substring match. Create issues a new server token. Errors 600–615.

Domains and Sender Signatures (§4.3–§4.4):
- [ ] CRUD with the account token; list paging max 500.
- [ ] `verifyDkim`, `verifyReturnPath`, `verifyspf`, `rotatedkim`, `resend`, `requestnewdkim` change only stored flags. No DNS lookup. The control API sets the verified state.
- [ ] Errors 500–508 (signatures), 510–523 (domains).
- [ ] Sender checks on `/email` follow the decision in `docs/03`. ErrorCodes 400/401: Q8.

## 7. Open questions for live capture

| # | Question | Why it matters |
| --- | --- | --- |
| Q1 | Does `/messages/outbound/opens` accept `messageStream`, `MessageStream`, `clientName` as well as the doc spellings? | postmark.js and postmark-python send non-doc casing (§1.1). |
| Q2 | Is `ReceivedAt` offset `-04:00` in summer (EDT) and `-05:00` in winter? Do `fromdate`/`todate` follow DST? | Timestamp format and filter bounds. |
| Q3 | Is outbound `Attachments` a name list or an object list? | Doc and OpenAPI disagree (§1.5). |
| Q4 | Exact status and body for `count=500&offset=10000` on opens and clicks, and for `count=501`. Is it ErrorCode 700 on HTTP 422? What is the `Message`? | A full-scan paging loop hits this case (§5.4). |
| Q5 | Does `/messages/outbound/opens` return one row per recipient (first open) or every open? Is `FirstOpen` present? Is `ReadSeconds` present? | Open counts and field set (§1.7). |
| Q6 | With `POSTMARK_API_TEST` as the token, what do opens and clicks return? | Safe capture path per `AGENTS.md` rule 7. |
| Q7 | For `/templates/validate` with a broken template: is `ContentIsValid` false when `ValidationErrors` is non-empty? | Doc example looks inconsistent (§3.3). |
| Q8 | For `/email` from an unregistered or unconfirmed sender: which ErrorCode (400/401?), HTTP status and message? | Current error table omits them (§4.5). |
| Q9 | For `/email/withTemplate` with an unknown `TemplateId` (not alias): the exact 1101 message. | Only the alias message is known (§3.6). |
| Q10 | Does the `tag` filter match case-sensitively? | Filter parity on messages, opens, clicks and stats. |
| Q11 | Is the empty result `{"TotalCount": 0, "Opens": []}` for an unknown tag? | A §5.1 paging loop stops on `TotalCount`. |
