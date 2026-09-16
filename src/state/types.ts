// Entities for the whole surface (docs/03–07).
// PascalCase fields carry a wire field of the same name; its value is formatted at the edge
// (a `Date` becomes the docs/02 §7.1 shape). camelCase fields are postmock-internal.
// `null` means "not set"; each API group decides whether the wire omits the key or sends null.

export type TrackLinks = "None" | "HtmlAndText" | "HtmlOnly" | "TextOnly";
// Lowercase on the wire: the SDK live tests send `red` and read back `red`
// (sdk/postmark.js/test/integration/Servers.test.ts:57-70; refs/api_servers-api.md:67 example).
export const SERVER_COLORS = [
  "purple",
  "blue",
  "turquoise",
  "green",
  "red",
  "yellow",
  "grey",
  "orange",
] as const;
export type ServerColor = (typeof SERVER_COLORS)[number];

export interface Header {
  Name: string;
  Value: string;
}

/** A parsed address. `Name` is null for a bare address (docs/06 §1.5). */
export interface Address {
  Email: string;
  Name: string | null;
}

export interface Attachment {
  Name: string;
  /** Base64. */
  Content: string;
  ContentType: string;
  ContentID: string | null;
  /** Decoded byte count. */
  ContentLength: number;
}

// docs/02 §3, docs/04 §5, docs/03 §1.6: account-level switches the control API flips.
export interface Account {
  tokens: string[];
  /** 412 pending, 413 unapproved (docs/02 §4.4). */
  approval: "approved" | "pending" | "unapproved";
  /** Bulk API access; ErrorCode 14 when false (docs/03 §1.6). */
  bulkApiEnabled: boolean;
  /** Data removals access; ErrorCode 1302 when false (docs/04 §5). */
  dataRemovalsEnabled: boolean;
  /** Message streams API access; ErrorCode 1220 when false (docs/04 §4.4). */
  messageStreamsApiEnabled: boolean;
  /** Custom unsubscribe handling; ErrorCode 1238 when false (docs/04 §4.4). */
  customUnsubscribeEnabled: boolean;
  /** Server deletion through the API; ErrorCode 604 when false (refs/api_servers-api.md:483). */
  serverDeletionEnabled: boolean;
}

// docs/06 §4.1; refs/api_server-api.md:30-53.
export interface Server {
  ID: number;
  Name: string;
  ApiTokens: string[];
  Color: ServerColor;
  SmtpApiActivated: boolean;
  RawEmailEnabled: boolean;
  DeliveryType: "Live" | "Sandbox";
  ServerLink: string;
  InboundAddress: string;
  InboundHookUrl: string;
  BounceHookUrl: string;
  OpenHookUrl: string;
  DeliveryHookUrl: string;
  ClickHookUrl: string;
  PostFirstOpenOnly: boolean;
  InboundDomain: string;
  InboundHash: string;
  InboundSpamThreshold: number;
  TrackOpens: boolean;
  TrackLinks: TrackLinks;
  IncludeBounceContentInHook: boolean;
  EnableSmtpApiErrorHooks: boolean;
}

export type MessageStreamType = "Transactional" | "Broadcasts" | "Inbound";
export type UnsubscribeHandlingType = "None" | "Postmark" | "Custom";

// docs/04 §4.2.
export interface MessageStream {
  ID: string;
  ServerID: number;
  Name: string;
  Description: string | null;
  MessageStreamType: MessageStreamType;
  CreatedAt: Date;
  UpdatedAt: Date | null;
  ArchivedAt: Date | null;
  ExpectedPurgeDate: Date | null;
  SubscriptionManagementConfiguration: { UnsubscribeHandlingType: UnsubscribeHandlingType };
}

export type OutboundStatus = "Queued" | "Sent" | "Processed";
export type MessageEventType =
  | "Delivered"
  | "Transient"
  | "Opened"
  | "LinkClicked"
  | "Bounced"
  | "SubscriptionChanged";

