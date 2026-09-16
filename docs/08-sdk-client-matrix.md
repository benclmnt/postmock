# 08 — SDK client matrix

Scope: what the mock server must accept and emit so that every official Postmark SDK works.

Sources: the `sdk/` clones at the SHAs in `tools/fetch-sources.sh`, plus `refs/openapi/*.yml` and `refs/api_*.md`.

Citation rules:
- `sdk/<repo>/...` paths are relative to the repo root.
- Short forms are defined at the start of each table.
- Marks follow `AGENTS.md` rule 6. No `CAPTURED` marks exist yet.
- Where a rule here disagrees with a topic doc (`docs/02`–`07`), use the `AGENTS.md` rule 6 order: capture, then docs, then SDK read.

---

## 0. SDK inventory

| SDK | Version | SHA | Language / min runtime | Wraps | Citation |
|---|---|---|---|---|---|
| postmark.js | 5.1.0 | f955212 | TypeScript, Node >=18 | — | `sdk/postmark.js/package.json:12,85` **SDK** |
| postmark-python | 0.4.0 | 620d659 | Python >=3.10 | — | `sdk/postmark-python/pyproject.toml:3,12` **SDK** |
| postmark-dotnet | 5.4.1 | b4249c5 | netstandard2.0 (tests netcoreapp3.1) | — | `sdk/postmark-dotnet/src/Postmark/Postmark.csproj:3,9` **SDK** |
| postmark-php | 7.0.0 | ad4b80e | PHP 8.1–8.4 | — | `sdk/postmark-php/CHANGELOG.md:8`, `sdk/postmark-php/composer.json:12` **SDK** |
| postmark-gem | 1.25.1 | a50ff39 | Ruby (no min; CI 1.8.7–3.2) | — | `sdk/postmark-gem/VERSION:1`, `sdk/postmark-gem/.circleci/config.yml:12-29` **SDK** |
| postmark-java | 1.13.0 | c6c5eb6 | Java 8+ | — | `sdk/postmark-java/pom.xml:26,125-126` **SDK** |
| postmark-rails | 0.22.1 | f9e4acc | Ruby, actionmailer >=3 | postmark gem >=1.21.3 | `sdk/postmark-rails/lib/postmark-rails/version.rb:2`, `sdk/postmark-rails/postmark-rails.gemspec:22-23` **SDK** |
| postmark-cli | 1.6.19 | c88a59d | Node (CI 16–20) | `postmark` 4.0.2 (axios) | `sdk/postmark-cli/package.json:3,17`, `sdk/postmark-cli/package-lock.json:4987-4993` **SDK** |
| postmark-mcp | 2.1.1 | 63ef055 | Node >=20 | none (own `fetch` client) | `sdk/postmark-mcp/package.json:3,34-36`, `sdk/postmark-mcp/index.js:19` **SDK** |
| postmark-nodemailer | — | 899daae | example only | third-party `nodemailer-postmark-transport` (not cloned) | `sdk/postmark-nodemailer/example.js:4-13` **SDK** |

Notes:
- postmark-cli uses postmark.js **4.0.2**, which is axios-based. The local clone is 5.1.0, which is fetch-based. Every CLI row that relies on postmark.js source is **INFERRED** from 5.1.0.
- postmark-nodemailer has no manifest, no tests, and no HTTP code. The rest of this document drops it.
- postmark-rails sends all HTTP through the gem (`sdk/postmark-gem/lib/postmark/handlers/mail.rb:11-28` **SDK**), so the gem rows apply to it.

---

## 1. Per-SDK client profile

### 1.1 Transport

| Property | postmark.js | python | dotnet | php | gem (+rails) | java | cli | mcp |
|---|---|---|---|---|---|---|---|---|
| HTTP library | global `fetch` | `httpx.AsyncClient` (sync client wraps it) | `System.Net.Http.HttpClient`, one static instance | Guzzle ^7.8 | `Net::HTTP` | Apache HttpClient 5.5 | axios 1.6.7 | global `fetch` |
| Base URL option | `requestHost` (host only) | `base_url` kwarg | ctor `apiBaseUri` | static `PostmarkClientBase::$BASE_URL` | `:host`, `:port`, `:path_prefix` | 3rd arg `customApiUrl` (host only) | `--request-host` / `POSTMARK_REQUEST_HOST` (INFERRED) | none (hardcoded) |
| Default | `api.postmarkapp.com` | `https://api.postmarkapp.com` | `https://api.postmarkapp.com` | `https://api.postmarkapp.com` | `api.postmarkapp.com`, 443 | `api.postmarkapp.com` | `api.postmarkapp.com` | `https://api.postmarkapp.com` |
| http vs https | `useHttps` bool, default true | scheme in `base_url` | scheme in URI | scheme in `$BASE_URL` | `:secure` bool, default true | `secureConnection` bool, default true | always https | always https |
| Timeout | 180 s total | 5 s (server), 30 s (account) | 60 s | 60 s total | 60 s open + 60 s read | 60 s connect/read | 180 s (INFERRED) | 60 s |
| Retries | none | 3 retries on 429/500/503/timeout, exp. jitter from 1 s | none (`DeleteServerAsync` ×5) | none | `max_retries` 0 | HttpClient5 default: 1 retry on 429/503/IO (INFERRED) | none | none |
| Follows redirects | yes (INFERRED) | no, 3xx raises | yes (INFERRED) | yes, 5 (INFERRED) | no, 3xx raises | yes (INFERRED) | yes (INFERRED) | yes (INFERRED) |

Citations:
- postmark.js **SDK**: `sdk/postmark.js/src/client/HttpClient.ts:24,167-178`, `sdk/postmark.js/src/client/models/client/HttpClient.ts:9-13,23-26`
- python **SDK**: `sdk/postmark-python/postmark/clients/server_client.py:41-48,89-90,118-125`, `sdk/postmark-python/postmark/clients/account_client.py:42`
- dotnet **SDK**: `sdk/postmark-dotnet/src/Postmark/SimpleHttpClient.cs:9-12`, `sdk/postmark-dotnet/src/Postmark/PostmarkClient.cs:36`, `sdk/postmark-dotnet/src/Postmark/PostmarkAdminClient.cs:58-71`
- php **SDK**: `sdk/postmark-php/src/Postmark/PostmarkClientBase.php:28,50,86-91`
- gem **SDK**: `sdk/postmark-gem/lib/postmark/http_client.rb:17-21,62,75-79`, `sdk/postmark-gem/lib/postmark/client.rb:38-51`
- java **SDK**: `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/Postmark.java:21,72-73`, `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/HttpClient.java:24-48,133-160`
- cli **SDK**: `sdk/postmark-cli/src/commands/email/raw.ts:13,65-67`, `sdk/postmark-cli/src/index.ts:8`
- mcp **SDK**: `sdk/postmark-mcp/index.js:19-20,93-103`

### 1.2 Request headers

| Header | postmark.js | python | dotnet | php | gem | java | mcp |
|---|---|---|---|---|---|---|---|
| Token | `X-Postmark-Server-Token` / `-Account-Token` | same | same | same | same | same | server only |
| Accept | `application/json` | `application/json` | `application/json` | `application/json` | `application/json` | `application/json` | `application/json` |
| Content-Type on GET/DELETE | `application/json` | `application/json` | absent | `application/json` | `application/json` (`Content-type`) | `application/json` | absent |
| Content-Type with body | `application/json` | `application/json` | `application/json; charset=utf-8` | `application/json` | `application/json` | `application/json` | `application/json` |
| User-Agent | `Postmark.JS - 5.1.0` | `Python/3.x.y` | `Postmark.NET 2.x (PostmarkDotNet.PostmarkClient, Postmark, Version=5.4.1.0, ...)` | `Postmark-PHP (PHP Version:8.x, OS:Linux)` | `Postmark Ruby Gem v1.25.1` | `Postmark Java Library: 1.13.0` | runtime default (INFERRED) |
| Extra | — | `X-Postmark-Client: postmark-python`, `X-Postmark-Client-Version`, `X-Postmark-Correlation-Id: <uuid4>` per attempt | — | — | — | — | `X-Postmark-Client: postmark-mcp`, `X-Postmark-Client-Version: 2.1.1`, `X-Postmark-MCP-Client`, optional `X-Agent-Label` |
| Accept-Encoding | undici default (INFERRED) | httpx `gzip, deflate` (INFERRED) | none (INFERRED) | none (INFERRED) | `gzip;q=1.0,deflate;q=0.6,identity;q=0.3` (INFERRED) | `gzip, x-gzip, deflate` (INFERRED) | undici default (INFERRED) |

