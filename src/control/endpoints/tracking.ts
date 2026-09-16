import { z } from "zod";
import { formatTimestamp } from "../../time.ts";
import {
  type RecipientAgent,
  recordClick,
  recordDelivery,
  recordOpen,
  TrackingRefused,
} from "../../tracking.ts";
import { ControlError, controlInput, defineControl } from "../registry.ts";

// Recipient actions on a sent message (CONTROL-API.md): delivery, open, click. Each fires the same
// event a real recipient action fires, so webhooks, message events and stats follow.

const clientInfo = z.object({ name: z.string(), company: z.string(), family: z.string() });

const agentSchema = {
  // Postmark reads the client from the user agent. The mock takes the parsed parts from the test.
  userAgent: z.string().min(1).default("Mozilla/5.0 (postmock)"),
  client: clientInfo.optional(),
  os: clientInfo.optional(),
  platform: z.enum(["WebMail", "Desktop", "Mobile", "Unknown"]).optional(),
  geo: z
    .object({
      countryISOCode: z.string(),
      country: z.string(),
      regionISOCode: z.string(),
      region: z.string(),
      city: z.string(),
      zip: z.string(),
      coords: z.string(),
      ip: z.string(),
    })
    .partial()
    .refine((geo) => Object.keys(geo).length > 0, "geo needs at least one field")
    .optional(),
};

const target = { messageId: z.string(), recipient: z.string() };

type AgentInput = z.output<z.ZodObject<typeof agentSchema>>;

const info = (c: z.output<typeof clientInfo> | undefined) =>
  c === undefined ? null : { Name: c.name, Company: c.company, Family: c.family };

const agent = (input: AgentInput): RecipientAgent => ({
  UserAgent: input.userAgent,
  Client: info(input.client),
  OS: info(input.os),
  Platform: input.platform ?? null,
  Geo:
    input.geo === undefined
      ? null
      : Object.fromEntries(
          Object.entries({
            CountryISOCode: input.geo.countryISOCode,
            Country: input.geo.country,
            RegionISOCode: input.geo.regionISOCode,
            Region: input.geo.region,
            City: input.geo.city,
            Zip: input.geo.zip,
            Coords: input.geo.coords,
            IP: input.geo.ip,
          }).filter(([, v]) => v !== undefined),
        ),
});

const refusedAs400 = async <T>(record: () => Promise<T>): Promise<T> => {
  try {
    return await record();
  } catch (error) {
    if (error instanceof TrackingRefused) throw new ControlError(error.message);
    throw error;
  }
};

const eventReply = (e: { MessageID: string; Recipient: string; ReceivedAt: Date }) => ({
  MessageID: e.MessageID,
  Recipient: e.Recipient,
  ReceivedAt: formatTimestamp(e.ReceivedAt),
});

defineControl({
  method: "POST",
  path: "/control/events/delivery",
  handler: async (ctx) => {
    const input = controlInput(
      z.object({ ...target, details: z.string().default("smtp;250 2.0.0 OK") }),
      ctx.body,
    );
    const delivery = await refusedAs400(() => recordDelivery(ctx, input));
    return eventReply(delivery);
  },
});

defineControl({
  method: "POST",
  path: "/control/events/open",
  handler: async (ctx) => {
    const input = controlInput(
      z.object({ ...target, ...agentSchema, readSeconds: z.int().nonnegative().default(0) }),
      ctx.body,
    );
    const open = await refusedAs400(() => recordOpen(ctx, { ...input, agent: agent(input) }));
    return { ...eventReply(open), FirstOpen: open.FirstOpen };
  },
});

defineControl({
  method: "POST",
  path: "/control/events/click",
  handler: async (ctx) => {
    const input = controlInput(
      z.object({
        ...target,
        ...agentSchema,
        link: z.string(),
        clickLocation: z.enum(["HTML", "Text"]),
      }),
      ctx.body,
    );
    const click = await refusedAs400(() =>
      recordClick(ctx, { ...input, location: input.clickLocation, agent: agent(input) }),
    );
    return eventReply(click);
  },
});
