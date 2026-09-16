# 02 — Transport, auth, errors

This page is the HTTP contract that every endpoint shares.
Endpoint bodies are in other pages.

Source versions:

| Source | Version |
| --- | --- |
| `sdk/postmark.js` | 5.1.0, commit `f955212` |
| `sdk/postmark-python` | 0.4.0, commit `620d659` |
| `sdk/postmark-dotnet` | commit `b4249c5` |
| `sdk/postmark-php` | commit `ad4b80e` |
| `sdk/postmark-gem` | 1.25.1, commit `a50ff39` |
| `sdk/postmark-java` | commit `c6c5eb6` |
| `sdk/postmark-mcp` | 2.1.1, commit `63ef055` |

Marks: **DOC**, **SDK**, **LIB**, **CAPTURED**, **INFERRED** (see `AGENTS.md` rule 6).
No captures exist yet. Section 9 lists what to capture.

---

## 1. Surface

This page covers every REST endpoint: server-token and account-token APIs.
The surface groups and the doc for each: `docs/01` "Surface tiers".
Client code that parses exact `Message` text: `docs/01` "Client code that parses exact server text".

---

## 2. Hosts, base URL, client transport

### 2.1 Host

| Fact | Value | Cite |
| --- | --- | --- |
| Base URL | `https://api.postmarkapp.com` | `refs/api_overview.md:8-10` DOC |
| TLS | "We enforce TLS encryption by issuing requests via HTTPS." | `refs/api_overview.md:6` DOC |
| Swagger host / basePath | `api.postmarkapp.com`, `/` (server and account APIs share one host) | `refs/openapi/server.yml:8-9`, `refs/openapi/account.yml:10-11` DOC |
| Swagger `produces` / `consumes` | `application/json` | `refs/openapi/server.yml:10-13`, `refs/openapi/account.yml:12-15` DOC |
| Plain `http://` | Not documented. Result (redirect, refusal, or served) is unknown. | INFERRED — capture Q1 |
| Path prefix / version segment | None. Paths start at `/` (`/email`, `/server`). | `refs/openapi/server.yml:893-895` DOC |

### 2.2 Base URL and override, per SDK

| SDK | Default base | Override | Env var | Cite |
| --- | --- | --- | --- | --- |
| postmark.js | `useHttps: true`, `requestHost: "api.postmarkapp.com"` → `https://api.postmarkapp.com` | Constructor option or `setClientOptions({ useHttps, requestHost, timeout, fetch })`. `requestHost` may carry a port (it is pasted into the URL). `HttpClient.DefaultOptions` is a public mutable static; clients built after a change use it. | none | `sdk/postmark.js/src/client/models/client/HttpClient.ts:9-13,18-26`; `models/client/ClientOptions.ts:12-25`; `BaseClient.ts:29-31` SDK |
| postmark.js URL build | `${scheme}://${requestHost}` + path (a leading `/` is added) + query | — | — | `sdk/postmark.js/src/client/HttpClient.ts:67-73` SDK |
| postmark-python | `https://api.postmarkapp.com` | `base_url=` constructor argument | `POSTMARK_SSL_VERIFY=false` disables TLS verify | `sdk/postmark-python/postmark/clients/server_client.py:41,48,73,89-90` SDK |
| postmark-dotnet | `https://api.postmarkapp.com` | `apiBaseUri` constructor argument; global `ClientFactory` swaps the HTTP client | none | `sdk/postmark-dotnet/src/Postmark/PostmarkClient.cs:36`; `PostmarkAdminClient.cs:23`; `PostmarkClientBase.cs:29,48-51,73` SDK |
| postmark-php | `https://api.postmarkapp.com` | Static `PostmarkClientBase::$BASE_URL`; `$VERIFY_SSL`; `setClient(Guzzle)` | none | `sdk/postmark-php/src/Postmark/PostmarkClientBase.php:28,44,74-77,145` SDK |
| postmark-gem | host `api.postmarkapp.com`, `secure: true`, port 443, `path_prefix: "/"` | `:host`, `:port`, `:secure`, `:path_prefix`, proxy options | none | `sdk/postmark-gem/lib/postmark/http_client.rb:15-22,57-72` SDK |
| postmark-java | `api.postmarkapp.com`, https | `getApiClient(token, secure, customApiUrl)`; `setSecureConnection(false)` → `http://` | none | `sdk/postmark-java/src/main/java/com/postmarkapp/postmark/Postmark.java:21,61-74`; `client/HttpClient.java:137-140` SDK |
| postmark-mcp | `https://api.postmarkapp.com` (const) | none | server token from env; `POSTMARK_SKIP_VERIFY` skips the startup `GET /server` check | `sdk/postmark-mcp/index.js:19,22,82,150` SDK |

### 2.3 Reaching the mock without a base-URL option

Routes (DNS + test CA, env proxy, preload) and their tradeoffs: `docs/01` "Routing an unmodified application to the mock".

### 2.4 Timeouts

| SDK | Default | Cite |
| --- | --- | --- |
| postmark.js | 180 s (`DefaultOptions.timeout`). `timeout: 0` falls back to 60 s. Unit is seconds. Uses `AbortSignal.timeout`. | `models/client/HttpClient.ts:12`; `HttpClient.ts:167-179` SDK |
| postmark-python | Server client 5 s; account client 30 s | `postmark/clients/server_client.py:47`; `account_client.py:42` SDK |
| postmark-dotnet | 60 s (`HttpClient.Timeout`) | `src/Postmark/SimpleHttpClient.cs:12` SDK |
| postmark-php | 60 s (Guzzle `timeout`) | `src/Postmark/PostmarkClientBase.php:50,89`; `PostmarkClient.php:57` SDK |
| postmark-gem | open 60 s, read 60 s | `lib/postmark/http_client.rb:20-21` SDK |
| postmark-java | connect 60 s, read 60 s | `client/HttpClient.java:23-32` SDK |
| postmark-mcp | 60 s | `index.js:20,90-95` SDK |

### 2.5 Request headers

| SDK | Auth header | `Accept` | `Content-Type` | `User-Agent` | Other | Cite |
| --- | --- | --- | --- | --- | --- | --- |
| postmark.js | `X-Postmark-Server-Token` or `X-Postmark-Account-Token`, value trimmed | `application/json` | `application/json` on every request, also GET and DELETE with no body | `Postmark.JS - 5.1.0` | none | `BaseClient.ts:23,109-116`; `models/client/ClientOptions.ts:37-40` SDK |
| postmark-python | same names | `application/json` | `application/json` (client default, every request) | `Python/<major>.<minor>.<micro>` | `X-Postmark-Client: postmark-python`, `X-Postmark-Client-Version`, per-request `X-Postmark-Correlation-Id: <uuid4>` | `postmark/clients/server_client.py:91-98,132` SDK |
| postmark-dotnet | same names | `application/json` | `application/json; charset=utf-8` only when a body exists | `Postmark.NET 2.x (<assembly-qualified name>)` | none | `src/Postmark/PostmarkClientBase.cs:38-39,77-85`; `Utility/JsonContent.cs:19-21` SDK |
| postmark-php | same names | `application/json` | `application/json` | `Postmark-PHP (PHP Version:<v>, OS:<os>)` | none | `src/Postmark/PostmarkClientBase.php:114-119` SDK |
| postmark-gem | same names | `application/json` | `Content-type: application/json` | `Postmark Ruby Gem v<VERSION>` | none | `lib/postmark.rb:28-32`; `lib/postmark/http_client.rb:82-84` SDK |
| postmark-java | same names | `application/json` | `application/json` | `Postmark Java Library: <version>` | none | `Postmark.java:37-43` SDK |
| postmark-mcp | server token only | `application/json` | `application/json` only with a body | Node default | `X-Postmark-Client: postmark-mcp`, `X-Postmark-Client-Version`, optional `X-Postmark-MCP-Client`, `X-Agent-Label` | `index.js:83-92` SDK |