Citations (all **SDK**):
- postmark.js: `sdk/postmark.js/src/client/BaseClient.ts:109-116`
- python: `sdk/postmark-python/postmark/clients/server_client.py:91-97,132`
- dotnet: `sdk/postmark-dotnet/src/Postmark/PostmarkClientBase.cs:38-39,83-85`, `sdk/postmark-dotnet/src/Postmark/Utility/JsonContent.cs:20-22`
- php: `sdk/postmark-php/src/Postmark/PostmarkClientBase.php:58-59,114-119`
- gem: `sdk/postmark-gem/lib/postmark.rb:28-32`
- java: `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/Postmark.java:37-42,97-100`
- mcp: `sdk/postmark-mcp/index.js:83-92`
- cli: postmark.js 4.0.2, so `Postmark.JS - 4.0.2` (INFERRED)

### 1.3 Request body serialization

| Quirk | postmark.js | python | dotnet | php | gem | java | cli | mcp |
|---|---|---|---|---|---|---|---|---|
| `null` fields | sent as `null` | omitted | **sent as `null`** | top-level omitted, nested sent | sent as `null` | omitted | sent (JS) | omitted |
| Empty strings | as given | — | `""` ReturnPathDomain on domain edit | **model sends `Tag:""`, `Cc:""`, `TrackLinks:""`** | **`Cc:""`, `Bcc:""`, `ReplyTo:""` always** | — | — | omitted |
| Defaults always sent | `Attachment.ContentID: null` | `Headers:[]`, `Attachments:[]`, `Metadata:{}`, `TemplateModel:{}` | `Headers:[]`, `Attachments:[]`, `TrackLinks:"None"`, `InlineCss:true` | `TemplateId:0` + `TemplateAlias:""`, `TemplateModel:[]` (array) | — | `TemplateType:"Standard"` on template create | manifest keys `New`, `Status` (ANSI), `TestRenderModel` | `TrackOpens:true`, `TrackLinks:"HtmlAndText"` |
| Key casing | PascalCase | PascalCase (pydantic aliases) | PascalCase, but **`HTMLBody`** on template create/edit, `ContentId` | **mixed: camelCase** (`name`, `htmlBody`, `layoutTemplate`, `trackLinks`, `fromEmail`) | snake→Pascal, shallow | UpperCamel of bean names: `MessageId`, `ContentId`, **`ReturnPathDOmain`** | PascalCase | PascalCase |
| Bodyless PUT/POST | no body | no body | no body, no Content-Type | no body | body `''` | **literal body `null`** (also on GET/DELETE) | no body | no body, no Content-Type |
| `{}` body | archive, unarchive, activate | — | — | — | — | — | — | — |
| JSON style | compact | compact | **indented; non-ASCII as `\uXXXX`, `/` as `\/`** | `\/`, `\uXXXX` (INFERRED) | compact; attachment base64 wrapped every 60 chars | **pretty-printed** | compact | compact |
| Dates in body | caller strings | none | none | caller strings | `Time#to_s` (INFERRED) | epoch-millis numbers in PATCHed stream (INFERRED) | — | — |
| Enums | strings | strings | strings | strings | strings (`:html_and_text`→`HtmlAndText`) | strings | strings | strings |
| Type oddities | — | `SourceServerID`/`DestinationServerID` as strings | — | `EnableSmtpApiErrorHooks` as string | — | — | `TemplateId` as a JSON string | — |

Citations (all **SDK**):
- postmark.js: `sdk/postmark.js/src/client/HttpClient.ts:44`, `sdk/postmark.js/src/client/models/message/SupportingTypes.ts:43`, `sdk/postmark.js/src/client/ServerClient.ts:228,758,769`
- python: `sdk/postmark-python/postmark/models/outbound/manager.py:86`, `sdk/postmark-python/postmark/models/outbound/schemas.py:121-125`, `sdk/postmark-python/postmark/models/templates/schemas.py:170-171`
- dotnet: `sdk/postmark-dotnet/src/Postmark/Utility/JsonContent.cs:13-17`, `sdk/postmark-dotnet/src/Postmark/Converters/UnicodeJsonStringConverter.cs:47-58`, `sdk/postmark-dotnet/src/Postmark/Model/PostmarkMessageBase.cs:18-19,78`, `sdk/postmark-dotnet/src/Postmark/PostmarkClient.cs:813`
- php: `sdk/postmark-php/src/Postmark/PostmarkClientBase.php:122-125`, `sdk/postmark-php/src/Postmark/Models/PostmarkMessageBase.php:22-33`, `sdk/postmark-php/src/Postmark/Models/TemplatedPostmarkMessage.php:14-17`, `sdk/postmark-php/src/Postmark/PostmarkClient.php:445,1194-1200`
- gem: `sdk/postmark-gem/lib/postmark/message_helper.rb:9-11,38-50`, `sdk/postmark-gem/lib/postmark/inflector.rb:6-8`, `sdk/postmark-gem/lib/postmark/http_client.rb:31-41`
- java: `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/data/parser/DataHandler.java:19-37`, `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/HttpClientHandler.java:43-45,61`, `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/data/model/senders/SignatureToCreate.java:11,40`, `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/data/model/templates/TemplateContent.java:16`
- cli: `sdk/postmark-cli/src/commands/templates/push.ts:409-412`, `sdk/postmark-cli/src/commands/email/template.ts:17-18,94`
- mcp: `sdk/postmark-mcp/index.js:460-474`

### 1.4 Query string building

| Quirk | postmark.js | python | dotnet | php | gem | java | mcp |
|---|---|---|---|---|---|---|---|
| Boolean text | `true`/`false` | `true`/`false` (INFERRED) | **`True`/`False`** (INFERRED) | **`1`/`0`** for `inactive`; `true`/`false` string for `IncludeArchivedStreams` | `true`/`false` | `true`/`false` | `true`/`false` |
| Null value | skipped | skipped | skipped; **inbound `status=`** when null (INFERRED) | skipped (INFERRED) | **`key=` sent** | NPE in client | skipped |
| Dates | ISO from `Date`, else string | `YYYY-MM-DDTHH:MM:SS` (lists), `YYYY-MM-DD` (stats, suppressions) | stats `yyyy-MM-dd`; suppressions `O` = `2020-02-01T00:00:00.0000000` | caller string | `Time#to_s` | `yyyy-MM-dd`, JVM zone | `YYYY-MM-DD` |
| Arrays | repeated keys | — | — | — | Ruby `inspect` string | — | — |
| Space | `+` | `%20` (INFERRED) | `+` | RFC 3986 `%20` (INFERRED) | `+` (CGI.escape) | **not encoded** | `%20` |
| Always-sent paging | `count=100&offset=0` | — | — | `count=100&offset=0`, `templateType=All`, `MessageStreamType=All&IncludeArchivedStreams=false` | `offset=0&count=30` on every list (also streams, webhooks, suppressions) | — | `count=50` |
| Key casing | camelCase (`fromDate`, `messageStream`, `templateType`) | mixed (`fromemail`, `clientName`, `templateType`, `IncludeArchivedStreams`) | mixed (`fromDate` bounces, `fromdate` messages, `Count`/`Offset` templates) | mixed (`messagestream`, `emailFilter`, `MessageStream`, `FromDate`) | caller-given; webhooks PascalCase | caller-given | mixed (`fromdate`, `emailFilter`, `SuppressionReason`) |
| Path params | raw | raw | raw | raw | raw; account ids `.to_i` | raw | `encodeURIComponent` |
| Slash before `?` | no | no | yes: `/templates/?Count=` | yes: `/servers/?count=` | no | yes: `/bounces/?count=` | no |

Citations (all **SDK**):
- postmark.js: `sdk/postmark.js/src/client/HttpClient.ts:85-106`, `sdk/postmark.js/src/client/BaseClient.ts:132-135`
- python: `sdk/postmark-python/postmark/models/outbound/manager.py:229-250`, `sdk/postmark-python/postmark/models/stats/manager.py:37-39`
- dotnet: `sdk/postmark-dotnet/src/Postmark/PostmarkClientBase.cs:31,134-149`, `sdk/postmark-dotnet/src/Postmark/PostmarkClient.cs:133-140,789-794,1105-1106`
- php: `sdk/postmark-php/src/Postmark/PostmarkClientBase.php:132`, `sdk/postmark-php/src/Postmark/PostmarkClient.php:317-340,1275,1554`
- gem: `sdk/postmark-gem/lib/postmark/http_client.rb:65-68`, `sdk/postmark-gem/lib/postmark/client.rb:83-85`
- java: `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/Parameters.java:14-91`
- mcp: `sdk/postmark-mcp/index.js:114-117,944-953`

### 1.5 Response parsing strictness

