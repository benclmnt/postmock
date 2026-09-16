import { z } from "zod";
import { apiError } from "../../errors.ts";
import { parseBody } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import { defineRoute, type RequestContext, type ServerAuth } from "../../http/routes.ts";
import { streamKey } from "../../state/store.ts";
import type { Webhook, WebhookTriggers } from "../../state/types.ts";

// The webhooks API (docs/05 §1.1–1.4). Errors are ErrorCodes 1350–1364.

const orNull = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (v === null ? undefined : v), schema.optional());

const flag = orNull(z.boolean());
const trigger = z.object({ Enabled: flag });

const triggersSchema = z.object({
  Open: orNull(z.object({ Enabled: flag, PostFirstOpenOnly: flag })),
  Click: orNull(trigger),
  Delivery: orNull(trigger),
  Bounce: orNull(z.object({ Enabled: flag, IncludeContent: flag })),
  SpamComplaint: orNull(z.object({ Enabled: flag, IncludeContent: flag })),
  SubscriptionChange: orNull(trigger),
});

const bodySchema = z.object({
  ID: orNull(z.unknown()),
  Status: orNull(z.unknown()),
  Url: orNull(z.string()),
  MessageStream: orNull(z.string()),
  HttpAuth: orNull(z.object({ Username: z.string(), Password: z.string() })),
  HttpHeaders: orNull(z.array(z.object({ Name: z.string(), Value: z.string() }))),
  Triggers: orNull(triggersSchema),
  Verify: orNull(z.boolean()),
});
type Body = z.output<typeof bodySchema>;

function parse(body: unknown): Body {
  if (body === undefined) throw apiError(1355);
  const parsed = parseBody(bodySchema, body);
  if (!parsed.success) throw apiError(1361);
  const data = parsed.data;
  if (data.Status !== undefined) throw apiError(1363);
  // `Verify` absent or true saves with no probe (INFERRED until docs/05 Q13 captures the probe):
  // SDK live tests create webhooks at hosts that answer no probe (docs/05 §1.3 conflict V1).
  const url = data.Url;
  if (url !== undefined && !isWebhookUrl(url)) throw apiError(1354);
  // An HTTP header name is an RFC 9110 token.
  if (data.HttpHeaders?.some((h) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(h.Name))) {
    throw apiError(1358);
  }
  return data;
}

function isWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const FALSE_TRIGGERS: WebhookTriggers = {
  Open: { Enabled: false, PostFirstOpenOnly: false },
  Click: { Enabled: false },
  Delivery: { Enabled: false },
  Bounce: { Enabled: false, IncludeContent: false },
  SpamComplaint: { Enabled: false, IncludeContent: false },
  SubscriptionChange: { Enabled: false },
};

/** A partial `Triggers` object changes only the given triggers and sub-fields (docs/05 §1.2). */
function mergeTriggers(current: WebhookTriggers, patch: Body["Triggers"]): WebhookTriggers {
  const merged = structuredClone(current);
  for (const [name, fields] of Object.entries(patch ?? {})) {
    if (fields === undefined) continue;
    const target = merged[name as keyof WebhookTriggers] as unknown as Record<string, boolean>;
    for (const [field, value] of Object.entries(fields)) {
      if (typeof value === "boolean") target[field] = value;
    }
  }
  return merged;
}

/** The wire shape (refs/api_webhooks-api.md:155-227). No auth or headers: `null` and `[]` (INFERRED). */
export const webhookJson = (w: Webhook) => ({
  ID: w.ID,
  Url: w.Url,
  MessageStream: w.MessageStream,
  Status: w.Status,
  HttpAuth: w.HttpAuth,
  HttpHeaders: w.HttpHeaders,
  Triggers: w.Triggers,
});