Docs mark `Accept: application/json` as required on GET and POST.
Docs mark `Content-Type: application/json` as required on POST.

| Doc | Cite |
| --- | --- |
| `/email` headers: Content-Type required, Accept required | `refs/api_email-api.md:14-18` DOC |
| Suppressions dump headers: Accept required (no Content-Type) | `refs/api_suppressions-api.md:14-17` DOC |
| Suppressions delete headers: Accept and Content-Type required | `refs/api_suppressions-api.md:181-185` DOC |
| 415 means "missing the expected request headers" | `refs/api_overview.md:31` DOC |

Which missing header gives 415 is not documented. Capture Q5.

### 2.6 Request body and query encoding (postmark.js)

| Fact | Cite |
| --- | --- |
| Body is `JSON.stringify(body)`. `undefined` keys drop. `null` keys stay. | `sdk/postmark.js/src/client/HttpClient.ts:44` SDK |
| GET and DELETE send no body. | `HttpClient.ts:44`; `BaseClient.ts:52-55` SDK |
| Query uses `URLSearchParams`. `null` and `undefined` values drop. Arrays repeat the key. `Date` becomes ISO. | `HttpClient.ts:85-106` SDK |
| Query keys are the SDK property names as written (camelCase, e.g. `fromEmail`, `emailAddress`). | `models/messages/MessageFilteringParameters.ts:23-30`; `models/suppressions/SuppressionFilteringParameters.ts:20-24` SDK |
| List calls that use `setDefaultPaginationValues` send `count=100&offset=0` when the caller gives none. `getSuppressions` does not. | `BaseClient.ts:132-135`; `ServerClient.ts:415,442,779-782` SDK |

### 2.7 Compression

| Fact | Mark |
| --- | --- |
| No SDK sets `Accept-Encoding` or `Content-Encoding` in its own code. | SDK (grep of all `sdk/*` sources: no hits) |
| Node `fetch` (undici) and `httpx` add `Accept-Encoding` by default. | INFERRED |
| An uncompressed response is valid for every client. The mock sends no compression. | INFERRED |
| Whether Postmark compresses responses. | Unknown — capture Q14 |

---

## 3. Authentication

### 3.1 Tokens

| Header | Scope | Cite |
| --- | --- | --- |
| `X-Postmark-Server-Token` | Server-level endpoints | `refs/api_overview.md:16-17` DOC |
| `X-Postmark-Account-Token` | Account-level endpoints | `refs/api_overview.md:18-19` DOC |
| "The header name and value are case insensitive." | both | `refs/api_overview.md:21` DOC |
| Wrong or missing header → HTTP 401 | both | `refs/api_overview.md:21,28` DOC |
| Wrong token type for the endpoint → ErrorCode 10, HTTP 401 | both | `refs/api_overview.md:60` DOC |

Note: a case-insensitive token **value** is unusual. Capture Q3 confirms it.

### 3.2 Which endpoints need which token

| Token | Endpoint families | Cite |
| --- | --- | --- |
| Server | `/email*`, `/email/bulk*`, `/bounces*`, `/deliverystats`, `/templates*` (except push), `/server`, `/messages/*`, `/triggers/inboundrules*`, `/stats/*`, `/message-streams*` (incl. suppressions), `/webhooks*` | `refs/openapi/server.yml:896-2484` (every operation lists `X-Postmark-Server-Token`); `refs/api_suppressions-api.md:17,86`; `refs/api_message-streams-api.md`; `refs/api_webhooks-api.md`; `refs/api_bulk-email.md` DOC |
| Account | `/servers*`, `/senders*`, `/domains*`, `PUT /templates/push`, `/data-removals*` | `refs/openapi/account.yml:393-1003` (every operation lists `X-Postmark-Account-Token`); `refs/api_templates-api.md:367`; `refs/api_data-removals-api.md:19,83` DOC |

The mock serves both families. Each family accepts only its own token header (§3.4).

### 3.3 The `POSTMARK_API_TEST` token

| Fact | Cite | Mark |
| --- | --- | --- |
| Send `POSTMARK_API_TEST` as `X-Postmark-Server-Token`. The API validates data and does not deliver. | `refs/api_overview.md:23`; `refs/user-guide_send-email-with-api.md:87`; `refs/user-guide_send-email-with-api_send-a-single-email.md:81` | DOC |
| Only the server header is documented for it. | `refs/api_overview.md:23` | DOC |
| Valid `POST /email` returns `ErrorCode: 0`, `Message: "Test job accepted"`, a 36-char `MessageID`. | `sdk/postmark-java/src/test/java/integration/MessageTest.java:31-37` | SDK |
| Invalid send (no body, bad `To`) still returns 422 (`InvalidMessageError`). | `sdk/postmark-gem/spec/integration/api_client_messages_spec.rb:62-68` | SDK |
| Batch send works with it and returns per-message results. | `sdk/postmark-gem/spec/integration/api_client_messages_spec.rb:72-116` | SDK |
| postmark-mcp skips its startup `GET /server` check for this token without a warning. This hints that `GET /server` may not succeed with it. | `sdk/postmark-mcp/index.js:148-156` | SDK (hint only) |
| Behavior on read endpoints (`/messages/outbound/opens`, suppressions dump/delete) | — | Unknown — capture Q8 |
| Exact `SubmittedAt` and `MessageID` values (zero UUID or random) | — | Unknown — capture Q7 |

### 3.4 Missing or invalid token

| Case | HTTP | Body | Mark |
| --- | --- | --- | --- |
| Header missing | 401 | `{"ErrorCode": 10, "Message": <text>}` | Status and code DOC (`refs/api_overview.md:21,60`); message text unknown — capture Q2 |
| Token invalid | 401 | same shape | same |
| Wrong token type | 401 | same shape | same |
| Empty token in postmark.js | no HTTP call. Constructor throws `PostmarkError("A valid API token must be provided.")`. | — | `sdk/postmark.js/src/client/BaseClient.ts:22,123-127` SDK |

SDK tests only show `ErrorCode: 10` with an invented message.
`sdk/postmark-python/tests/test_server_client.py:132-150` SDK.
The mock must not invent the message. It uses the captured text.

---

## 4. Error envelope

### 4.1 Shape

```json
{ "ErrorCode": 403, "Message": "Invalid request field(s): 'From'." }
```