| Behavior | postmark.js | python | dotnet | php | gem | java | cli | mcp |
|---|---|---|---|---|---|---|---|---|
| Success statuses | 200–299 | 2xx (`raise_for_status`) | **200 only** | **200 only** | **200 only** | **200 only** | 2xx | 2xx |
| Unknown fields | ignored | ignored | ignored | ignored | ignored | ignored | ignored | ignored |
| Missing fields | ignored | **required fields raise `ValidationError`** | default value | default; missing list key warns | nil; missing `TotalCount` breaks paging | null / 0 | crash on field reads | crash on field reads |
| Key case | exact | exact PascalCase (or snake_case) | exact | exact | exact for top keys | **case-insensitive** | exact | exact |
| Dates | not parsed | pydantic ISO 8601 | `DateTime.Parse` (culture-dependent) | not parsed | `Time.parse` on `BouncedAt` | ISO 8601; inbound `Date` RFC 2822 list | not parsed | not parsed |
| Enums | not checked | case-sensitive for MessageStatus, BounceType, TemplateType, BulkJobStatus | string only where a converter exists; **`PostmarkResponse.Status`, `DataRemoval.Status` numeric only** | not checked | not checked | `DataRemovalStatus`, `TemplateType` exact | not checked | not checked |
| Emails | not checked | **`EmailStr` validation** | — | — | — | — | — | — |
| IDs | any | typed int | **`MessageID` must be a GUID** | int types (TypeError on non-numeric) | integer `ErrorCode` | int coercion | — | — |
| Empty 200 body | `{}` | `JSONDecodeError` | `PostmarkResponseException` | defaults / warnings | `JSON::ParserError` | Jackson `IOException` | `{}` | `null`, then crash |
| Non-JSON 2xx | returned as string | `JSONDecodeError` | exception | `[]` | `JSON::ParserError` | IOException | string | `SyntaxError` |

Citations (all **SDK**):
- postmark.js: `sdk/postmark.js/src/client/HttpClient.ts:55-57,113-123`
- python: `sdk/postmark-python/postmark/models/bounces/schemas.py:11,30`, `sdk/postmark-python/postmark/models/outbound/enums.py:4-40`, `sdk/postmark-python/postmark/models/outbound/schemas.py:28,90`
- dotnet: `sdk/postmark-dotnet/src/Postmark/PostmarkClientBase.cs:91-115`, `sdk/postmark-dotnet/src/Postmark/Converters/JsonExtensions.cs:20-27`, `sdk/postmark-dotnet/src/Postmark/Converters/DateTimeConverter.cs:16-21`, `sdk/postmark-dotnet/src/Postmark/Model/PostmarkResponse.cs:14,19`
- php: `sdk/postmark-php/src/Postmark/PostmarkClientBase.php:147-150,177-184`
- gem: `sdk/postmark-gem/lib/postmark/http_client.rb:74-77`, `sdk/postmark-gem/lib/postmark/client.rb:21-28`, `sdk/postmark-gem/lib/postmark/bounce.rb:13`
- java: `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/HttpClientHandler.java:63-68`, `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/data/parser/DataHandler.java:79-84`, `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/data/parser/jackson/CustomDateDeserializer.java:23-29`
- mcp: `sdk/postmark-mcp/index.js:104-110`

### 1.6 Error mapping

| Status / ErrorCode | postmark.js | python | dotnet | php | gem | java | mcp |
|---|---|---|---|---|---|---|---|
| 401 | `InvalidAPIKeyError` | `InvalidAPIKeyException` | `PostmarkValidationException` (Unknown) | `PostmarkException`, body ignored | `InvalidApiKeyError` | `InvalidAPIKeyException` (JSON body required) | generic `Error` |
| 404 | `PostmarkError` | `PostmarkAPIException` | Unknown | `PostmarkException` | `UnexpectedHttpResponseError` | `UnknownException` | generic |
| 422 | `ApiInputError` | `ValidationException` | UserError | `PostmarkException` | `ApiInputError` | `InvalidMessageException` (JSON body required) | generic |
| 422 + ErrorCode 406 | `InactiveRecipientsError` (parses `Message`) | `InactiveRecipientException` (parses `Message`) | — | — | `InactiveRecipientError` (parses `Message`) | — | — |
| 422 + ErrorCode 300 | `InvalidEmailRequestError` | `ValidationException` (also 405, 701) | — | — | `InvalidEmailRequestError` | — | — |
| ErrorCode 10 | — | `InvalidAPIKeyException` | — | — | — | — | token hint |
| 429 | `RateLimitExceededError` | `RateLimitException` (retried) | Unknown | `PostmarkException` | Unexpected | `UnknownException` (+1 retry, INFERRED) | generic |
| 500 | `InternalServerError` | `ServerException` (retried) | ServerError | fixed message | `InternalServerError` | `InternalServerException` | generic |
| 503 | `ServiceUnavailablerError` | `ServerException` (retried) | Unknown | fixed message | Unexpected | `UnknownException` | generic |
| 400/403/other | `UnknownError` | `PostmarkAPIException` | Unknown | `PostmarkException` | Unexpected | `UnknownException` | generic |
| 201 / 204 | success | success | **error** | **error** | **error** | **error** | success |

Inactive-recipient regexes:
- postmark.js and gem: `Found inactive addresses: (.+?)\.? Inactive` and `these inactive addresses: (.+?)\.?$`.
- python: `Found inactive addresses:\s*(.+?)\.(?:\s|$)`.

Citations (all **SDK**):
- postmark.js: `sdk/postmark.js/src/client/errors/ErrorHandler.ts:32-55`, `sdk/postmark.js/src/client/errors/Errors.ts:74-127`
- python: `sdk/postmark-python/postmark/exceptions.py:81-86,115-145`
- dotnet: `sdk/postmark-dotnet/src/Postmark/PostmarkClientBase.cs:102-115`
- php: `sdk/postmark-php/src/Postmark/PostmarkClientBase.php:152-184`
- gem: `sdk/postmark-gem/lib/postmark/error.rb:17-83`
- java: `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/HttpClientErrorHandler.java:28-58`
- mcp: `sdk/postmark-mcp/index.js:105-109`

---

## 2. Endpoint coverage matrix

Cell legend:
- A number is the line where the SDK sends the call.
- `—` means the SDK does not implement the call.
- A backtick path is the exact spelling the SDK sends, when it differs from the spec.
- `/` means the SDK adds a trailing slash.

File keys (all **SDK**):

| Column | File |
|---|---|
| js | `sdk/postmark.js/src/client/ServerClient.ts` (S) and `AccountClient.ts` (A) |
| py | `sdk/postmark-python/postmark/models/<dir>/manager.py`, cell = `dir:line` |
| net | `sdk/postmark-dotnet/src/Postmark/PostmarkClient.cs` (S) and `PostmarkAdminClient.cs` (A) |
| php | `sdk/postmark-php/src/Postmark/PostmarkClient.php` (S) and `PostmarkAdminClient.php` (A) |
| rb | `sdk/postmark-gem/lib/postmark/api_client.rb` (S) and `account_api_client.rb` (A); rails reaches only `/email`, `/email/withTemplate`, `/templates/{x}` GET and validate |
| java | `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/client/ApiClient.java` (S) and `AccountApiClient.java` (A) |
| cli | `sdk/postmark-cli/src/commands/...` |
| mcp | `sdk/postmark-mcp/index.js` |

### 2.1 Paths in `refs/openapi/server.yml` (server token)