// docs/06 §1.6. Details values are strings on the wire (java reads Map<String,String>).
export interface MessageEvent {
  Recipient: string;
  Type: MessageEventType;
  ReceivedAt: Date;
  Details: Record<string, string>;
}

// docs/03 §1.2 request fields plus docs/06 §1.5 message fields.
export interface OutboundMessage {
  MessageID: string;
  ServerID: number;
  MessageStream: string;
  From: string;
  To: Address[];
  Cc: Address[];
  Bcc: Address[];
  ReplyTo: string | null;
  Subject: string | null;
  HtmlBody: string | null;
  TextBody: string | null;
  Tag: string | null;
  Headers: Header[];
  Attachments: Attachment[];
  Metadata: Record<string, string>;
  TrackOpens: boolean;
  TrackLinks: TrackLinks;
  Status: OutboundStatus;
  Sandboxed: boolean;
  /** `SubmittedAt` on the send response; `ReceivedAt` on the Messages API. */
  ReceivedAt: Date;
  MessageEvents: MessageEvent[];
  channel: "rest" | "smtp";
  /** The request JSON (REST) or raw MIME (SMTP), for `GET /control/messages` (docs/09 §5). */
  request: unknown;
  /** The generated MIME source served by the dump endpoint (docs/06 §1.2). */
  rawSource: string;
  bulkRequestId: string | null;
  templateId: number | null;
}

export type InboundStatus = "Blocked" | "Processed" | "Queued" | "Failed" | "Scheduled" | "Sent";

export interface InboundAddress {
  Email: string;
  Name: string;
  MailboxHash: string;
}

export interface InboundAttachment {
  Name: string;
  Content: string;
  ContentType: string;
  ContentLength: number;
  ContentID: string;
}

// docs/05 §4.2; docs/06 §1.2 (details add Status and BlockedReason).
export interface InboundMessage {
  MessageID: string;
  ServerID: number;
  MessageStream: string;
  From: string;
  FromName: string;
  FromFull: InboundAddress;
  To: string;
  ToFull: InboundAddress[];
  Cc: string;
  CcFull: InboundAddress[];
  Bcc: string;
  BccFull: InboundAddress[];
  OriginalRecipient: string;
  ReplyTo: string;
  Subject: string;
  MailboxHash: string;
  /** Sender RFC 2822 `Date` header, as received. */
  Date: string;
  TextBody: string;
  HtmlBody: string;
  StrippedTextReply: string;
  Tag: string;
  Headers: Header[];
  Attachments: InboundAttachment[];
  Status: InboundStatus;
  BlockedReason: string | null;
  ReceivedAt: Date;
  rawEmail: string;
}

// docs/04 §1.4.
export const BOUNCE_TYPES = {
  HardBounce: { TypeCode: 1, Name: "Hard bounce" },
  Transient: { TypeCode: 2, Name: "Message delayed/Undeliverable" },
  Unsubscribe: { TypeCode: 16, Name: "Unsubscribe request" },
  Subscribe: { TypeCode: 32, Name: "Subscribe request" },
  AutoResponder: { TypeCode: 64, Name: "Auto responder" },
  AddressChange: { TypeCode: 128, Name: "Address change" },
  DnsError: { TypeCode: 256, Name: "DNS error" },
  SpamNotification: { TypeCode: 512, Name: "Spam notification" },
  OpenRelayTest: { TypeCode: 1024, Name: "Open relay test" },
  Unknown: { TypeCode: 2048, Name: "Unknown" },
  SoftBounce: { TypeCode: 4096, Name: "Soft bounce" },
  VirusNotification: { TypeCode: 8192, Name: "Virus notification" },
  ChallengeVerification: { TypeCode: 16384, Name: "Spam challenge verification" },
  BadEmailAddress: { TypeCode: 100000, Name: "Invalid email address" },
  SpamComplaint: { TypeCode: 100001, Name: "Spam complaint" },
  ManuallyDeactivated: { TypeCode: 100002, Name: "Manually deactivated" },
  Unconfirmed: { TypeCode: 100003, Name: "Registration not confirmed" },
  Blocked: { TypeCode: 100006, Name: "ISP block" },
  SMTPApiError: { TypeCode: 100007, Name: "SMTP API error" },
  InboundError: { TypeCode: 100008, Name: "Processing failed" },
  DMARCPolicy: { TypeCode: 100009, Name: "DMARC Policy" },
  TemplateRenderingFailed: { TypeCode: 100010, Name: "Template rendering failed" },
} as const;
export type BounceType = keyof typeof BOUNCE_TYPES;