| Fact | Cite | Mark |
| --- | --- | --- |
| Body has numeric `ErrorCode` and string `Message`. | `refs/api_overview.md:32-36,43-50` | DOC |
| Swagger `StandardPostmarkResponse`: `ErrorCode` integer, `Message` string. | `refs/openapi/server.yml:239-245`; `refs/openapi/account.yml:18-24` | DOC |
| Response header `X-PM-ApiErrorCode: <code>` echoes the code. | `refs/api_overview.md:43`; `refs/api_webhooks-api.md:377-379` | DOC |
| Error `Content-Type: application/json`. | `refs/api_webhooks-api.md:378` | DOC (one example). Charset suffix unknown — capture Q4 |
| Some errors carry extra keys (webhook verify 1364 returns `Id`, `Url`, `Success`, `Results`). | `refs/api_webhooks-api.md:376-393` | DOC |
| ErrorCode 11 carries an `Errors` array. | `refs/api_overview.md:65` | DOC |
| ErrorCode 101 "includes an `Error ID`". Field name unknown. | `refs/api_overview.md:63` | DOC; shape capture-only |
| Batch sends return per-message `ErrorCode` inside HTTP 200. Success rows have `ErrorCode: 0`, `Message: "OK"`. | `refs/api_overview.md:64`; `refs/api_email-api.md:297-313` | DOC |
| Single send success also carries `ErrorCode: 0`, `Message: "OK"`. | `refs/api_email-api.md:117-127` | DOC |
| 406 **batch item** text (inside HTTP 200): `"You tried to send to a recipient that has been marked as inactive. Found inactive addresses: example@example.com. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression. "` (note trailing space) | `refs/api_email-api.md:301-313` | DOC |
| 406 **single-send** text (HTTP 422), mock default until captured: `"You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: a@example.com, b@example.com. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression."` | `sdk/postmark.js/test/unit/ErrorHandler.test.ts:113-116`; `sdk/postmark-gem/spec/unit/postmark/error_spec.rb:254-257` (fixtures, not captures) | SDK |

postmark.js parses `.recipients` from the 406 message with these regexes:
`/Found inactive addresses: (.+?)\.? Inactive/` and `/these inactive addresses: (.+?)\.?$/`.
It splits on `,` and trims. `sdk/postmark.js/src/client/errors/Errors.ts:98-127` SDK.
postmark-gem and postmark-python parse the same sentence with stricter rules (gem splits on `", "` only).
The mock must keep the `Found inactive addresses: a, b. Inactive` sentence exactly. Per-SDK regexes: `docs/01` "ErrorCode 406: inactive recipients".

### 4.2 HTTP status codes

| Status | Meaning | Body | Cite |
| --- | --- | --- | --- |
| 200 | Success. Every documented success uses 200, also POST create. | resource JSON | `refs/api_overview.md:27` DOC |
| 400 | Only ErrorCode 1002 (`bounceID` required) | envelope | `refs/api_overview.md:118` DOC |
| 401 | Missing or incorrect token | envelope, ErrorCode 10 | `refs/api_overview.md:28,60` DOC |
| 404 | Entity does not exist | Envelope for ErrorCode 12 and 501. Body for an unknown route is unknown. | `refs/api_overview.md:29,66,162` DOC; capture Q9 |
| 413 | Payload too large: 10 MB (`/email`), 50 MB (batch) | Unknown (may come from a proxy) | `refs/api_overview.md:30`; `refs/support_article_1056-what-are-the-attachment-and-email-size-limits.md:7-8` DOC; capture Q10 |
| 415 | Missing expected request headers | Unknown | `refs/api_overview.md:31` DOC; capture Q5 |
| 422 | Malformed JSON or invalid fields | envelope | `refs/api_overview.md:32-36` DOC |
| 429 | Rate limit exceeded | Undocumented | `refs/api_overview.md:37` DOC |
| 500 | Internal error | envelope (ErrorCode 101, 501, 709) | `refs/api_overview.md:38,63,162,182` DOC |
| 503 | Planned outage | "associated JSON body", ErrorCode 100 | `refs/api_overview.md:39,62` DOC |

Doc disagreement: the Swagger files list only 422 and 500 responses per operation.
They omit 401, 404, 413, 415, 429, and 503.
`refs/openapi/server.yml:885-891`; `refs/openapi/account.yml:382-388` DOC.
The overview page wins (newer and more complete).

Only 200 counts as success in PHP, Ruby, Java, and .NET (section 5.2).
A 201 or 204 from the mock breaks those SDKs. postmark.js accepts any 2xx.

### 4.3 Non-JSON error bodies

| Fact | Mark |
| --- | --- |
| No doc shows an HTML or plain-text error. | DOC (absence) |
| A load balancer or WAF can send HTML for 413, 502, 503, 504. | INFERRED — capture Q10 |
| SDK reactions to a non-JSON body are in section 5. | SDK |

### 4.4 Error code table

Some codes appear in more than one family (614, 1226).
Some codes use more than one status (501, 1406, 1408).