| Method | Spec path | Spec line **DOC** | js | py | net | php | rb | java | cli | mcp |
|---|---|---|---|---|---|---|---|---|---|---|
| POST | /email | server.yml:896 | S112 | outbound:84 | S54 | S100 | S15 | S67 `/email/` | raw.ts:91 | 460 |
| POST | /email/batch | server.yml:921 | S123 | outbound:125 | S68 | S162 | S24 | S72 | — | 618 |
| GET | /deliverystats | server.yml:947 | S183 `/deliveryStats` | bounces:29 | S110 | S297 | S98 | S81 `/deliveryStats/` | — | — |
| GET | /bounces | server.yml:968 | S193 | bounces:85 | S131 | S328 | S130 | S86 `/bounces/` | — | 1164 |
| GET | /bounces/{bounceid} | server.yml:1033 | S206 | bounces:122 | S153 | S354 | S139 | S91 | — | — |
| GET | /bounces/{bounceid}/dump | server.yml:1060 | S217 | bounces:132 | S165 | S368 | S143 | S96 | — | 1206 |
| PUT | /bounces/{bounceid}/activate | server.yml:1086 | S228 | bounces:141 | S176 | S382 | S147 | S101 | — | 1229 |
| GET | /messages/outbound | server.yml:1114 | S330 | outbound:251 | S200 | S482 | S107 | S220 `/` | — | 943 |
| GET | /messages/outbound/{id}/details | server.yml:1174 | S345 | outbound:293 | S230 | S512 | S122 | S225 | — | 985 |
| GET | /messages/outbound/{id}/dump | server.yml:1200 | S357 | outbound:298 | S240 | S525 | S126 | S235 | — | — |
| GET | /messages/inbound | server.yml:1226 | S367 | inbound:52 | S263 | S558 | S107 | S264 `/` | — | — |
| GET | /messages/inbound/{id}/details | server.yml:1294 | S381 | inbound:63 | S284 | S582 | S122 | S269 | — | — |
| PUT | /messages/inbound/{id}/bypass | server.yml:1320 | S392 | inbound:70 | S294 | S595 | — | S274 | — | — |
| PUT | /messages/inbound/{id}/retry | server.yml:1346 | S403 | inbound:77 | S304 | S607 | — | S279 | — | — |
| GET | /messages/outbound/opens | server.yml:1372 | S413 | outbound:364 | S411 | S648 | S151 | S240 | — | — |
| GET | /messages/outbound/opens/{messageid} | server.yml:1463 | S427 | outbound:381 | S494 | S739 | S169 | S245 | — | — |
| GET | /messages/outbound/clicks | server.yml:1504 | S440 | outbound:453 | S457 | S706 | S155 | S250 | — | — |
| GET | /messages/outbound/clicks/{messageid} | server.yml:1595 | S455 | outbound:470 | S513 | S761 | S176 | S255 | — | — |
| POST | /email/withTemplate | server.yml:1638 | S134 | outbound:169 | S877 | S249 | S51 | S167 | template.ts:93 | 514 |
| POST | /email/batchWithTemplates | server.yml:1665 | S146 | outbound:198 | S903 | S199 | S85 | S177 | — | 673 |
| GET | /templates | server.yml:1692 | S238 | templates:84 | S789 `/` | S1280 | S226 | S134 `/` | pull.ts:109 | 690 |
| POST | /templates | server.yml:1724 | S274 `/` | templates:49 | S811 `/` | S1194 | S238 | S119 `/` | push.ts:409 `/` | 773 |
| GET | /templates/{templateIdOrAlias} | server.yml:1749 | S252 | templates:41 | S764 | S1247 | S234 | S109 | pull.ts:160 | 724 |
| PUT | /templates/{templateIdOrAlias} | server.yml:1774 | S286 | templates:62 | S833 | S1228 | S244 | S124 | push.ts:412 | 813 |
| DELETE | /templates/{templateIdOrAlias} | server.yml:1804 | S263 | templates:90 | S857 | S1168 | S250 | S139 | test only | 856 |
| POST | /templates/validate | server.yml:1830 | S299 | templates:98 | S997 | S1312 | S254 | S147 | pull.ts:229 | 885 |
| GET | /stats/outbound | server.yml:1856 | S470 | stats:53 | S528 | S791 | S293 | S288 `/` | — | 1378 |
| GET | /stats/outbound/sends | server.yml:1891 | S482 | stats:67 | S543 | S818 | S297 | S293 | — | 1380 |
| GET | /stats/outbound/bounces | server.yml:1926 | S494 | stats:81 | S558 | S845 | S297 | S298 | — | 1381 |
| GET | /stats/outbound/spam | server.yml:1983 | S506 | stats:95 | S572 | S872 | S297 | S303 | — | 1382 |
| GET | /stats/outbound/tracked | server.yml:2028 | S518 | stats:109 | S586 | S899 | S297 | S308 | — | 1383 |
| GET | /stats/outbound/opens | server.yml:2073 | S530 | stats:123 | S600 | S926 | S297 | S313 | — | 1384 |
| GET | /stats/outbound/opens/platforms | server.yml:2122 | S542 | stats:137 | S614 | S953 | S297 | S318 | — | 1385 |
| GET | /stats/outbound/opens/emailclients | server.yml:2179 | S554 `emailClients` | stats:151 | S627 | S980 | S297 | **S323 calls `opens/platforms` (bug)** | — | 1386 `emailClients` |
| GET | /stats/outbound/clicks | server.yml:2226 | S577 | stats:165 | — | S1028 | S297 | S333 | — | 1388 |
| GET | /stats/outbound/clicks/browserfamilies | server.yml:2261 | S588 `browserFamilies` | stats:179 | — | S1055 | S297 | S338 | — | 1389 `browserFamilies` |
| GET | /stats/outbound/clicks/platforms | server.yml:2296 | S600 | stats:193 | — | S1083 | S297 | S343 | — | 1390 |
| GET | /stats/outbound/clicks/location | server.yml:2331 | S613 | stats:207 | — | S1111 | S297 | S348 | — | 1391 |
| POST | /triggers/inboundrules | server.yml:2367 | S624 `inboundRules` | inbound_rules:27 | S723 | S1124 | S191 | S359 `inboundRules/` | — | — |
| GET | /triggers/inboundrules | server.yml:2395 | S645 `inboundRules` | inbound_rules:13 | S750 | S1144 | S206 | S368 `inboundRules/` | — | — |
| DELETE | /triggers/inboundrules/{triggerid} | server.yml:2437 | S635 `inboundRules` | inbound_rules:32 | S734 | S1156 | S201 | S364 `inboundRules` | — | — |
| GET | /server | server.yml:2464 | S309 | servers:15 | S319 | S393 | S217 | S202 `/server/` | — | 155 |
| PUT | /server | server.yml:2484 | S320 | servers:96 | S335 | S433 | S221 | S207 `/server/` | — | — |

Notes:
- `rb S297` is the generic `get_stats_counts(stat, type)`, which builds any `/stats/outbound/{stat}/{type}` path.
- `rb S107` and `S122` pick outbound or inbound with a flag.

### 2.2 Paths in `refs/openapi/account.yml` (account token)

| Method | Spec path | Spec line **DOC** | js | py | net | php | rb | java | cli |
|---|---|---|---|---|---|---|---|---|---|
| GET | /servers/{serverid} | account.yml:393 | A64 | servers(account):16 | A41 | A45 | A125 | A45 | — |
| PUT | /servers/{serverid} | account.yml:418 | A87 | servers(account):179 | A135 | A123 | A125 | A55 | — |
| DELETE | /servers/{serverid} | account.yml:447 | A98 | servers(account):211 | A63 | A78 | A125 | A65 | — |
| GET | /servers | account.yml:471 | A51 | servers(account):200 | A383 | A60 `/` | A113 | A60 `/` | list.ts:92 |
| POST | /servers | account.yml:505 | A75 | servers(account):96 | A87 `/` | A185 `/` | A125 | A50 `/` | — |
| GET | /senders | account.yml:531 | A221 | signatures:30 | A165 | A218 `/` | A11 | A120 `/` | — |
| POST | /senders | account.yml:564 | A235 `/` | signatures:60 | A238 `/` | A248 `/` | A26 | A130 `/` | — |
| GET | /senders/{signatureid} | account.yml:589 | A211 | signatures:38 | A178 | A230 | A26 | A125 | — |
| PUT | /senders/{signatureid} | account.yml:614 | A248 | signatures:91 | A261 | A270 | A26 | A135 | — |
| DELETE | /senders/{signatureid} | account.yml:643 | A260 | signatures:105 | A189 | A287 | A26 | A140 | — |
| POST | /senders/{signatureid}/resend | account.yml:669 | A271 | signatures:112 | A200 | A300 | A45 | A144 | — |
| POST | /senders/{signatureid}/verifyspf | account.yml:695 | A282 `verifySpf` | signatures:122 | A223 | — | A45 | A148 `verifySPF` | — |
| POST | /senders/{signatureid}/requestnewdkim | account.yml:721 | A293 `requestNewDkim` | signatures:132 | A211 | — | A45 | A153 `requestNewDKIM` | — |
| GET | /domains | account.yml:754 | A108 | domains:29 | A279 | A317 `/` | A65 | A74 `/` | — |
| POST | /domains | account.yml:787 | A132 `/` | domains:57 | A326 `/` | A343 `/` | A77 | A84 `/` | — |
| GET | /domains/{domainid} | account.yml:812 | A121 | domains:37 | A293 | A329 | A77 | A79 | — |
| PUT | /domains/{domainid} | account.yml:837 | A144 | domains:79 | A345 | A361 | A77 | A89 | — |
| DELETE | /domains/{domainid} | account.yml:866 | A156 | domains:84 | A304 | A390 | A77 | A94 | — |
| PUT | /domains/{domainid}/verifydkim | account.yml:892 | A167 `verifyDKIM` | domains:89 `verifyDkim` | A359 | A403 `verifyDkim` | A93 | A98 `verifyDKIM` | — |
| PUT | /domains/{domainid}/verifyreturnpath | account.yml:918 | A178 `verifyReturnPath` | domains:94 `verifyReturnPath` | A370 | A416 `verifyReturnPath` | A93 | A103 `verifyReturnPath` | — |
| POST | /domains/{domainid}/verifyspf | account.yml:944 | A189 `verifySPF` | domains:104 | — | — | A101 | A108 `verifySPF` | — |
| POST | /domains/{domainid}/rotatedkim | account.yml:970 | A200 `rotateDKIM` | domains:109 | A315 | A430 | A101 | A112 `rotateDKIM` | — |
| PUT | /templates/push | account.yml:1003 | A304 | templates(account):23 | — | — | A143 | A161 | — |

mcp calls no account endpoint.

### 2.3 Paths in the docs but not in the spec