// docs/04 §1.3; docs/05 §2.1–2.2 (Metadata for the webhook payload).
export interface Bounce {
  ID: number;
  ServerID: number;
  MessageStream: string;
  MessageID: string;
  Type: BounceType;
  Tag: string | null;
  Description: string;
  Details: string;
  Email: string;
  From: string | null;
  Subject: string;
  BouncedAt: Date;
  Inactive: boolean;
  CanActivate: boolean;
  /** Raw dump; `DumpAvailable` is false once it is empty or older than 30 days. */
  Content: string;
  Metadata: Record<string, string>;
}

export type SuppressionReason = "HardBounce" | "SpamComplaint" | "ManualSuppression";
export type SuppressionOrigin = "Recipient" | "Customer" | "Admin";

// docs/04 §2.3; keyed by (server, stream, lower-cased email) (docs/04 Mock must).
export interface Suppression {
  ServerID: number;
  MessageStream: string;
  EmailAddress: string;
  SuppressionReason: SuppressionReason;
  Origin: SuppressionOrigin;
  CreatedAt: Date;
}

// docs/05 §2.6.
export interface SubscriptionChange {
  MessageID: string | null;
  ServerID: number;
  MessageStream: string;
  ChangedAt: Date;
  Recipient: string;
  Origin: SuppressionOrigin;
  SuppressSending: boolean;
  SuppressionReason: SuppressionReason | null;
  Tag: string | null;
  Metadata: Record<string, string>;
}

export interface ClientInfo {
  Name: string;
  Company: string;
  Family: string;
}

export interface Geo {
  CountryISOCode?: string;
  Country?: string;
  RegionISOCode?: string;
  Region?: string;
  City?: string;
  Zip?: string;
  Coords?: string;
  IP?: string;
}

// docs/06 §1.7, docs/05 §2.4. Client, OS, Platform, Geo are omitted on the wire when unknown.
export interface OpenEvent {
  ServerID: number;
  MessageID: string;
  MessageStream: string;
  Recipient: string;
  Tag: string | null;
  Metadata: Record<string, string>;
  ReceivedAt: Date;
  FirstOpen: boolean;
  UserAgent: string;
  ReadSeconds: number;
  Client: ClientInfo | null;
  OS: ClientInfo | null;
  Platform: "WebMail" | "Desktop" | "Mobile" | "Unknown" | null;
  Geo: Geo | null;
}

// docs/06 §1.7, docs/05 §2.5.
export interface ClickEvent {
  ServerID: number;
  MessageID: string;
  MessageStream: string;
  Recipient: string;
  Tag: string | null;
  Metadata: Record<string, string>;
  ReceivedAt: Date;
  UserAgent: string;
  ClickLocation: "HTML" | "Text";
  OriginalLink: string;
  Client: ClientInfo | null;
  OS: ClientInfo | null;
  Platform: "WebMail" | "Desktop" | "Mobile" | "Unknown" | null;
  Geo: Geo | null;
}

// docs/06 §3.2. A deleted template stays readable with Active false.
export interface Template {
  TemplateId: number;
  ServerID: number;
  Name: string;
  Alias: string | null;
  Subject: string | null;
  HtmlBody: string | null;
  TextBody: string | null;
  TemplateType: "Standard" | "Layout";
  LayoutTemplate: string | null;
  Active: boolean;
}