| Code | HTTP | Meaning | Cite |
| --- | --- | --- | --- |
| **Authentication** | | | |
| 10 | 401 | Request does not contain a valid Server or Account token, or the wrong token type was used for the endpoint. | `refs/api_overview.md:60` DOC |
| **Global** | | | |
| 100 | 503 | The Postmark API is offline for maintenance. | `refs/api_overview.md:62` DOC |
| 101 | 500 | You encountered an error that shouldn't have occurred. The response includes an `Error ID` for support. | `refs/api_overview.md:63` DOC |
| **Sending  — batch sends return per-message codes inside an HTTP 200 response** | | | |
| 11 | 422 | Multiple errors occurred. Inspect the `Errors` property for more information. | `refs/api_overview.md:65` DOC |
| 12 | 404 | Bulk send not found. | `refs/api_overview.md:66` DOC |
| 13 | 422 | Invalid pagination key. | `refs/api_overview.md:67` DOC |
| 14 | 422 | This endpoint requires approval to access. Contact support to use the Bulk API. | `refs/api_overview.md:68` DOC |
| 300 | 422 | Send validation. Covers many messages — zero recipients, invalid address, missing `TextBody`/`HtmlBody`, and recipient, metadata, attachment, or header limits. | `refs/api_overview.md:69` DOC |
| 402 | 422 | Invalid JSON. | `refs/api_overview.md:70` DOC |
| 403 | 422 | Invalid request field(s). | `refs/api_overview.md:71` DOC |
| 406 | 422 | Inactive recipient. | `refs/api_overview.md:72` DOC |
| 410 | 422 | You may only send up to 500 messages in a single batched request. | `refs/api_overview.md:73` DOC |
| 411 | 422 | Attachment file type not allowed. | `refs/api_overview.md:74` DOC |
| 412 | 422 | While your account is pending approval, all recipient addresses must share the same domain as the From address. | `refs/api_overview.md:75` DOC |
| 413 | 422 | This account is not approved to send email. | `refs/api_overview.md:76` DOC |
| 422 | 422 | Invalid Server or Account. | `refs/api_overview.md:77` DOC |
| 1235 | 422 | The stream provided does not exist on this server. | `refs/api_overview.md:78` DOC |
| 1236 | 422 | Sending is not supported for this stream type. | `refs/api_overview.md:79` DOC |
| 1480 | 422 | You are not authorized to send emails from your current IP address: 'IP Address'. | `refs/api_overview.md:80` DOC |
| **Templates** | | | |
| 601 | 422 | The source or destination server was not found (template push). | `refs/api_overview.md:82` DOC |
| 1100 | 422 | Template list paging, or an invalid `TemplateType` or `editorType` query parameter. | `refs/api_overview.md:83` DOC |
| 1101 | 422 | The request specifies neither `TemplateId` nor `TemplateAlias`, or the referenced template, alias, or layout was not found. | `refs/api_overview.md:84` DOC |
| 1105 | 422 | A server's active-template limit would be exceeded by this request. | `refs/api_overview.md:85` DOC |
| 1109 | 422 | No template data received. | `refs/api_overview.md:86` DOC |
| 1120 | 422 | A required field is missing — `Name`, one of `TextBody`/`HtmlBody`, `Subject`, or `TemplateModel`. | `refs/api_overview.md:87` DOC |
| 1121 | 422 | A field is too long — `Name`, `Alias`, `HtmlBody`, `TextBody`, `Subject`, or `TemplateModel`. | `refs/api_overview.md:88` DOC |
| 1122 | 422 | Invalid `TemplateType`, alias empty/invalid/in-use, unparseable body, or a reserved top-level `TemplateModel` key. | `refs/api_overview.md:89` DOC |
| 1123 | 422 | Template/send mutual-exclusion rules (layout vs. subject/body, templated vs. non-templated). | `refs/api_overview.md:90` DOC |
| 1124 | 422 | No templates with aliases found to push, or the per-request push limit was exceeded. | `refs/api_overview.md:91` DOC |
| 1125 | 422 | The template types don't match on the source and destination servers. | `refs/api_overview.md:92` DOC |
| 1130 | 422 | The layout template cannot be deleted because dependent templates use it. | `refs/api_overview.md:93` DOC |
| 1131 | 422 | Layout content-placeholder rules were not met. | `refs/api_overview.md:94` DOC |
| **Servers** | | | |
| 600 | 422 | Server-list paging — `offset`/`count` required or integer; up to 500 servers per call. | `refs/api_overview.md:96` DOC |
| 602 | 422 | The specified inbound domain is already registered or in use on another server. | `refs/api_overview.md:97` DOC |
| 603 | 422 | This server name already exists. | `refs/api_overview.md:98` DOC |
| 604 | 422 | You do not have permission to delete servers using the API. | `refs/api_overview.md:99` DOC |
| 605 | 422 | Unable to remove this server. Please contact support. | `refs/api_overview.md:100` DOC |
| 606 | 422 | A supplied hook URL (Inbound, Bounce, Open, Delivery, or Click) is not valid. | `refs/api_overview.md:101` DOC |
| 607 | 422 | Invalid server color. | `refs/api_overview.md:102` DOC |
| 608 | 422 | Server name is invalid or missing, or an inbound domain containing postmarkapp.com was used. | `refs/api_overview.md:103` DOC |
| 609 | 422 | No server data received. | `refs/api_overview.md:104` DOC |
| 610 | 422 | We could not find an MX record pointing to the expected domain. | `refs/api_overview.md:105` DOC |
| 611 | 422 | InboundSpamThreshold value is invalid. Use a number between 0 and 30. | `refs/api_overview.md:106` DOC |
| 612 | 422 | The supplied `TrackLinks` option is not valid. | `refs/api_overview.md:107` DOC |
| 613 | 422 | The supplied `DeliveryType` option is not valid. | `refs/api_overview.md:108` DOC |
| 614 | 422 | Entitlement limit reached (inbound, stats, users, servers, streams, or domains). | `refs/api_overview.md:109` DOC |
| 615 | 422 | Action is not supported. | `refs/api_overview.md:110` DOC |
| **Message activity, messages & bounces** | | | |
| 700 | 422 | Paging/parameter validation for messages, opens, clicks, and activity. | `refs/api_overview.md:112` DOC |
| 701 | 422 | This message was not found, or cannot be bypassed or retried. | `refs/api_overview.md:113` DOC |
| 702 | 422 | Could not bypass this blocked message. Please contact support. | `refs/api_overview.md:114` DOC |
| 703 | 422 | Could not retry this failed message. Please contact support. | `refs/api_overview.md:115` DOC |
| 1000 | 422 | Bounces query validation (non-negative, up to 500, count+offset, illegal bounce type). | `refs/api_overview.md:116` DOC |
| 1001 | 422 | The bounce was not found, or its dump is no longer available. | `refs/api_overview.md:117` DOC |
| 1002 | 400 | A `bounceID` parameter is required. | `refs/api_overview.md:118` DOC |
| 1003 | 422 | Due to the type of bounce, this address cannot be reactivated. | `refs/api_overview.md:119` DOC |
| **Inbound rules / triggers** | | | |
| 800 | 422 | You may only request up to 500 triggers per call, plus parameter validation. | `refs/api_overview.md:121` DOC |
| 809 | 422 | No trigger data received. | `refs/api_overview.md:122` DOC |
| 810 | 422 | This inbound rule already exists. | `refs/api_overview.md:123` DOC |
| 811 | 422 | Unable to remove this inbound rule. Please contact support. | `refs/api_overview.md:124` DOC |
| 812 | 422 | This inbound rule was not found. | `refs/api_overview.md:125` DOC |
| **Message Streams** | | | |
| 1220 | 422 | You do not have permission to use the message streams API. | `refs/api_overview.md:127` DOC |
| 1221 | 422 | The `MessageStreamType` associated with this request was invalid. | `refs/api_overview.md:128` DOC |
| 1222 | 422 | A valid `ID` must be provided. | `refs/api_overview.md:129` DOC |
| 1223 | 422 | A valid `Name` must be provided. | `refs/api_overview.md:130` DOC |
| 1224 | 422 | The `Name` is too long. | `refs/api_overview.md:131` DOC |
| 1225 | 422 | You have reached the maximum number of message streams for this server. | `refs/api_overview.md:132` DOC |
| 1226 | 422 | The message stream for the provided `ID` was not found. | `refs/api_overview.md:133` DOC |
| 1227 | 422 | The `ID` must be a non-empty string starting with a letter, up to 30 characters. | `refs/api_overview.md:134` DOC |
| 1228 | 422 | A server can only have one inbound stream. | `refs/api_overview.md:135` DOC |
| 1229 | 422 | You cannot archive the default transactional and inbound streams. | `refs/api_overview.md:136` DOC |
| 1230 | 422 | The `ID` provided already exists for this server. | `refs/api_overview.md:137` DOC |
| 1231 | 422 | The `Description` is too long. | `refs/api_overview.md:138` DOC |
| 1232 | 422 | You cannot unarchive this message stream anymore. | `refs/api_overview.md:139` DOC |
| 1233 | 422 | The `ID` must not start with the `pm-` prefix. | `refs/api_overview.md:140` DOC |
| 1234 | 422 | The `Description` must not contain HTML tags. | `refs/api_overview.md:141` DOC |
| 1237 | 422 | The `ID` is reserved. | `refs/api_overview.md:142` DOC |
| 1238 | 422 | You do not have permission to use Custom Unsubscribe Handling for this stream. | `refs/api_overview.md:143` DOC |
| 1239 | 422 | The `UnsubscribeHandlingType` provided is not supported for this stream type. | `refs/api_overview.md:144` DOC |
| 1240 | 422 | The `UnsubscribeHandlingType` associated with this request is invalid. | `refs/api_overview.md:145` DOC |
| 1241 | 422 | Stream is unable to be archived at this time. | `refs/api_overview.md:146` DOC |
| **Suppressions** | | | |
| 1400 | 422 | Parameter `count` should be an integer within the allowed range. | `refs/api_overview.md:148` DOC |
| 1401 | 422 | Parameter `count` is required but was left out. | `refs/api_overview.md:149` DOC |
| 1402 | 422 | Parameter `offset` should be an integer greater than or equal to zero. | `refs/api_overview.md:150` DOC |
| 1403 | 422 | Parameter `offset` is required but was left out. | `refs/api_overview.md:151` DOC |
| 1404 | 422 | Parameter `SuppressionReason` is invalid. | `refs/api_overview.md:152` DOC |
| 1405 | 422 | Parameter `Origin` is invalid. | `refs/api_overview.md:153` DOC |
| 1406 | 200 body | You do not have the required authority to change this suppression (per-item result). | `refs/api_overview.md:154` DOC |
| 1407 | 422 | Something went wrong when processing the request. | `refs/api_overview.md:155` DOC |
| 1408 | 422 / 200 body | An invalid email address was provided. | `refs/api_overview.md:156` DOC |
| 1409 | 422 | A proper request body must be provided. | `refs/api_overview.md:157` DOC |
| 1410 | 422 | You cannot provide more than the maximum number of suppressions for this request. | `refs/api_overview.md:158` DOC |
| 1411 | 422 | Parameter `emailAddress` is required but was left out. | `refs/api_overview.md:159` DOC |
| **Sender Signatures & Domains** | | | |
| 500 | 422 | Signature/domain list paging (`count`/`offset` required or integer, up to 500). | `refs/api_overview.md:161` DOC |
| 501 | 422 / 404 / 500 | Signature not found (422/404), or the signature has no DKIM info (500). | `refs/api_overview.md:162` DOC |
| 502 | 422 | No update data or signature data received. | `refs/api_overview.md:163` DOC |
| 503 | 422 | You can't use public domain emails or public domains. | `refs/api_overview.md:164` DOC |
| 504 | 422 | This signature already exists, or a similar signature already exists. | `refs/api_overview.md:165` DOC |
| 505 | 422 | This DKIM is already being renewed. | `refs/api_overview.md:166` DOC |
| 506 | 422 | This Sender Signature has already been confirmed. | `refs/api_overview.md:167` DOC |
| 507 | 422 | You do not own this Sender Signature. | `refs/api_overview.md:168` DOC |
| 508 | 422 | This DKIM is not being renewed, or a key in a failed state cannot be rotated. | `refs/api_overview.md:169` DOC |
| 510 | 422 | This domain was not found. | `refs/api_overview.md:170` DOC |
| 511 | 422 | Invalid fields supplied. | `refs/api_overview.md:171` DOC |
| 512 | 422 | Domain already exists. | `refs/api_overview.md:172` DOC |
| 513 | 422 | You do not own this Domain. | `refs/api_overview.md:173` DOC |
| 514 | 422 | Name is a required field to create a Domain. | `refs/api_overview.md:174` DOC |
| 515 | 422 | Name field must be ≤ 255 characters. | `refs/api_overview.md:175` DOC |
| 516 | 422 | Name format is invalid. | `refs/api_overview.md:176` DOC |
| 520 | 422 | FromEmail is a required field to create a Sender Signature. | `refs/api_overview.md:177` DOC |
| 521 | 422 | A field is too long (confirmation note, Name, FromEmail, ReplyToEmail, ReturnPathDomain, or CustomTrackingDomain). | `refs/api_overview.md:178` DOC |
| 522 | 422 | A value is not a valid email address, domain, or subdomain. | `refs/api_overview.md:179` DOC |
| 523 | 422 | You need to add a CNAME record that points to the expected value. | `refs/api_overview.md:180` DOC |
| 614 | 422 | Signature/domain entitlement limit reached. | `refs/api_overview.md:181` DOC |
| 709 | 500 | DKIM verification failed due to invalid configuration. Please contact support. | `refs/api_overview.md:182` DOC |
| **SMTP Tokens  — new** | | | |
| 1450 | 422 | Parameter `serverId` is required but was left out. | `refs/api_overview.md:184` DOC |
| 1451 | 422 | This token could not be found. | `refs/api_overview.md:185` DOC |
| 1452 | 422 | A request body must be provided. | `refs/api_overview.md:186` DOC |
| 1453 | 422 | This server was not found. | `refs/api_overview.md:187` DOC |
| 1454 | 422 | A valid `MessageStream` is required, or the specified stream does not exist. | `refs/api_overview.md:188` DOC |
| 1455 | 422 | The request must contain a valid and existing `ServerID`. | `refs/api_overview.md:189` DOC |
| 1456 | 422 | Token length must be within the allowed range. | `refs/api_overview.md:190` DOC |
| 1457 | 422 | Tokens cannot be used with inbound streams. | `refs/api_overview.md:191` DOC |
| 1458 | 422 | A message stream's token limit would be exceeded by this request. | `refs/api_overview.md:192` DOC |
| 1459 | 422 | A token cannot be issued for an archived stream scheduled for deletion. | `refs/api_overview.md:193` DOC |
| 1460 | 422 | SMTP is currently disabled for the specified server. | `refs/api_overview.md:194` DOC |
| **Statistics API** | | | |
| 614 | 422 | You are not entitled to use the stats API. Upgrade to the next tier to add it. | `refs/api_overview.md:196` DOC |
| 900 | 422 | A parameter should be a date/time value. | `refs/api_overview.md:197` DOC |
| 1226 | 422 | The message stream for the provided `ID` was not found. | `refs/api_overview.md:198` DOC |
| 1500 | 422 | The `FromDate` field cannot be older than one year ago. | `refs/api_overview.md:199` DOC |
| 1501 | 422 | Parameter `count` should be an integer within the allowed range. | `refs/api_overview.md:200` DOC |
| 1502 | 422 | Parameter `FromDate` must be older than `ToDate`. | `refs/api_overview.md:201` DOC |
| **GDPR API** | | | |
| 1300 | 422 | Empty request, or an invalid offset or count. | `refs/api_overview.md:203` DOC |
| 1301 | 422 | Missing or incorrect data removal request ID. | `refs/api_overview.md:204` DOC |
| 1302 | 422 | You don't have permission to process or review data removal requests through the API. | `refs/api_overview.md:205` DOC |
| **Webhooks API  — new** | | | |
| 1350 | 422 | You cannot create a webhook using an archived `MessageStream`. | `refs/api_overview.md:207` DOC |
| 1351 | 422 | You cannot create a webhook using an inbound stream. | `refs/api_overview.md:208` DOC |
| 1352 | 422 | The webhook for the provided `ID` was not found. | `refs/api_overview.md:209` DOC |
| 1353 | 422 | The webhook trigger is not supported on this message stream. | `refs/api_overview.md:210` DOC |
| 1354 | 422 | The request must contain a valid `Url` field. | `refs/api_overview.md:211` DOC |
| 1355 | 422 | A request body must be provided. | `refs/api_overview.md:212` DOC |
| 1356 | 422 | A request `ID` must not be provided when creating a webhook. | `refs/api_overview.md:213` DOC |
| 1357 | 422 | You cannot update the `ID` or `MessageStream` fields of a webhook. | `refs/api_overview.md:214` DOC |
| 1358 | 422 | You must provide a valid `HttpHeader` `Name`. | `refs/api_overview.md:215` DOC |
| 1359 | 422 | You have reached the maximum number of webhooks for this stream. | `refs/api_overview.md:216` DOC |
| 1360 | 422 | You cannot update the integration. | `refs/api_overview.md:217` DOC |
| 1361 | 422 | Invalid value provided for a field. | `refs/api_overview.md:218` DOC |
| 1362 | 422 | Invalid value provided for `status`. Must be one of: verified, unverified. | `refs/api_overview.md:219` DOC |
| 1363 | 422 | The `Status` field cannot be provided when creating or updating a webhook. | `refs/api_overview.md:220` DOC |
| 1364 | 422 | Webhook verification failed; nothing was saved. Fix the endpoint and retry, or send `?verify=false` to save it unverified. | `refs/api_overview.md:221` DOC |