| Method | Path (docs) | Docs line **DOC** | js | py | net | php | rb | java | mcp |
|---|---|---|---|---|---|---|---|---|---|
| POST | /email/bulk | api_bulk-email.md:18 | S162 | outbound:146 | S85 | — | — | — | — |
| GET | /email/bulk/{bulk-request-id} | api_bulk-email.md:244 | S173 | outbound:156 | S97 | — | — | — | — |
| GET | /email/bulk (list, `count`, `paginationKey`) | api_bulk-email.md:326 | — | — | — | — | — | — | — |
| GET | /message-streams | api_message-streams-api.md:10 | S712 | streams:28 | S1230 `/` | S1557 | S332 | S441 `/` | — |
| GET | /message-streams/{stream_ID} | api_message-streams-api.md:125 | S724 | streams:40 | S1219 | S1543 | S341 | S451 | — |
| PATCH | /message-streams/{stream_ID} | api_message-streams-api.md:185 | S736 | streams:107 | S1208 | S1528 | S350 | S456 | — |
| POST | /message-streams | api_message-streams-api.md:266 | S747 | streams:61 | S1164 `/` | S1508 | S345 | S462 `/` | — |
| POST | /message-streams/{stream_ID}/archive | api_message-streams-api.md:357 | S758 | streams:114 | S1247 | S1574 | S355 | S467 | — |
| POST | /message-streams/{stream_ID}/unarchive | api_message-streams-api.md:402 | S769 | streams:121 | S1260 | S1588 | S355 | S472 | — |
| GET | /message-streams/{stream_id}/suppressions/dump | api_suppressions-api.md:10 | S779 | suppressions:45 | S1101 | S1481 | S363 | S410 | 1260 |
| POST | /message-streams/{stream_id}/suppressions | api_suppressions-api.md:78 | S794 | suppressions:62 | S1127 | S1430 | S368 | S424 `/` | 1298 |
| POST | /message-streams/{stream_id}/suppressions/delete | api_suppressions-api.md:175 | S807 | suppressions:82 | S1144 | S1451 | S373 | S432 | 1329 |
| GET | /webhooks | api_webhooks-api.md:12 | S657 | webhooks:16 | S1030 `/` | S1345 | S306 | S377 `/` | 1449 |
| GET | /webhooks/{Id} | api_webhooks-api.md:137 | S669 | webhooks:23 | S1019 | S1332 | S312 | S386 | — |
| POST | /webhooks | api_webhooks-api.md:234 | S680 | webhooks:47 | S1058 `/` | S1381 | S312 | S391 `/` | 1509 |
| PUT | /webhooks/{Id} | api_webhooks-api.md:478 | S692 | webhooks:92 | S1086 | S1410 | S312 | S396 | — |
| DELETE | /webhooks/{Id} | api_webhooks-api.md:741 | S703 | webhooks:97 | S1042 | S1359 | S312 | S401 | 1557 |
| POST | /webhooks/{Id}/verify | api_webhooks-api.md:683 | — | — | — | — | — | — | — |
| GET | /webhooks/{Id}/statistics | api_webhooks-api.md:786 | — | — | — | — | — | — | — |
| POST | /data-removals (account) | api_data-removals-api.md:12 | A315 | data_removals:16 | A400 | A450 | A153 | A166 `/` | — |
| GET | /data-removals/{id} (account) | api_data-removals-api.md:76 | A326 | data_removals:27 | A415 | A466 | A149 | A171 | — |

Note on `/messages/outbound/opens/{messageid}`:
- The brief listed it as a path the spec lacks.
- It is in the spec at `refs/openapi/server.yml:1463` **DOC**.
- The spec and docs have no `GET /bounces/tags`.

### 2.4 Paths that SDKs send but neither the spec nor the docs list

| Method | Path | Who sends it | Citation **SDK** | Mock decision |
|---|---|---|---|---|
| GET | /stats/outbound/opens/readtimes | js `readTimes` S565; py `readTimes` stats:221; net S673; php S993; rb (spec test `opens/readtimes`); java `readTimes` S328; mcp `readTimes` 1387 | as listed; `sdk/postmark-gem/spec/unit/postmark/api_client_spec.rb:1022` | Needs a capture. The response shape is unknown. |
| PUT | /domains/{id}/verifyCustomTracking | php only | `sdk/postmark-php/src/Postmark/PostmarkAdminClient.php:376-378` | Unknown API. Needs a capture. |
| GET | /triggers/{type}/{id} and /triggers/tags | gem only | `sdk/postmark-gem/lib/postmark/api_client.rb:191-215` | Likely a retired API (INFERRED). |
| GET | /messages/inbound/{id}/dump | gem (`dump_message(id, inbound: true)`) | `sdk/postmark-gem/lib/postmark/api_client.rb:126-128` | Unknown. Needs a capture. |
| GET | / and /someweirdlink | java unit tests | `sdk/postmark-java/src/test/java/unit/client/HttpClientTest.java:18-31` | Unknown-route status and body: pending capture (`docs/02` Q9). |

### 2.5 Path spelling disagreements

The router must match paths without regard to case and must ignore a trailing slash. A trailing slash before `?` also occurs.

| Spec / docs spelling | SDK spellings | Citations |
|---|---|---|
| `/deliverystats` (server.yml:947) | `/deliveryStats` (js), `/deliveryStats/` (java) | js S183; java S81 **SDK** |
| `/triggers/inboundrules` (server.yml:2367) | `/triggers/inboundRules` (js), `/triggers/inboundRules/` (java) | js S624; java S48,359 **SDK** |
| `/stats/outbound/opens/emailclients` (server.yml:2179) | `emailClients` (js, mcp) | js S554; mcp 1386 **SDK** |
| `/stats/outbound/clicks/browserfamilies` (server.yml:2261) | `browserFamilies` (js, mcp) | js S588; mcp 1389 **SDK** |
| `/domains/{id}/verifydkim` (account.yml:892); docs `verifyDkim` (api_domains-api.md:385) | `verifyDKIM` (js, java), `verifyDkim` (py, php), lowercase (net, rb) | see 2.2 |
| `/domains/{id}/verifyreturnpath` (account.yml:918); docs `verifyReturnPath` (api_domains-api.md:460) | camelCase (js, py, php, java), lowercase (net, rb) | see 2.2 |
| `/domains/{id}/verifyspf`, `/rotatedkim` | `verifySPF`, `rotateDKIM` (js, java) | see 2.2 |
| `/senders/{id}/verifyspf`, `/requestnewdkim` | `verifySpf`/`requestNewDkim` (js), `verifySPF`/`requestNewDKIM` (java) | see 2.2 |
| `/email/withTemplate` (server.yml:1638); docs heading `/email/withTemplate/` (api_templates-api.md:12) | no slash (all) | — |
| `/email` | `/email/` (java) | java S49,67 |
| collection POST/GET | trailing `/` on templates, servers, senders, domains, webhooks, message-streams, suppressions (js, net, php, java, cli) | see 2.1–2.3 |
| `PUT /templates/push` vs `PUT /templates/{templateIdOrAlias}` | Match the literal `push` first | account.yml:1003; server.yml:1774 **DOC** |

---

## 3. Spec quality: corrections needed before codegen

Totals **DOC**:
- The docs list 87 operations. The two specs list 66.
- The 21 missing operations are in section 2.3: message-streams 6, suppressions 3, webhooks 7, bulk 3, data-removals 2.
- Both files parse, and no `$ref` is broken.
- Where the SDK and docs columns agree against the spec, patch the spec. Where they disagree with each other, see section 6.

### 3.1 Field and type corrections