// docs/03 §1.6.
export interface BulkRequest {
  Id: string;
  ServerID: number;
  SubmittedAt: Date;
  Status: "Accepted" | "Processing" | "Completed" | "Cancelled";
  TotalMessages: number;
  PercentageCompleted: number;
  ReleasedCount: number;
  FailedCount: number;
  Subject: string | null;
  messageIds: string[];
}

// docs/05 §1.2.
export interface WebhookTriggers {
  Open: { Enabled: boolean; PostFirstOpenOnly: boolean };
  Click: { Enabled: boolean };
  Delivery: { Enabled: boolean };
  Bounce: { Enabled: boolean; IncludeContent: boolean };
  SpamComplaint: { Enabled: boolean; IncludeContent: boolean };
  SubscriptionChange: { Enabled: boolean };
}

export interface Webhook {
  ID: number;
  ServerID: number;
  Url: string;
  MessageStream: string;
  Status: "verified" | "unverified";
  HttpAuth: { Username: string; Password: string } | null;
  HttpHeaders: Header[];
  Triggers: WebhookTriggers;
}

export type WebhookRecordType =
  | "Bounce"
  | "SpamComplaint"
  | "Delivery"
  | "Open"
  | "Click"
  | "SubscriptionChange"
  | "Inbound";

// docs/05 §3: one row per POST attempt, for `GET /control/webhooks/attempts`.
export interface WebhookAttempt {
  id: number;
  serverId: number;
  recordType: WebhookRecordType;
  url: string;
  traceId: string;
  payload: unknown;
  attempt: number;
  at: Date;
  outcome: { status: number } | { error: string };
  nextAttemptAt: Date | null;
}

// docs/05 §1.6.
export interface InboundRule {
  ID: number;
  ServerID: number;
  Rule: string;
}

// refs/api_domains-api.md:104-123 (docs/06 §4.3).
export interface Domain {
  ID: number;
  Name: string;
  SPFVerified: boolean;
  SPFHost: string;
  SPFTextValue: string;
  DKIMVerified: boolean;
  WeakDKIM: boolean;
  DKIMHost: string;
  DKIMTextValue: string;
  DKIMPendingHost: string;
  DKIMPendingTextValue: string;
  DKIMRevokedHost: string;
  DKIMRevokedTextValue: string;
  SafeToRemoveRevokedKeyFromDNS: boolean;
  DKIMUpdateStatus: "Pending" | "Verified";
  ReturnPathDomain: string;
  ReturnPathDomainVerified: boolean;
  ReturnPathDomainCNAMEValue: string;
}

// refs/api_signatures-api.md:104-128 (docs/06 §4.4).
export interface SenderSignature extends Omit<Domain, "Name"> {
  Domain: string;
  EmailAddress: string;
  ReplyToEmailAddress: string;
  Name: string;
  Confirmed: boolean;
  ConfirmationPersonalNote: string;
}

// docs/04 §5.
export interface DataRemoval {
  ID: number;
  RequestedBy: string;
  RequestedFor: string;
  NotifyWhenCompleted: boolean;
  Status: "Pending" | "Done";
  createdAt: Date;
}

// docs/07 §1.2: one SMTP token per message stream.
export interface SmtpToken {
  accessKey: string;
  secretKey: string;
  serverId: number;
  messageStream: string;
}

/** An error reply is built with `apiError`, so its status and code pair exists in docs/02 §4.4. */
export type FaultReply =
  | { status: number; body: { ErrorCode: number; Message: string } }
  | "timeout"
  | "reset";

// docs/09 §5 `POST /control/faults`.
export interface Fault {
  method: string;
  /** A route pattern, matched like an API route (`/email`, `/templates/:id`). */
  path: string;
  remaining: number;
  reply: FaultReply;
}