---

## 5. SDK error mapping

### 5.1 postmark.js

Flow for a response:

| Step | Behavior | Cite |
| --- | --- | --- |
| 1 | `fetch` rejects (DNS, refused, reset, TLS, abort, timeout) → `PostmarkError(err.message)`, `code = 0`, `statusCode = 0`. If the thrown value has no `message`, the message is `JSON.stringify` of the error. | `sdk/postmark.js/src/client/HttpClient.ts:40-50,150-156`; `test/unit/FetchHttpClient.test.ts:111-137` SDK |
| 2 | Body read as text. Empty → `{}`. Valid JSON → parsed. Else → the raw string. | `HttpClient.ts:113-123` SDK |
| 3 | Status 200–299 → resolve with the parsed body. A non-JSON 2xx body resolves as a string. | `HttpClient.ts:55-57` SDK |
| 4 | Else `code = data.ErrorCode ?? 0` (only `undefined` defaults). `message = data.Message ?? "Request returned status code <status>"`. A string body gives `code 0` and the default message. | `HttpClient.ts:134-140`; `test/unit/FetchHttpClient.test.ts:162` SDK |
| 5 | `ErrorHandler.buildError(message, code, status)`. Status is never 0 here, so the status switch runs. | `errors/ErrorHandler.ts:16-23` SDK |