| # | Spec location **DOC** | Spec says | Docs say **DOC** | SDKs say **SDK** | Fix |
|---|---|---|---|---|---|
| 1 | server.yml:18-57 `SendEmailRequest`; :58-103 `EmailWithTemplateRequest` | no `Metadata`, `MessageStream`; no `required` | api_email-api.md:42-56; api_templates-api.md:44-59 | all send both | Add both fields. Require `From`, `To`, and HtmlBody or TextBody. |
| 2 | server.yml:98-100 | requires both `TemplateId` and `TemplateAlias` | one of the two (api_templates-api.md:44-45) | php model sends `TemplateId:0` + `TemplateAlias:""` (`TemplatedPostmarkMessage.php:14-17`) | Require exactly one non-empty value. |
| 3 | server.yml:71-82 | `format: email` on From/To/Cc/Bcc | "Name <addr>", comma lists | java `"a@x","b@x"` (`BaseMessage.java:355-372`) | Remove `format: email`. |
| 4 | server.yml:246-259 batch item | `MessageID`, `To`, `SubmittedAt` present | error item has only ErrorCode + Message (api_email-api.md:309-312) | **py requires all three** (`outbound/schemas.py:96-101`); **net needs a GUID or absence, not null** (`PostmarkResponse.cs:14`) | Keep optional in types. Section 6, question 3 covers what the mock emits. |
| 5 | server.yml:406-409 `TemplateListingResponse` | array named `"Templates API"`; `TotalCount` number | `Templates`, integer (api_templates-api.md:703-714) | all read `Templates` | Rename the array. Make `TotalCount` an integer. |
| 6 | server.yml:491 `TemplateDetailResponse` | `TemplateID` | `TemplateId` (api_templates-api.md:459,478) | js, py, net, php read `TemplateId`, case-sensitive | Rename to `TemplateId`. |
| 7 | server.yml:377,483,178,199,148 | no `TemplateType`, `LayoutTemplate` | present (api_templates-api.md:467-468,544-545,569-570,818-819) | py requires `TemplateType`; java always sends it | Add both. `LayoutTemplate` is `x-nullable`. |
| 8 | server.yml:1701-1712 GET /templates query | `Count`/`Offset` as `number, format: int`; no `TemplateType`/`LayoutTemplate` | integers; `TemplateType`, `LayoutTemplate` (api_templates-api.md:694-697) | js/py/php/mcp `count`; net `Count` | Make the params integers. Add the filters. Match keys without case. |
| 9 | server.yml:196-198, :217-218 | Create requires `Subject`; Edit requires a missing `TemplateId` | Subject only for Standard templates (api_templates-api.md:543) | cli/mcp create Layout templates with no Subject | Create requires `[Name]`. Drop the Edit `required`. |
| 10 | server.yml:1820-1824 | DELETE template returns `TemplateDetailResponse` | ErrorCode + Message (api_templates-api.md:760-761) | — | Use `StandardPostmarkResponse`. |
| 11 | account.yml:359-362 push | `SourceServerId`, `DestinationServerId` | `SourceServerID`, `DestinationServerID` (api_templates-api.md:378-389) | js `ID` (`Template.ts:83-84`); py sends strings | Rename to `ID`. Accept a string or integer. |
| 12 | server.yml:326-327 `BounceInfoResponse.ID` | string | integer (api_bounce-api.md:158) | js/py/net/java use a number | Make it an integer (int64). Add `RecordType`, `ServerID`, `MessageStream`, `From`. py requires `ServerID` and `MessageStream`. |
| 13 | server.yml:994-995 bounce `type` enum | has `'MailFrontier Matador.'`; lacks `ChallengeVerification` | api_bounce-api.md:409 | mcp sends `ChallengeVerification` | Fix the enum. |
| 14 | server.yml:1013-1022, :1154-1163, :1274-1283 | `format: date` | date-time with no zone (api_bounce-api.md:117-118) | py `YYYY-MM-DDTHH:MM:SS`; net suppressions `...0000000` | Use a plain string. Parse leniently. |
| 15 | server.yml:973, :1119, :1377, :1509, :1861-2364 | no `messagestream` query | present (api_bounce-api.md:119; api_stats-api.md:37) | js, py, php, net, mcp send it | Add it everywhere. |
| 16 | server.yml:1149-1153 | status enum `queued`/`sent`; no `subject`, `metadata_*` | `processed`, `subject`, `metadata_*` (api_messages-api.md:39-44) | net default `processed`; php/py/js send `metadata_*` | Add them. |
| 17 | server.yml:740, :509 outbound message | no `MessageStream`, `Metadata`, `Sandboxed` | api_messages-api.md:65,84-88 | **py requires `MessageStream`, `Sandboxed`** | Add them. |
| 18 | server.yml:608-717 open/click events | no `RecordType`, `MessageStream` | api_messages-api.md:656,659 | **py requires `RecordType`** | Add them. |
| 19 | server.yml:728-739 event `Details` | no `Origin`, `SuppressSending`, `Link`, `ClickLocation` | api_messages-api.md:223-234 | java reads `Map<String,String>` | Add them as strings. |
| 20 | server.yml:847-857 `Attachment` | no `ContentLength` | api_messages-api.md:362 | net int/long | Add as integer. |
| 21 | server.yml:111, :280 `Color` | lowercase, `turqoise`, no `orange` | api_server-api.md:35 | py Title-case + Orange, case-insensitive; cli knows `turquoise`, `orange` | Use the corrected list. Match without case. |
| 22 | account.yml:60, :94, :126 `TrackLinks` | `HtmlAndTextTracking`, etc. | `HtmlAndText` (api_servers-api.md:50) | all SDKs use `HtmlAndText` | Fix the enum. |
| 23 | server.yml:105, :266; account.yml:25, :69, :101 | no `DeliveryType`, `IncludeBounceContentInHook`, `EnableSmtpApiErrorHooks` | api_server-api.md:38,51,53 | **py requires all three**; net/java tests assert `DeliveryType:"Live"` | Add them. |
| 24 | account.yml:187, :275, :327 | `DKIMTestValue` | `DKIMTextValue` | js, net, java read `DKIMTextValue` | Rename the field. |
| 25 | account.yml:160-241 signatures | no `ConfirmationPersonalNote`; no `required` | api_signatures-api.md:129,198-202 | php, py, net send it | Add it. Require `FromEmail` and `Name` on create. |
| 26 | server.yml:580-587 stats | `SMTPAPIErrors`; rates are integers | `SMTPApiErrors`; doubles (api_stats-api.md:45-48,70) | php, net, mcp read `SMTPApiErrors`; php/net use doubles | Rename the field. Make the rates `number`. |
| 27 | server.yml:16-17, :2220, :2255, :2325, :2360 | `DynamicResponse` | fixed shapes (api_stats-api.md:646-648,800-802,872-873) | net requires integer keys + `Days` for emailclients/readtimes (`PostmarkClient.cs:627-704`) | Use fixed schemas. emailclients/browserfamilies get `additionalProperties: integer` plus `Days`. |
| 28 | server.yml:219-224 inbound `Rule` | `format: email`, not required | domain allowed (api_inbound-rules-triggers-api.md:61,98) | — | Remove `format: email`. Require `Rule`. |
| 29 | server.yml:239-245 `StandardPostmarkResponse` | no `Errors` map | bulk code 11 has `Errors` (api_bulk-email.md:214-231) | — | Add an optional `Errors` map. |

### 3.2 Structural (Swagger 2.0) fixes

| # | Problem | Location **DOC** |
|---|---|---|
| S1 | 40 of 45 server definitions and 19 of 19 account definitions have no `type: object` | e.g. server.yml:18; account.yml:25 |
| S2 | `type: number, format: int` is not a valid format | server.yml:386-387, :1705-1712 |
| S3 | Two operations have no operationId (dump, create template) | server.yml:1060, :1724 |
| S4 | The token header is repeated on all 66 operations; there are no `securityDefinitions` | server.yml:902-906; account.yml:399-403 |
| S5 | 11 body parameters are not `required: true` | server.yml:907, :932, :1841, :2378, :2495; account.yml:434, :516, :575, :630, :798, :853 |
| S6 | `StandardPostmarkResponse`, `422` and `500` are duplicated across the two files | server.yml:239, :885-891; account.yml:18, :382-388 |
| S7 | No 401, 404, 413, 415, 429 or 503 response shapes | server.yml:885-891; api_overview.md:27-63 |
| S8 | Nullable fields have no `x-nullable` | api_templates-api.md:568,729,842 |
| S9 | Anonymous inline schemas: FromFull, Client, OS, Geo, event Details, stats Days | server.yml:420-426, :613-653, :728-739, :1955-2022 |

### 3.3 Doc self-contradictions to resolve by capture

| Contradiction | Citation **DOC** |
|---|---|
| Bulk POST response uses `Id`; python requires `ID` | api_bulk-email.md:189,203 vs `sdk/postmark-python/postmark/models/outbound/schemas.py:264` **SDK** |
| Bulk status `Cancelled`; js/py know `Failed` | api_bulk-email.md:190 vs `sdk/postmark.js/src/client/models/message/BulkEmail.ts:93`, `sdk/postmark-python/postmark/models/outbound/enums.py:36-40` **SDK** |
| Data-removal `Status` is a string; dotnet parses it as a number | api_data-removals-api.md:59,68 vs `sdk/postmark-dotnet/src/Postmark/Model/PostmarkDataRemoval.cs:13` **SDK** |
| Stream archive `ID` is a string; js types it as a number | api_message-streams-api.md:381,392 vs `sdk/postmark.js/src/client/models/streams/MessageStream.ts:31` **SDK** |
| `DeliveryType` is boolean in one table and string in another | api_server-api.md:171 vs :38 |
| Webhook `Verify` goes in the query or in the body | api_overview.md:221 vs api_webhooks-api.md:306,358 |
| `UnsubscribeHandlingType` is `none` or `None` | api_message-streams-api.md:213,312 |
| GET template example has a string `"null"` | api_templates-api.md:498 |
| Inbound list key: table says `Messages`, example says `InboundMessages` | api_messages-api.md:324 vs :334 |

---

## 4. Union: what the mock must accept and emit

This list merges sections 1–3. A mock that follows it serves every SDK. Items marked **conflict** have no single answer; see section 6.

### 4.1 Accept (request side)