function findWebhook({ store, params, auth }: RequestContext & { auth: ServerAuth }): Webhook {
  const id = /^\d+$/.test(params.id ?? "") ? Number(params.id) : undefined;
  const webhook = id === undefined ? undefined : store.state.webhooks.get(id);
  if (webhook === undefined || webhook.ServerID !== auth.server.ID) throw apiError(1352);
  return webhook;
}

defineRoute({
  method: "GET",
  path: "/webhooks",
  auth: "server",
  handler: ({ store, query, auth }) => {
    // Doc spells the filter `MessageStream`, postmark.js `messageStream`; the query matches both.
    const stream = query.get("MessageStream");
    const webhooks = [...store.state.webhooks.values()].filter(
      (w) => w.ServerID === auth.server.ID && (stream === undefined || w.MessageStream === stream),
    );
    return { Webhooks: webhooks.map(webhookJson) };
  },
});

defineRoute({
  method: "GET",
  path: "/webhooks/:id",
  auth: "server",
  handler: (ctx) => webhookJson(findWebhook(ctx)),
});

defineRoute({
  method: "POST",
  path: "/webhooks",
  auth: "server",
  handler: ({ store, body, auth }) => {
    const data = parse(body);
    if (data.ID !== undefined) throw apiError(1356);
    if (data.Url === undefined) throw apiError(1354);
    const streamId = data.MessageStream ?? "outbound";
    const stream = store.state.streams.get(streamKey(auth.server.ID, streamId));
    // No webhooks ErrorCode names an unknown stream; 1226 is the streams API text (INFERRED).
    if (stream === undefined) throw apiError(1226, { family: "streams" });
    if (stream.ArchivedAt !== null) throw apiError(1350);
    if (stream.MessageStreamType === "Inbound") throw apiError(1351);
    const webhook: Webhook = {
      ID: store.nextId("webhook"),
      ServerID: auth.server.ID,
      Url: data.Url,
      MessageStream: stream.ID,
      Status: data.Verify === false ? "unverified" : "verified",
      HttpAuth: data.HttpAuth ?? null,
      HttpHeaders: data.HttpHeaders ?? [],
      Triggers: mergeTriggers(FALSE_TRIGGERS, data.Triggers),
    };
    store.state.webhooks.set(webhook.ID, webhook);
    return webhookJson(webhook);
  },
});

defineRoute({
  method: "PUT",
  path: "/webhooks/:id",
  auth: "server",
  handler: (ctx) => {
    const webhook = findWebhook(ctx);
    const data = parse(ctx.body);
    if (
      (data.ID !== undefined && data.ID !== webhook.ID) ||
      (data.MessageStream !== undefined && data.MessageStream !== webhook.MessageStream)
    ) {
      throw apiError(1357);
    }
    Object.assign(webhook, {
      ...(data.Url !== undefined && { Url: data.Url }),
      ...(data.HttpAuth !== undefined && { HttpAuth: data.HttpAuth }),
      ...(data.HttpHeaders !== undefined && { HttpHeaders: data.HttpHeaders }),
      ...(data.Verify === false && { Status: "unverified" }),
      Triggers: mergeTriggers(webhook.Triggers, data.Triggers),
    });
    return webhookJson(webhook);
  },
});

defineRoute({
  method: "DELETE",
  path: "/webhooks/:id",
  auth: "server",
  handler: (ctx) => {
    const webhook = findWebhook(ctx);
    ctx.store.state.webhooks.delete(webhook.ID);
    return { ErrorCode: 0, Message: `Webhook ${webhook.ID} removed.` };
  },
});

// No SDK calls these; their probe body (Q13) and slow thresholds (Q19) are not captured.
for (const [method, path, question] of [
  ["POST", "/webhooks/:id/verify", "Q13"],
  ["GET", "/webhooks/:id/statistics", "Q19"],
] as const) {
  defineRoute({
    method,
    path,
    auth: "server",
    handler: (ctx) => {
      findWebhook(ctx);
      throw new Unsupported(`${method} ${path} not captured (docs/05 ${question})`);
    },
  });
}
