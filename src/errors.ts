// The ErrorCode table of docs/02 §4.4, one row per documented row, in doc order.
// `message` rows: the doc text is used as the wire `Message`. It is INFERRED except where a comment
// cites an SDK text. Code spans become single quotes: the one SDK-quoted wire text (1226) uses 'ID'
// where the doc shows `ID` (docs/04 §4.4); the same rule for other codes is INFERRED.
// `summary` rows describe several wire messages; `apiError` and `errorBody` need an exact `message`.

export const ERROR_FAMILIES = [
  "auth",
  "global",
  "sending",
  "templates",
  "servers",
  "messages",
  "inboundRules",
  "streams",
  "suppressions",
  "senders",
  "smtpTokens",
  "stats",
  "dataRemovals",
  "webhooks",
] as const;
export type ErrorFamily = (typeof ERROR_FAMILIES)[number];

/** HTTP statuses a code uses. 200 means the code only appears inside a 200 body item. */
type Statuses = readonly [number, ...number[]];
type Row = readonly [
  code: number,
  family: ErrorFamily,
  statuses: Statuses,
  wording: "message" | "summary",
  text: string,
];

export const ERROR_TABLE: readonly Row[] = [
  [
    10,
    "auth",
    [401],
    "message",
    "Request does not contain a valid Server or Account token, or the wrong token type was used for the endpoint.",
  ],

  // Global
  [100, "global", [503], "message", "The Postmark API is offline for maintenance."],
  [
    101,
    "global",
    [500],
    "summary",
    "You encountered an error that shouldn't have occurred. The response includes an 'Error ID' for support.",
  ],

  // Sending
  [
    11,
    "sending",
    [422],
    "summary",
    "Multiple errors occurred. Inspect the 'Errors' property for more information.",
  ],
  [12, "sending", [404], "message", "Bulk send not found."],
  [13, "sending", [422], "message", "Invalid pagination key."],
  [
    14,
    "sending",
    [422],
    "summary",
    "This endpoint requires approval to access. Contact support to use the Bulk API.",
  ],
  [
    300,
    "sending",
    [422],
    "summary",
    "Send validation. Covers many messages — zero recipients, invalid address, missing 'TextBody'/'HtmlBody', and recipient, metadata, attachment, or header limits.",
  ],
  [402, "sending", [422], "message", "Invalid JSON."],
  [403, "sending", [422], "summary", "Invalid request field(s)."],
  // SDK text: sdk/postmark.js/test/unit/ErrorHandler.test.ts:113-116. Clients parse the addresses (docs/02 §4.1).
  [
    406,
    "sending",
    [422],
    "message",
    "You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: {addresses}. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression.",
  ],
  [
    410,
    "sending",
    [422],
    "message",
    "You may only send up to 500 messages in a single batched request.",
  ],
  [411, "sending", [422], "message", "Attachment file type not allowed."],
  [
    412,
    "sending",
    [422],
    "message",
    "While your account is pending approval, all recipient addresses must share the same domain as the From address.",
  ],
  [413, "sending", [422], "message", "This account is not approved to send email."],
  [422, "sending", [422], "message", "Invalid Server or Account."],
  // SDK text: sdk/postmark-php/tests/PostmarkClientEmailTest.php:92-93.
  [
    1235,
    "sending",
    [422],
    "message",
    "The stream provided: '{stream}' does not exist on this server.",
  ],
  [1236, "sending", [422], "message", "Sending is not supported for this stream type."],
  [
    1480,
    "sending",
    [422],
    "summary",
    "You are not authorized to send emails from your current IP address: 'IP Address'.",
  ],

  // Templates
  [
    601,
    "templates",
    [422],
    "summary",
    "The source or destination server was not found (template push).",
  ],
  [
    1100,
    "templates",
    [422],
    "summary",
    "Template list paging, or an invalid 'TemplateType' or 'editorType' query parameter.",
  ],
  [
    1101,
    "templates",
    [422],
    "summary",
    "The request specifies neither 'TemplateId' nor 'TemplateAlias', or the referenced template, alias, or layout was not found.",
  ],
  [
    1105,
    "templates",
    [422],
    "message",
    "A server's active-template limit would be exceeded by this request.",
  ],
  [1109, "templates", [422], "message", "No template data received."],
  [
    1120,
    "templates",
    [422],
    "summary",
    "A required field is missing — 'Name', one of 'TextBody'/'HtmlBody', 'Subject', or 'TemplateModel'.",
  ],
  [
    1121,
    "templates",
    [422],
    "summary",
    "A field is too long — 'Name', 'Alias', 'HtmlBody', 'TextBody', 'Subject', or 'TemplateModel'.",
  ],
  [
    1122,
    "templates",
    [422],
    "summary",
    "Invalid 'TemplateType', alias empty/invalid/in-use, unparseable body, or a reserved top-level 'TemplateModel' key.",
  ],
  [
    1123,
    "templates",
    [422],
    "summary",
    "Template/send mutual-exclusion rules (layout vs. subject/body, templated vs. non-templated).",
  ],
  [
    1124,
    "templates",
    [422],
    "summary",
    "No templates with aliases found to push, or the per-request push limit was exceeded.",
  ],
  [
    1125,
    "templates",
    [422],
    "message",
    "The template types don't match on the source and destination servers.",
  ],
  [
    1130,
    "templates",
    [422],
    "message",
    "The layout template cannot be deleted because dependent templates use it.",
  ],
  [1131, "templates", [422], "summary", "Layout content-placeholder rules were not met."],

  // Servers
  [
    600,
    "servers",
    [422],
    "summary",
    "Server-list paging — 'offset'/'count' required or integer; up to 500 servers per call.",
  ],
  [
    602,
    "servers",
    [422],
    "message",
    "The specified inbound domain is already registered or in use on another server.",
  ],
  [603, "servers", [422], "message", "This server name already exists."],
  [604, "servers", [422], "message", "You do not have permission to delete servers using the API."],
  [605, "servers", [422], "message", "Unable to remove this server. Please contact support."],
  [
    606,
    "servers",
    [422],
    "summary",
    "A supplied hook URL (Inbound, Bounce, Open, Delivery, or Click) is not valid.",
  ],
  [607, "servers", [422], "message", "Invalid server color."],
  [
    608,
    "servers",
    [422],
    "summary",
    "Server name is invalid or missing, or an inbound domain containing postmarkapp.com was used.",
  ],
  [609, "servers", [422], "message", "No server data received."],
  [
    610,
    "servers",
    [422],
    "message",
    "We could not find an MX record pointing to the expected domain.",
  ],
  [
    611,
    "servers",
    [422],
    "message",
    "InboundSpamThreshold value is invalid. Use a number between 0 and 30.",
  ],
  [612, "servers", [422], "message", "The supplied 'TrackLinks' option is not valid."],
  [613, "servers", [422], "message", "The supplied 'DeliveryType' option is not valid."],
  [
    614,
    "servers",
    [422],
    "summary",
    "Entitlement limit reached (inbound, stats, users, servers, streams, or domains).",
  ],
  [615, "servers", [422], "message", "Action is not supported."],

  // Message activity, messages & bounces
  [
    700,
    "messages",
    [422],
    "summary",
    "Paging/parameter validation for messages, opens, clicks, and activity.",
  ],
  [
    701,
    "messages",
    [422],
    "summary",
    "This message was not found, or cannot be bypassed or retried.",
  ],
  [
    702,
    "messages",
    [422],
    "message",
    "Could not bypass this blocked message. Please contact support.",
  ],
  [
    703,
    "messages",
    [422],
    "message",
    "Could not retry this failed message. Please contact support.",
  ],
  [
    1000,
    "messages",
    [422],
    "summary",
    "Bounces query validation (non-negative, up to 500, count+offset, illegal bounce type).",
  ],
  [
    1001,
    "messages",
    [422],
    "summary",
    "The bounce was not found, or its dump is no longer available.",
  ],
  [1002, "messages", [400], "message", "A 'bounceID' parameter is required."],
  [
    1003,
    "messages",
    [422],
    "message",
    "Due to the type of bounce, this address cannot be reactivated.",
  ],

  // Inbound rules / triggers
  [
    800,
    "inboundRules",
    [422],
    "summary",
    "You may only request up to 500 triggers per call, plus parameter validation.",
  ],
  [809, "inboundRules", [422], "message", "No trigger data received."],
  [810, "inboundRules", [422], "message", "This inbound rule already exists."],
  [
    811,
    "inboundRules",
    [422],
    "message",
    "Unable to remove this inbound rule. Please contact support.",
  ],
  [812, "inboundRules", [422], "message", "This inbound rule was not found."],

  // Message Streams
  [1220, "streams", [422], "message", "You do not have permission to use the message streams API."],
  [
    1221,
    "streams",
    [422],
    "message",
    "The 'MessageStreamType' associated with this request was invalid.",
  ],
  [1222, "streams", [422], "message", "A valid 'ID' must be provided."],
  [1223, "streams", [422], "message", "A valid 'Name' must be provided."],
  [1224, "streams", [422], "message", "The 'Name' is too long."],
  [
    1225,
    "streams",
    [422],
    "message",
    "You have reached the maximum number of message streams for this server.",
  ],
  // SDK text: sdk/postmark-php/tests/PostmarkClientSuppressionsTest.php:135 (docs/04 §4.4).
  [1226, "streams", [422], "message", "The message stream for the provided 'ID' was not found."],
  [
    1227,
    "streams",
    [422],
    "message",
    "The 'ID' must be a non-empty string starting with a letter, up to 30 characters.",
  ],
  [1228, "streams", [422], "message", "A server can only have one inbound stream."],
  [
    1229,
    "streams",
    [422],
    "message",
    "You cannot archive the default transactional and inbound streams.",
  ],
  [1230, "streams", [422], "message", "The 'ID' provided already exists for this server."],
  [1231, "streams", [422], "message", "The 'Description' is too long."],
  [1232, "streams", [422], "message", "You cannot unarchive this message stream anymore."],
  [1233, "streams", [422], "message", "The 'ID' must not start with the 'pm-' prefix."],
  [1234, "streams", [422], "message", "The 'Description' must not contain HTML tags."],
  [1237, "streams", [422], "message", "The 'ID' is reserved."],
  [
    1238,
    "streams",
    [422],
    "message",
    "You do not have permission to use Custom Unsubscribe Handling for this stream.",
  ],
  [
    1239,
    "streams",
    [422],
    "message",
    "The 'UnsubscribeHandlingType' provided is not supported for this stream type.",
  ],
  [
    1240,
    "streams",
    [422],
    "message",
    "The 'UnsubscribeHandlingType' associated with this request is invalid.",
  ],
  [1241, "streams", [422], "message", "Stream is unable to be archived at this time."],

  // Suppressions
  [
    1400,
    "suppressions",
    [422],
    "message",
    "Parameter 'count' should be an integer within the allowed range.",
  ],
  [1401, "suppressions", [422], "message", "Parameter 'count' is required but was left out."],
  [
    1402,
    "suppressions",
    [422],
    "message",
    "Parameter 'offset' should be an integer greater than or equal to zero.",
  ],
  [1403, "suppressions", [422], "message", "Parameter 'offset' is required but was left out."],
  [1404, "suppressions", [422], "message", "Parameter 'SuppressionReason' is invalid."],
  [1405, "suppressions", [422], "message", "Parameter 'Origin' is invalid."],
  // Item text: refs/api_suppressions-api.md:158-161 (docs/04 §2.4).
  [
    1406,
    "suppressions",
    [200],
    "message",
    "You do not have the required authority to change this suppression.",
  ],
  [1407, "suppressions", [422], "message", "Something went wrong when processing the request."],
  [1408, "suppressions", [422, 200], "message", "An invalid email address was provided."],
  [1409, "suppressions", [422], "message", "A proper request body must be provided."],
  [
    1410,
    "suppressions",
    [422],
    "message",
    "You cannot provide more than the maximum number of suppressions for this request.",
  ],
  [
    1411,
    "suppressions",
    [422],
    "message",
    "Parameter 'emailAddress' is required but was left out.",
  ],

  // Sender Signatures & Domains
  [
    500,
    "senders",
    [422],
    "summary",
    "Signature/domain list paging ('count'/'offset' required or integer, up to 500).",
  ],
  [
    501,
    "senders",
    [422, 404, 500],
    "summary",
    "Signature not found (422/404), or the signature has no DKIM info (500).",
  ],
  [502, "senders", [422], "message", "No update data or signature data received."],
  [503, "senders", [422], "message", "You can't use public domain emails or public domains."],
  [
    504,
    "senders",
    [422],
    "summary",
    "This signature already exists, or a similar signature already exists.",
  ],
  [505, "senders", [422], "message", "This DKIM is already being renewed."],
  [506, "senders", [422], "message", "This Sender Signature has already been confirmed."],
  [507, "senders", [422], "message", "You do not own this Sender Signature."],
  [
    508,
    "senders",
    [422],
    "summary",
    "This DKIM is not being renewed, or a key in a failed state cannot be rotated.",
  ],
  [510, "senders", [422], "message", "This domain was not found."],
  [511, "senders", [422], "message", "Invalid fields supplied."],
  [512, "senders", [422], "message", "Domain already exists."],
  [513, "senders", [422], "message", "You do not own this Domain."],
  [514, "senders", [422], "message", "Name is a required field to create a Domain."],
  [515, "senders", [422], "message", "Name field must be ≤ 255 characters."],
  [516, "senders", [422], "message", "Name format is invalid."],
  [520, "senders", [422], "message", "FromEmail is a required field to create a Sender Signature."],
  [
    521,
    "senders",
    [422],
    "summary",
    "A field is too long (confirmation note, Name, FromEmail, ReplyToEmail, ReturnPathDomain, or CustomTrackingDomain).",
  ],
  [522, "senders", [422], "summary", "A value is not a valid email address, domain, or subdomain."],
  [
    523,
    "senders",
    [422],
    "message",
    "You need to add a CNAME record that points to the expected value.",
  ],
  [614, "senders", [422], "summary", "Signature/domain entitlement limit reached."],
  [
    709,
    "senders",
    [500],
    "message",
    "DKIM verification failed due to invalid configuration. Please contact support.",
  ],

  // SMTP Tokens
  [1450, "smtpTokens", [422], "message", "Parameter 'serverId' is required but was left out."],
  [1451, "smtpTokens", [422], "message", "This token could not be found."],
  [1452, "smtpTokens", [422], "message", "A request body must be provided."],
  [1453, "smtpTokens", [422], "message", "This server was not found."],
  [
    1454,
    "smtpTokens",
    [422],
    "summary",
    "A valid 'MessageStream' is required, or the specified stream does not exist.",
  ],
  [
    1455,
    "smtpTokens",
    [422],
    "message",
    "The request must contain a valid and existing 'ServerID'.",
  ],
  [1456, "smtpTokens", [422], "message", "Token length must be within the allowed range."],
  [1457, "smtpTokens", [422], "message", "Tokens cannot be used with inbound streams."],
  [
    1458,
    "smtpTokens",
    [422],
    "message",
    "A message stream's token limit would be exceeded by this request.",
  ],
  [
    1459,
    "smtpTokens",
    [422],
    "message",
    "A token cannot be issued for an archived stream scheduled for deletion.",
  ],
  [1460, "smtpTokens", [422], "message", "SMTP is currently disabled for the specified server."],

  // Statistics API
  [
    614,
    "stats",
    [422],
    "message",
    "You are not entitled to use the stats API. Upgrade to the next tier to add it.",
  ],
  [900, "stats", [422], "message", "A parameter should be a date/time value."],
  // Same text as streams 1226 (INFERRED).
  [1226, "stats", [422], "message", "The message stream for the provided 'ID' was not found."],
  [1500, "stats", [422], "message", "The 'FromDate' field cannot be older than one year ago."],
  [
    1501,
    "stats",
    [422],
    "message",
    "Parameter 'count' should be an integer within the allowed range.",
  ],
  [1502, "stats", [422], "message", "Parameter 'FromDate' must be older than 'ToDate'."],

  // GDPR API
  [1300, "dataRemovals", [422], "summary", "Empty request, or an invalid offset or count."],
  [1301, "dataRemovals", [422], "summary", "Missing or incorrect data removal request ID."],
  [
    1302,
    "dataRemovals",
    [422],
    "message",
    "You don't have permission to process or review data removal requests through the API.",
  ],

  // Webhooks API
  [
    1350,
    "webhooks",
    [422],
    "message",
    "You cannot create a webhook using an archived 'MessageStream'.",
  ],
  [1351, "webhooks", [422], "message", "You cannot create a webhook using an inbound stream."],
  [1352, "webhooks", [422], "message", "The webhook for the provided 'ID' was not found."],
  [
    1353,
    "webhooks",
    [422],
    "message",
    "The webhook trigger is not supported on this message stream.",
  ],
  [1354, "webhooks", [422], "message", "The request must contain a valid 'Url' field."],
  [1355, "webhooks", [422], "message", "A request body must be provided."],
  [
    1356,
    "webhooks",
    [422],
    "message",
    "A request 'ID' must not be provided when creating a webhook.",
  ],
  [
    1357,
    "webhooks",
    [422],
    "message",
    "You cannot update the 'ID' or 'MessageStream' fields of a webhook.",
  ],
  [1358, "webhooks", [422], "message", "You must provide a valid 'HttpHeader' 'Name'."],
  [
    1359,
    "webhooks",
    [422],
    "message",
    "You have reached the maximum number of webhooks for this stream.",
  ],
  [1360, "webhooks", [422], "message", "You cannot update the integration."],
  [1361, "webhooks", [422], "message", "Invalid value provided for a field."],
  [
    1362,
    "webhooks",
    [422],
    "message",
    "Invalid value provided for 'status'. Must be one of: verified, unverified.",
  ],
  [
    1363,
    "webhooks",
    [422],
    "message",
    "The 'Status' field cannot be provided when creating or updating a webhook.",
  ],
  [
    1364,
    "webhooks",
    [422],
    "summary",
    "Webhook verification failed; nothing was saved. Fix the endpoint and retry, or send '?verify=false' to save it unverified.",
  ],
];