| # | Rule | Driven by **SDK** |
|---|---|---|
| R1 | For SDK conformance suites: serve plain http on any host:port at the root path. Clients with a fixed host need TLS at the real hostnames (`docs/01`). | all except cli/mcp |
| R2 | Match paths without regard to case. Ignore a trailing slash, also before `?`. | js, java, net, php (section 2.5) |
| R3 | Match query keys without regard to case. Match `metadata_*` as a prefix. | all (section 1.4) |
| R4 | Accept query booleans as `true`, `True` or `1` (and the false forms). Treat an empty `key=` as absent. | net, php, gem |
| R5 | Accept query dates as `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS`, or `...0000000` with 7 digits and no zone. Accept a one-digit month or day (`2026-9-7`; `sdk/postmark.js/test/integration/MessageStatistics.test.ts:13-15`) | py, net, java, js |
| R6 | Accept `count`/`offset` on every list, including webhooks, message-streams and suppressions | gem, js, php |
| R7 | Accept a body that is empty, `{}`, or the literal `null`, with or without `Content-Type`, on every method | java, js, net, mcp |
| R8 | Match JSON body keys without regard to case (`HTMLBody`, `htmlBody`, `ContentId`, `MessageId`, `SourceServerId`) | net, php, java, js |
| R9 | Treat `null` and `""` as absent for optional scalars. Accept `TrackLinks:""`. | net, php, gem |
| R10 | Accept `TemplateModel` as `[]`. Accept `TemplateId: 0` beside a non-empty alias. Accept `TemplateId` as a numeric string. | php, cli |
| R11 | Decode base64 that contains newlines | gem |
| R12 | Ignore unknown body keys (`New`, `Status`, `TestRenderModel` on template create) | cli |
| R13 | Accept indented JSON, `\uXXXX` escapes, `\/`, and UTF-8 when no charset is given | net, java, php |
| R14 | Ignore all extra headers (`X-Postmark-Client*`, `X-Postmark-Correlation-Id`, `X-Agent-Label`) | py, mcp |
| R15 | Accept the `POSTMARK_API_TEST` token. Reject unknown tokens with 401 plus a JSON body. | gem, rails, java, mcp, py Django |

### 4.2 Emit (response side)

| # | Rule | Driven by **SDK** |
|---|---|---|
| E1 | Use HTTP **200** for every success, including create and delete. Never use 201 or 204. | net, php, gem, java |
| E2 | Always send a JSON body with `Content-Type: application/json`. The charset suffix is pending capture (`docs/02` Q4). | py, net, gem, java, mcp |
| E3 | Errors: JSON `{"ErrorCode": <int>, "Message": <str>}`. Use the status the code table gives: 401, 422, 429, 500, 503, plus 404 (ErrorCode 12, 501) and 400 (ErrorCode 1002) (**DOC** `refs/api_overview.md:66,118,162`; `docs/02` §4.2). Use 422 for other validation or business errors. | all |
| E4 | For ErrorCode 406, `Message` contains `Found inactive addresses: a@x, b@y. Inactive recipients ...` | js, py, gem |
| E5 | Use exact PascalCase keys as in the docs: `TemplateId`, `SMTPApiErrors`, `DKIMTextValue`, `ID` for numbers, `Templates` | py, net, php |
| E6 | IDs are JSON numbers, except stream `ID` and bulk ID, which are strings | js tests, php, net |
| E7 | `MessageID` is a UUID string | net, gem, java tests |
| E8 | Datetimes are ISO 8601 with offset or `Z`. Inbound `Date` is RFC 2822. Stats `Date` is `YYYY-MM-DD`. | py, net, java, gem |
| E9 | Always include list wrapper keys and `TotalCount`, even when empty. `TotalCount` must equal the number of reachable items. | php, py, gem (infinite loop otherwise) |
| E10 | Emit every field that the docs show: `DeliveryType`, `Sandboxed`, `MessageStream`, `RecordType`, the 6 webhook `Triggers`, `TemplateType`, `TypeCode`, and others | py, php |
| E11 | Batch endpoints return 200 with an array. Per-item errors go inside the array. | all |
| E12 | Email addresses in responses pass `email-validator`. Avoid `.test` and `.local` domains (INFERRED). | py |
| E13 | Do not gzip responses | net (INFERRED) |
| E14 | **decided**: a batch error item is `{ErrorCode, Message}` only, as the docs show (`refs/api_email-api.md:301-313` **DOC**). DOC outranks other SDK code (`docs/11` B3). Consequence: postmark-python `SendResponse` requires `To`, `SubmittedAt` and `MessageID` (`sdk/postmark-python/postmark/models/outbound/schemas.py:96-101` **SDK**), so a python batch with one failed item raises a validation error. A capture (`docs/03` §8 Q14) can reopen this. | py vs docs |
| E15 | **conflict**: bulk POST `ID` (py) vs `Id` (docs); `Cancelled` status (docs) vs no such value (py) | py vs docs |
| E16 | **conflict**: data-removal `Status` `"Pending"` (docs, java, php, gem tests) vs a number (net) | net vs docs |

---

## 5. Conformance test approach

### 5.1 Recommendation

Summary:
- Run each SDK's own **live-integration** suite against the mock.
- Use no SDK or test code edits where possible. Put a preload shim outside the repo where needed.
- Seed the mock with fixture data.
- Treat each suite's results as the conformance signal.
- Unit suites prove nothing about the server. Run them only as a sanity check.

Suite order by value:
1. **postmark.js integration.** 80 cases; the TypeScript reference client.
2. **dotnet** and **php.** Both take the base URL from config or env, with no shim.
3. **java.** Needs a small edit or a hosts-file + TLS setup.
4. **gem** and **rails.** Need a Ruby `--require` shim.
5. **cli.** Needs TLS or a proxy.
6. **mcp smoke tests.** Need a fetch shim.
7. **python.** Has no live suite. Write a thin runner that calls the examples with `base_url`.

### 5.2 Per-SDK commands and reach

| SDK | Install + run | Token / host config | Point at mock | Unit (no server) | Live integration | Mock-runnable | Blockers |
|---|---|---|---|---|---|---|---|
| postmark.js | `npm ci && npm install --no-save typescript@4.7.4`, then `npx mocha --timeout 30000 --retries 1 -r ts-node/register -r /abs/preload.js 'test/integration/**/*test.ts'` | `.env`: `SERVER_API_TOKEN`, `ACCOUNT_API_TOKEN`, `SENDER_EMAIL_ADDRESS`, `RECIPIENT_EMAIL_ADDRESS`, `DOMAIN_NAME`. `API_URL` is listed but nothing reads it. | Preload sets `HttpClient.DefaultOptions = {useHttps:false, requestHost:"localhost:PORT", timeout:180}` | 7 files / 78 cases | 16 files / 80 cases | ~all with a stateful mock | exact error strings; new server has 3 default streams; `broadcast` stream exists; seeded bounces and inbound messages |
| python | `poetry install && poetry run pytest` | example.env: `POSTMARK_SERVER_TOKEN`, `POSTMARK_ACCOUNT_TOKEN`, `POSTMARK_SENDER_EMAIL` | `base_url=` kwarg only; no env var | 25 files / 423 cases, all stubbed | 0 | 0% of pytest; 174 example scripts need a `base_url` edit or runner | no live suite |
| dotnet | `dotnet build --configuration release src/ && dotnet test --configuration release src/` | `testing_keys.json` (searched up from the test dir) or env: `WRITE_ACCOUNT_TOKEN`, `WRITE_TEST_SERVER_TOKEN`, `READ_*_TOKEN` ×3, `WRITE_TEST_SENDER_EMAIL_ADDRESS`, `WRITE_TEST_EMAIL_RECIPIENT_ADDRESS`, `WRITE_TEST_SENDER_SIGNATURE_PROTOTYPE`, `BASE_URL` | `BASE_URL=http://localhost:PORT` (env or file) | 1 file / 4 cases | 17 files / 107 cases (7 skipped) | ~75 CRUD + ~25 that need seeded data | the tests target netcoreapp3.1 with `xunit.runner.visualstudio` 2.8.2 (`sdk/postmark-dotnet/src/Postmark.Tests/Postmark.Tests.csproj:3,11` **SDK**); that package ships only `net462` and `net6.0` builds, so vstest finds no test (**LIB**, local run); the runner builds the tests for `net8.0`; exact counts (10 then 9 templates, 5 streams) conflict with parallel classes |
| php | `composer install && composer test` | `testing_keys.json` or env: `WRITE_ACCOUNT_TOKEN`, `WRITE_TEST_SERVER_TOKEN`, `READ_*` ×4, `WRITE_TEST_*` ×4, `BASE_URL`, `TEST_TIMEOUT` | `BASE_URL=http://localhost` on **port 80** (a URI test rejects other ports) | 1 case | 17 files / 86 cases | ~all | `sleep(180)` in bounce test, `sleep(10)` in data removal; bounce-address simulation; `[token]` vs `[TOKEN]` prototype mismatch |
| gem | `bundle install && SPEC_OPTS="--require /abs/mock_host.rb" bundle exec rspec spec/integration` | env: `POSTMARK_API_KEY`, `POSTMARK_ACCOUNT_API_KEY`, `POSTMARK_CI_RECIPIENT`, `POSTMARK_CI_SENDER`; some specs hardcode `POSTMARK_API_TEST` | Shim prepends `Postmark::HttpClient#initialize` with `{host:'localhost', port:N, secure:false}`. Apply it to integration specs only. | 15 files / ~494 | 5 files / ~41 | all | exact `This DKIM is already being renewed.`; messages must be visible at once (else 20×3 s sleeps) |
| rails | `bundle install && SPEC_OPTS="--require /abs/mock_host.rb" bundle exec rake spec` | hardcoded `POSTMARK_API_TEST` | Same shim. The `before` block overwrites settings. | 3 files / ~19 | 2 files / ~7 | all | none beyond the shim |
| java | `mvn install -DskipTests -Dgpg.skip -Dmaven.javadoc.skip` then `mvn test -DforkCount=1 -DreuseForks=false` | `src/test/resources/.properties` or env: `POSTMARK_API_TOKEN`, `POSTMARK_ACCOUNT_TOKEN` | **Code edit** `BaseTest.java:59-69` to `getApiClient(token, false, "localhost:PORT")`, or hosts file + TLS on 443 + `-Djavax.net.ssl.trustStore` | 9 files / 52 (2 live) | 15 files / 48 | all 48 + 2 | seeded domains/senders/servers/streams; exact `Test job accepted`, `removed` |
| cli | `npm install && npm run build && npm run test:integration` | `test/config/testing_keys.json` or env: `SERVER_TOKEN`, `ACCOUNT_TOKEN`, `FROM_ADDRESS`, `TO_ADDRESS` | CLI is https-only. Needs `POSTMARK_REQUEST_HOST` + TLS + `NODE_EXTRA_CA_CERTS`, or `HTTPS_PROXY` (INFERRED). Test helpers ignore the host. | 4 files / 20 | 6 files / 31 | ~all with TLS or proxy | helpers hardcode the default host; `TotalCount` must match |
| mcp | `npm install && cp smoke-test.example.mjs smoke-test.mjs && NODE_OPTIONS="--import /abs/fetch-shim.mjs" node smoke-test.mjs` | `.env`: `POSTMARK_SERVER_TOKEN`, `DEFAULT_SENDER_EMAIL`, `DEFAULT_MESSAGE_STREAM` | Host is hardcoded (`index.js:19`). Fetch shim; smoke child gets no env (INFERRED) — add `env` in the user-owned copy. | 34 + 13 + 7, no server | smoke 25 + ~27 checks | all | webhook create must not verify the URL |