Status → class:

| HTTP status | Class | Parent | Cite |
| --- | --- | --- | --- |
| 401 | `InvalidAPIKeyError` | `HttpError` | `errors/ErrorHandler.ts:34-35`; `errors/Errors.ts:33-39` SDK |
| 404 | `PostmarkError` (base class, not `HttpError`) | `Error` | `errors/ErrorHandler.ts:37-38` SDK |
| 422, `ErrorCode` 406 | `InactiveRecipientsError` (+ `recipients: string[]`) | `ApiInputError` | `errors/ErrorHandler.ts:40-41`; `errors/Errors.ts:74-94,97-110` SDK |
| 422, `ErrorCode` 300 | `InvalidEmailRequestError` | `ApiInputError` | `errors/Errors.ts:89-90,130-135` SDK |
| 422, other code | `ApiInputError` | `HttpError` | `errors/Errors.ts:91-92` SDK |
| 429 | `RateLimitExceededError` | `HttpError` | `errors/ErrorHandler.ts:43-44` SDK |
| 500 | `InternalServerError` | `HttpError` | `errors/ErrorHandler.ts:46-47` SDK |
| 503 | `ServiceUnavailablerError` (sic) | `HttpError` | `errors/ErrorHandler.ts:49-50` SDK |
| any other (400, 413, 415, 502, 504) | `UnknownError` | `HttpError` | `errors/ErrorHandler.ts:52-53` SDK |
| none (transport) | `PostmarkError` | `Error` | `errors/ErrorHandler.ts:17-18` SDK |

Error fields:

| Field | Source | Cite |
| --- | --- | --- |
| `message` | `Message` or default text | `HttpClient.ts:136-137` SDK |
| `code` | `ErrorCode` or 0 | `errors/Errors.ts:5,11` SDK |
| `statusCode` | HTTP status, or 0 for transport | `errors/Errors.ts:6,10` SDK |
| `name` | Class name (`this.constructor.name`) | `errors/Errors.ts:19-22` SDK |

Class choice for 422 uses `ErrorCode` only. Class choice for others uses status only.
A 406 code under a status other than 422 gives no `InactiveRecipientsError`.

Timeout: `AbortSignal.timeout` rejects `fetch`. The result is step 1: `statusCode 0`.
A caller cannot tell a timeout from a DNS failure, a refused connection or a reset: all give `statusCode 0`.
`HttpClient.ts:45,150-156,167-170` SDK.
Rule for the mock: send a real HTTP status for a rejection. Never drop the connection to mean "rejected".

### 5.2 Other SDKs

| SDK | Success test | 401 | 422 | 429 | 500 / 503 | Other status | Non-JSON error body | Network / timeout | Cite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | `raise_for_status` (any 2xx) | `InvalidAPIKeyException` | `ValidationException`; code 406 → `InactiveRecipientException(.inactive_recipients)` | `RateLimitException` | `ServerException` | `PostmarkAPIException`. Code map wins over status: 10, 300, 405, 406, 701. | `message = response.text` or `"HTTP <n> error"`, `error_code 0` | `TimeoutException`; other `httpx.RequestError` → `PostmarkException("Request failed: …")` | `postmark/exceptions.py:64-145`; `postmark/utils/server_utils.py:28-37`; `postmark/clients/server_client.py:150-201` SDK |
| dotnet | Status 200 **and** body parses as the response type | `PostmarkValidationException` (`Response.Status = Unknown`) | `PostmarkValidationException` (`Status = UserError`) | same, `Unknown` | 500 → `ServerError`; 503 → `Unknown` | `PostmarkValidationException`, `Unknown` | `PostmarkResponseException("The response from the API could not be parsed.", body)` | .NET `HttpRequestException` / `TaskCanceledException` pass through | `src/Postmark/PostmarkClientBase.cs:87-115` SDK |
| php | Status 200 only | `PostmarkException`, fixed message, `HttpStatusCode 401`, no API code | `PostmarkException`, `PostmarkApiErrorCode = ErrorCode ?? 422`, `message = Message ?? "There was an unknown error."` | same as 422 path | fixed messages, `HttpStatusCode` 500 / 503, no API code | same as 422 path | code 422, "There was an unknown error." | Guzzle exception passes through | `src/Postmark/PostmarkClientBase.php:145-185` SDK |
| ruby | Status 200 only | `InvalidApiKeyError` | `ApiInputError` (`status_code` forced to 422); code 406 → `InactiveRecipientError(.recipients)`; 300 → `InvalidEmailRequestError` | `UnexpectedHttpResponseError` | 500 → `InternalServerError`; 503 → `UnexpectedHttpResponseError` | `UnexpectedHttpResponseError` | `parsed_body = {}`; message `"The Postmark API responded with HTTP status <n>."` | `TimeoutError`; `HttpClientError` for bad response lines | `lib/postmark/error.rb:17-107`; `lib/postmark/http_client.rb:74-98` SDK |
| java | Status 200 only | `InvalidAPIKeyException(PostmarkError)` | `InvalidMessageException(PostmarkError)` | `UnknownException(body)` | 500 → `InternalServerException(body)`; 503 → `UnknownException` | 408 → `TimeoutException`; else `UnknownException` | 401 / 422: Jackson throws `IOException`. Others keep the raw body. | Apache HttpClient `IOException` passes through | `client/HttpClientHandler.java:60-69`; `client/HttpClientErrorHandler.java:28-58` SDK |
| mcp | `res.ok` (any 2xx) | `Error("Postmark API 401 (ErrorCode 10): <Message>")` | same format | same format | same format | same format | `message = res.statusText`, no code | `Error("Postmark request timed out after 60s: <path>")`; other errors pass through | `index.js:96-111` SDK |