export type ErrorBody = { ErrorCode: number; Message: string };

/** A Postmark error response. The HTTP app turns it into the envelope (docs/02 §4.1). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody & Record<string, unknown>;

  constructor(status: number, body: ErrorBody & Record<string, unknown>) {
    super(`${status} ErrorCode ${body.ErrorCode}: ${body.Message}`);
    this.status = status;
    this.body = body;
  }
}

export type ErrorOptions = {
  /** Required for a code listed under more than one family (614, 1226). */
  family?: ErrorFamily;
} & (
  | {
      /** Exact wire text, used as given. Required for a `summary` row. */
      message: string;
      params?: never;
    }
  | {
      message?: never;
      /** Values for `{name}` placeholders in a `message` row. */
      params?: Record<string, string>;
    }
);

function row(code: number, family: ErrorFamily | undefined): Row {
  const rows = ERROR_TABLE.filter(
    (r) => r[0] === code && (family === undefined || r[1] === family),
  );
  const [only, ...rest] = rows;
  if (only === undefined) throw new Error(`ErrorCode ${code} is not in docs/02 §4.4`);
  if (rest.length > 0) throw new Error(`ErrorCode ${code} needs a family`);
  return only;
}

function render(template: string, params: Record<string, string>): string {
  const used = new Set<string>();
  const text = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing message param '${name}'`);
    used.add(name);
    return value;
  });
  const unused = Object.keys(params).filter((name) => !used.has(name));
  if (unused.length > 0) throw new Error(`unused message params: ${unused.join(", ")}`);
  return text;
}

/** Whether the docs/02 §4.4 row of `code` is a summary that needs an exact message. */
export const isSummaryRow = (code: number, family?: ErrorFamily): boolean =>
  row(code, family)[3] === "summary";

/** `{ErrorCode, Message}` for a response body or a batch item. */
export function errorBody(code: number, options: ErrorOptions = {}): ErrorBody {
  const [, , , wording, text] = row(code, options.family);
  if (options.message !== undefined) return { ErrorCode: code, Message: options.message };
  if (wording === "summary") {
    throw new Error(`ErrorCode ${code} has a summary row in docs/02 §4.4; pass the exact message`);
  }
  return { ErrorCode: code, Message: render(text, options.params ?? {}) };
}

/** An HTTP error for `code`. `status` is required when the code uses several statuses. */
export function apiError(
  code: number,
  options: ErrorOptions & { status?: number; extra?: Record<string, unknown> } = {},
): ApiError {
  const statuses = row(code, options.family)[2].filter((s) => s !== 200);
  const [first, ...others] = statuses;
  if (first === undefined) throw new Error(`ErrorCode ${code} only appears inside a 200 body`);
  const status = options.status ?? (others.length === 0 ? first : undefined);
  if (status === undefined || !statuses.includes(status)) {
    throw new Error(`ErrorCode ${code} needs a status from ${statuses.join(", ")}`);
  }
  for (const key of ["ErrorCode", "Message"]) {
    if (options.extra !== undefined && key in options.extra)
      throw new Error(`extra may not set ${key}`);
  }
  return new ApiError(status, { ...errorBody(code, options), ...options.extra });
}

/**
 * The HTTP error for a body `errorBody` built earlier, such as a send rejection. The code may sit
 * under several families; every row of it must use the same single status.
 */
export function apiErrorOf(body: ErrorBody): ApiError {
  const rows = ERROR_TABLE.filter((r) => r[0] === body.ErrorCode);
  if (rows.length === 0) throw new Error(`ErrorCode ${body.ErrorCode} is not in docs/02 §4.4`);
  const statuses = new Set(rows.flatMap((r) => r[2]).filter((s) => s !== 200));
  const [status, ...others] = statuses;
  if (status === undefined || others.length > 0) {
    throw new Error(`ErrorCode ${body.ErrorCode} has no single HTTP status`);
  }
  return new ApiError(status, body);
}
