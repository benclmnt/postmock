import type { Server } from "../../state/types.ts";

/** The server object of `GET /server` and the Servers API, in doc field order (docs/06 §4.1). */
export const serverJson = (s: Server) => ({
  ID: s.ID,
  Name: s.Name,
  ApiTokens: s.ApiTokens,
  Color: s.Color,
  SmtpApiActivated: s.SmtpApiActivated,
  RawEmailEnabled: s.RawEmailEnabled,
  DeliveryType: s.DeliveryType,
  ServerLink: s.ServerLink,
  InboundAddress: s.InboundAddress,
  InboundHookUrl: s.InboundHookUrl,
  BounceHookUrl: s.BounceHookUrl,
  OpenHookUrl: s.OpenHookUrl,
  DeliveryHookUrl: s.DeliveryHookUrl,
  PostFirstOpenOnly: s.PostFirstOpenOnly,
  InboundDomain: s.InboundDomain,
  InboundHash: s.InboundHash,
  InboundSpamThreshold: s.InboundSpamThreshold,
  TrackOpens: s.TrackOpens,
  TrackLinks: s.TrackLinks,
  IncludeBounceContentInHook: s.IncludeBounceContentInHook,
  ClickHookUrl: s.ClickHookUrl,
  EnableSmtpApiErrorHooks: s.EnableSmtpApiErrorHooks,
});