Common ground across SDKs:

| Rule | Mark |
| --- | --- |
| Status 200 for every success. | SDK (php, ruby, java, dotnet demand it) |
| JSON envelope with both keys on every 401 and 422. Java throws on a non-JSON 401/422 body. | SDK |
| `ErrorCode` is a JSON number. Python also coerces a numeric string. | `sdk/postmark-python/postmark/utils/server_utils.py:7-25` SDK |

---

## 6. Retries and rate limits

| Topic | Fact | Cite | Mark |
| --- | --- | --- | --- |
| Documented rate limit | No number is documented. 429 means "exceeds acceptable use". | `refs/api_overview.md:37` | DOC |
| 429 body | Not documented. | — | Unknown — capture Q11 |
| `Retry-After` | Not documented. No SDK reads it. | grep of `sdk/*` sources: no hits | DOC (absence), SDK |
| postmark.js | No retry. One `fetch` per call. | `sdk/postmark.js/src/client/HttpClient.ts:36-60` | SDK |
| postmark-python | Retries `RateLimitException`, `ServerException` (500, 503), `TimeoutException`. Default 3 retries (4 attempts). Exponential jitter, initial 1 s, max 60 s. Ignores `Retry-After`. | `postmark/clients/server_client.py:46,118-124` | SDK |
| postmark-gem | Opt-in `max_retries` (default 0). Retries 5xx, timeouts, socket errors. No retry on 401, 422, 429. | `lib/postmark/client.rb:9,38-51`; `lib/postmark/error.rb:41-43,70-72,118-121` | SDK |
| dotnet, php, java, mcp | No retry. | `PostmarkClientBase.cs:67-116`; `PostmarkClientBase.php:108-186`; `HttpClientHandler.java:60-69`; `index.js:75-112` | SDK |

Mock rule: the mock has no rate limit. It returns 429 only when a test asks for it.

---

## 7. JSON conventions

| Topic | Fact | Cite | Mark |
| --- | --- | --- | --- |
| Key case (responses) | PascalCase (`MessageID`, `TotalCount`, `ErrorCode`). ID suffixes are all caps (`MessageID`, `ServerID`) but some are `Id` (bulk `Id`, webhook `Id`). | `refs/api_email-api.md:121-127`; `refs/api_bulk-email.md:238`; `refs/api_message-streams-api.md:392-393`; `refs/api_webhooks-api.md:382` | DOC |
| Key case (request bodies) | All SDKs send PascalCase. Java serializes with `UpperCamelCaseStrategy`. | `sdk/postmark-java/.../data/parser/DataHandler.java:21` | SDK |
| Lowercase body keys accepted? | Not documented. | — | Unknown — capture Q12 |
| Enum values | Strings (`"HardBounce"`, `"Accepted"`). | `refs/api_bulk-email.md:238`; `refs/api_suppressions-api.md:32-33` | DOC |
| Unknown body fields | Not documented. ErrorCode 403 "Invalid request field(s)" exists. It may cover unknown or ill-typed fields. | `refs/api_overview.md:71` | DOC; behavior capture Q13 |
| Malformed JSON | 422, ErrorCode 402 | `refs/api_overview.md:32,70` | DOC |
| `null` in responses | Per surface. Message Streams show nullable fields as `null` (`ArchivedAt`, `UpdatedAt`). | `refs/api_message-streams-api.md:82-83,95` | DOC |
| Absent values omitted | The Bulk API omits properties with no value instead of `null`. | `refs/api_bulk-email.md:240` | DOC |
| `null` in request examples | Bulk request example sends `"TemplateId": null`. This shows what Postmark accepts, not what it emits. | `refs/api_bulk-email.md:104-105` | DOC |
| `null` in requests | postmark.js keeps caller `null`, drops `undefined`. Java and PHP drop nulls. | `sdk/postmark.js/src/client/HttpClient.ts:44`; `DataHandler.java:19`; `PostmarkClientBase.php:123-125` | SDK |
| SDK tolerance of unknown response keys | Java uses a liberal mapper (ignores unknown). postmark.js and python pass JSON through. | `DataHandler.java:22,78-84`; `HttpClient.ts:119` | SDK |

### 7.1 Date formats in responses

Docs show several shapes. The mock needs one shape per field, taken from a capture.

| Shape | Example | Cite | Mark |
| --- | --- | --- | --- |
| 7 fractional digits, offset | `2014-02-17T07:25:01.4178645-05:00` (send `SubmittedAt`) | `refs/api_email-api.md:123`; `refs/api_bounce-api.md:264` | DOC |
| No fraction, offset | `2020-07-01T00:00:00-04:00` (stream `CreatedAt`) | `refs/api_message-streams-api.md:66` | DOC |
| 2 fractional digits, offset | `2020-08-30T12:30:00.00-04:00` | `refs/api_message-streams-api.md:394` | DOC |
| No fraction, `Z` | `2014-01-15T16:09:19Z` (bounce list `BouncedAt`) | `refs/api_bounce-api.md:170` | DOC |
| 7 fractional digits, `Z` | `2026-03-17T07:25:01.4178645Z` (bulk) | `refs/api_bulk-email.md:204` | DOC |
| Date only | `2014-01-01` (stats `Date`) | `refs/api_stats-api.md:137` | DOC |
| .NET client tolerates a ` (GMT)` suffix | — | `sdk/postmark-dotnet/src/Postmark/Converters/DateTimeConverter.cs:16-21` | SDK |
| Offset `-05:00` / `-04:00` = US Eastern. Query dates are read as Eastern time. | "Our API uses Eastern Time Zone." | `refs/api_messages-api.md:40-41` | DOC |

### 7.2 Pagination

| Fact | Cite | Mark |
| --- | --- | --- |
| Query params `count` and `offset`, both required on list endpoints. | `refs/api_messages-api.md:34-35,630-631,839-840`; `refs/api_bounce-api.md:110-111` | DOC |
| `count` max 500. | same; `refs/openapi/server.yml:983,1485-1486`; `refs/openapi/account.yml:547-548` | DOC |
| `count` minimum 1, `offset` minimum 0. | `refs/openapi/server.yml:1485,1492`; `refs/openapi/account.yml:548,554` | DOC |
| `count + offset` must not exceed 10,000 (messages, opens search, bounces). The clicks search page does not state it; the cap there is INFERRED. | `refs/api_messages-api.md:34-35,630-631`; `refs/api_bounce-api.md:110-111`; clicks `refs/api_messages-api.md:839-840` | DOC |
| Python SDK caps paging at offset 10,000 and batch 500. | `sdk/postmark-python/postmark/utils/pagination.py:8-9,37-40` | SDK |
| Response has `TotalCount` plus a plural array (`Messages`, `Opens`, `Clicks`, `Bounces`). | `refs/api_messages-api.md:753-754`; `refs/api_bounce-api.md:125,154` | DOC |
| Suppressions dump has no `count`/`offset` and no `TotalCount`; it returns `Suppressions` only. | `refs/api_suppressions-api.md:30-42` | DOC |
| Paging errors: 700 (messages/opens/clicks), 1000 (bounces), 1400–1403 (suppressions), 500/600/800/1100/1300. | `refs/api_overview.md:83,96,112,116,121,148-151,161,203` | DOC |
| A client that pages with `count=500` until `offset + count >= TotalCount` can request `offset=10000, count=500` (sum 10,500). The reply is unknown. | — | INFERRED; capture Q15 |