Citations **SDK**:
- postmark.js: `sdk/postmark.js/package.json:45-46`, `sdk/postmark.js/.circleci/config.yml:43-50`, `sdk/postmark.js/.env.example:1-6`, `sdk/postmark.js/test/integration/MessageStreams.test.ts:17-18,62`
- python: `sdk/postmark-python/.github/workflows/tests.yml:40-47`, `sdk/postmark-python/example.env:1-6`, `sdk/postmark-python/tests/conftest.py:30-69`
- dotnet: `sdk/postmark-dotnet/.circleci/config.yml:14,23`, `sdk/postmark-dotnet/src/Postmark.Tests/ClientBaseFixture.cs:40-91`
- php: `sdk/postmark-php/.circleci/config.yml:44-50`, `sdk/postmark-php/tests/TestingKeys.php:26-47`, `sdk/postmark-php/tests/PostmarkClientBaseTest.php:18-19`, `sdk/postmark-php/tests/PostmarkClientEmailTest.php:260-263`, `sdk/postmark-php/tests/PostmarkClientBounceTest.php:55`
- gem: `sdk/postmark-gem/.circleci/config.yml:1-2,49,85`, `sdk/postmark-gem/lib/postmark/http_client.rb:62`
- rails: `sdk/postmark-rails/spec/integration/delivery_spec.rb:4-8`
- java: `sdk/postmark-java/.circleci/config.yml:118,121`, `sdk/postmark-java/src/test/java/base/BaseTest.java:22-69`
- cli: `sdk/postmark-cli/package.json:59-61`, `sdk/postmark-cli/test/integration/shared.ts:4-12,42-57`
- mcp: `sdk/postmark-mcp/package.json:49-51`, `sdk/postmark-mcp/README.md:93-101`, `sdk/postmark-mcp/.env.example:7-9`

### 5.2a Skips decided for W2

T8 owns the runner folders. W2 writes these skips into `conformance/<sdk>/skips/<test file>.json`.

| SDK | Test | Reason | Source |
| --- | --- | --- | --- |
| dotnet | `AdminClientSenderSignatureTests.AdminClient_ShouldProduceErrorStatusForInvalidSenderSignature` | It expects HTTP 422 for a new signature at `example.com`. The conformance sender domain is `example.com`, so postmock accepts it. Postmark's refusal of reserved domains is not captured. | `sdk/postmark-dotnet/src/Postmark.Tests/AdminClientSenderSignatureTests.cs:78-94` **SDK** |

### 5.3 Harness shape (INFERRED proposal)

- One `conformance/` folder holds the external shims only: `preload.js`, `mock_host.rb`, `fetch-shim.mjs`, and `testing_keys.json` files.
- A single script per SDK starts the mock with a named seed, sets the env, runs the suite, and saves the JUnit or TAP output.
- The seed has these parts:
  - account token and server token
  - 3 default streams (`outbound`, `inbound`, `broadcast`)
  - ≥51 outbound messages, with tag `test_tag`
  - ≥10 inbound messages
  - bounces, one inactive and one with a dump
  - opens and clicks
  - ≥1 domain and ≥1 confirmed sender
  - 4 stats periods whose counts decrease strictly
- Count-sensitive dotnet tests need a fresh mock per test class, or a serial xUnit run.
- Before trusting a green run, compare each suite's exact-string assertions with a capture.

---

## 6. Open questions

Question 1 (scope) is closed: the mock targets every official SDK. Ids 2–14 keep their numbers.

2. **readtimes, verifyCustomTracking, inbound dump, triggers/tags.** Six SDKs send `/stats/outbound/opens/readtimes`, but neither the spec nor the docs list it. What does real Postmark return for each of these?
3. **Batch error item shape.** Does real Postmark include `To`, `SubmittedAt` and `MessageID` on a failed batch item? python crashes without them, and dotnet crashes on `MessageID: null`. A capture decides this.
4. **Bulk response.** Is the POST `/email/bulk` key `ID` or `Id`? Is the terminal status `Cancelled` or `Failed`?
5. **Data-removal `Status`.** Is it a string or a number? The dotnet SDK breaks on the documented string.
6. **Route case and trailing slash.** Does real Postmark match paths without case and accept trailing slashes (e.g. `/deliveryStats/`, `/email/`)? `AGENTS.md` rule 5 forbids silent tolerance that Postmark lacks. Capture one camelCase and one trailing-slash call.
7. **Query key case.** Does real Postmark treat `fromDate` and `fromdate` as the same key? Does it accept `True`/`1` for booleans?
8. **Body `null` on GET.** Does real Postmark accept java's literal `null` body on GET, DELETE and bodyless PUT?
9. **HTTP status codes.** Does real Postmark ever send 201, 204 or 409? (400 and 404 are DOC, `refs/api_overview.md:66,118,162`.) Four SDKs treat anything other than 200 as an error.
10. **TLS.** cli and mcp need https. Does the mock ship a self-signed TLS listener, or do we require shims/proxies?
11. **java suite.** Is a one-line host edit in `BaseTest.java` acceptable in a local conformance copy, or must we use hosts-file + TLS?
12. **nodemailer HTTP transport.** Clone the third-party `nodemailer-postmark-transport` to profile it, or leave it out? nodemailer over SMTP is covered in `docs/07`.
13. **postmark-cli version.** Clone postmark.js 4.0.2 (axios) to profile the CLI accurately, or accept the rows inferred from 5.1.0?
14. **Spec as codegen source.** Should the mock generate types from a patched spec (sections 3.1–3.2), or hand-write types from the docs and use the spec only as a cross-check?
15. **Stream archive 1241.** Two live tests disagree. postmark.js archives a new Transactional stream on a new server and expects 422 / 1241 "Stream is unable to be archived at this time." (`sdk/postmark.js/test/integration/MessageStreams.test.ts:66-78` **SDK**). dotnet archives a new Transactional stream on a new server with success (`sdk/postmark-dotnet/src/Postmark.Tests/ClientMessageStreamTests.cs:114-127` **SDK**); java archives a Broadcasts stream with success (`sdk/postmark-java/src/test/java/integration/MessageStreamsTest.java:69-88` **SDK**). The condition for 1241 is unknown. postmock archives, and a test gets 1241 through `POST /control/faults`. The postmark.js test is in `conformance/postmark.js/skips/`. A capture decides the condition.