### 7.3 Query parameter case

| Fact | Cite | Mark |
| --- | --- | --- |
| Docs spell message filters lowercase: `fromemail`, `todate`, `messagestream`. | `refs/api_messages-api.md:36-43` | DOC |
| Docs spell suppression filters mixed: `SuppressionReason`, `Origin`, `todate`, `EmailAddress`. | `refs/api_suppressions-api.md:32-36` | DOC |
| postmark.js sends camelCase: `fromEmail`, `messageStream`, `emailAddress`. | `sdk/postmark.js/src/client/models/messages/MessageFilteringParameters.ts:23-30`; `models/suppressions/SuppressionFilteringParameters.ts:20-24` | SDK |
| Therefore Postmark matches query keys case-insensitively. | doc/SDK mismatch above | INFERRED — capture Q6 |
| Query values (`HardBounce`, `outbound`) case sensitivity. | — | Unknown |

---

## 8. Mock must

- [ ] Serve `https://api.postmarkapp.com` paths from `/`. No version prefix. (§2.1)
- [ ] Accept `Accept: application/json` and `Content-Type: application/json` on every method. postmark.js sends `Content-Type` on GET. (§2.5)
- [ ] Parse query strings with case-insensitive keys. (§7.3, INFERRED)
- [ ] Read `X-Postmark-Server-Token` with a case-insensitive header name. (§3.1)
- [ ] Return 401 + `{"ErrorCode":10,"Message":<captured text>}` + `X-PM-ApiErrorCode: 10` for a missing token, an unknown token, or an account token on a server endpoint. (§3.4)
- [ ] Treat `POSTMARK_API_TEST` as a valid server token: validate fully, return `"Test job accepted"` on `POST /email`, record no delivery. (§3.3)
- [ ] Return status 200 for every success. Never 201 or 204. (§4.2, §5.2)
- [ ] Send every error as `application/json` with `ErrorCode` (number) and `Message` (string), and the `X-PM-ApiErrorCode` header. (§4.1)
- [ ] Use 422 for input errors, and only the documented other statuses (400 for 1002, 404, 500, 503). (§4.2)
- [ ] For a single-send 406, use the SDK fixture text (`recipient(s) that have been …`) until a capture replaces it. Keep `Found inactive addresses: <a>, <b>. Inactive` intact, with `", "` between addresses; the postmark.js, gem and python recipient parsers depend on it. (§4.1; `docs/01` "ErrorCode 406: inactive recipients")
- [ ] Return 422 + ErrorCode 300 for send validation failures. postmark.js and gem map 300 to `InvalidEmailRequestError`; python maps it by code. (§5.1, §5.2)
- [ ] Never close the socket to signal a rejection. postmark.js reports a dropped connection as `statusCode 0`, the same as a timeout. (§5.1)
- [ ] Enforce `count` 1..500, `offset` ≥ 0, and `count + offset` ≤ 10,000 where documented, with the documented codes. (§7.2)
- [ ] Emit PascalCase keys. Emit or omit absent fields per surface, as its doc or capture shows; there is no global rule (§7). Examples: suppression items carry `Message: null` (`docs/04` §2.4); opens/clicks omit unknown `Client`/`OS`/`Geo` (`docs/06` §6).
- [ ] Emit dates in the captured shape per field. Until captured: 7-digit fraction with Eastern offset for timestamps. (§7.1)
- [ ] Send no compression. (§2.7)
- [ ] Implement no rate limit. Return 429 only when a test forces it. (§6)
- [ ] Serve account-token endpoints (§3.2). Read `X-Postmark-Account-Token` there; a server token on an account endpoint gives 401/10. (§3.1, §3.4)

---

## 9. Open questions for a live capture

Use `POSTMARK_API_TEST` or a deliberately invalid token. Never a live token (`AGENTS.md` rule 7).
Record full status line, all response headers, and raw body in `captures/`.

| # | Question | Request |
| --- | --- | --- |
| Q1 | What does plain `http://api.postmarkapp.com/email` return (redirect, 403, served)? | `POST http://…/email` with test token |
| Q2 | Exact 401 `Message` text for: no header; unknown server token; `POSTMARK_API_TEST` in `X-Postmark-Account-Token`; server token on an account endpoint. | `POST /email`, `GET /servers` |
| Q3 | Is the token value case-insensitive (`postmark_api_test`)? Is the header name case-insensitive? | `POST /email` |
| Q4 | Exact error `Content-Type` (charset?) and other headers (`X-PM-ApiErrorCode`, `X-Request-Id`, `Server`, `Date`). | any 401 and 422 |
| Q5 | Which missing header gives 415: no `Content-Type`, `text/plain`, or no `Accept`? Body of a 415? | `POST /email` variants |
| Q6 | Are query keys case-insensitive (`fromEmail` vs `fromemail`, `emailAddress` vs `EmailAddress`)? | `GET /messages/outbound/opens`, suppressions dump, test token |
| Q7 | `POST /email` with the test token: exact body, `MessageID` (random or zero UUID), `SubmittedAt` shape, `To` echo. | `POST /email` |
| Q8 | Does the test token work on `GET /messages/outbound/opens`, `/clicks`, `GET /message-streams/outbound/suppressions/dump`, `POST …/suppressions/delete`, `GET /server`? Status and body. | those endpoints |
| Q9 | Body and `Content-Type` of 404 for an unknown route and for an unknown stream id. | `GET /nope`; `GET /message-streams/nope/suppressions/dump` |
| Q10 | Body and `Content-Type` for a body over 10 MB (JSON envelope or proxy HTML?). | `POST /email` with a large `TextBody`, test token |
| Q11 | Body and headers (`Retry-After`?) of a 429. Likely not safe to trigger. | none unless Postmark support confirms |
| Q12 | Are lowercase body keys accepted (`{"from":…,"to":…}`)? | `POST /email`, test token |
| Q13 | Unknown body field (`{"Foo":1}` plus a valid message): 200 or 422/403? Wrong type (`"TrackOpens":"yes"`)? | `POST /email`, test token |
| Q14 | Does Postmark compress responses when asked (`Accept-Encoding: gzip`)? | any GET |
| Q15 | `GET /messages/outbound/opens?count=500&offset=10000` (sum 10,500): 200 or 422/700? Also `count=0`, `count=501`, missing `count`. | opens endpoint |
| Q16 | Malformed JSON body: exact 402 message. Empty body on `POST /email`: which code? | `POST /email`, test token |
| Q17 | Send validation messages under ErrorCode 300 for: no `To`, bad `To`, no body parts, unknown `MessageStream` (1235?). | `POST /email`, test token |
| Q18 | Does the test token return 406 for any address, or never? | `POST /email` to a suppressed-looking address |
