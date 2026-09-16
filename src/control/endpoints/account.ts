import { z } from "zod";
import { type Authentication, confirmDkim } from "../../api/account/authentication.ts";
import { domainJson } from "../../api/account/domains.ts";
import { pathId } from "../../api/account/paging.ts";
import { senderJson } from "../../api/account/senders.ts";
import { ControlError, controlInput, defineControl } from "../registry.ts";

// Account events postmock cannot observe: a support decision, DNS records, a click on a confirmation link.

defineControl({
  method: "POST",
  path: "/control/account/server-deletion",
  handler: ({ store, body }) => {
    const { enabled } = controlInput(z.object({ enabled: z.boolean() }), body);
    store.state.account.serverDeletionEnabled = enabled;
    return { serverDeletionEnabled: enabled };
  },
});

const verifyInput = z
  .object({ dkim: z.literal(true).optional(), returnPath: z.literal(true).optional() })
  .refine((v) => v.dkim || v.returnPath, "set dkim or returnPath to true");

/**
 * Postmark finds the DNS records: the pending DKIM key becomes active, the Return-Path CNAME
 * points to `pm.mtasv.net`. It never finds a record for a key or Return-Path that does not exist.
 */
function verify(auth: Authentication, body: unknown): void {
  const { dkim, returnPath } = controlInput(verifyInput, body);
  if (dkim && auth.DKIMUpdateStatus !== "Pending") throw new ControlError("no pending DKIM key");
  if (returnPath && auth.ReturnPathDomain === "") throw new ControlError("no ReturnPathDomain set");
  if (dkim) confirmDkim(auth);
  if (returnPath) auth.ReturnPathDomainVerified = true;
}

const found = <T>(item: T | undefined, what: string): T => {
  if (item === undefined) throw new ControlError(`${what} not found`);
  return item;
};

defineControl({
  method: "POST",
  path: "/control/domains/:id/verify",
  handler: ({ store, params, body }) => {
    const domain = found(store.state.domains.get(pathId(params.id as string) ?? -1), "domain");
    verify(domain, body);
    return domainJson(domain);
  },
});

defineControl({
  method: "POST",
  path: "/control/senders/:id/verify",
  handler: ({ store, params, body }) => {
    const sender = found(store.state.senders.get(pathId(params.id as string) ?? -1), "sender");
    verify(sender, body);
    return senderJson(sender);
  },
});

defineControl({
  method: "POST",
  path: "/control/senders/:id/confirm",
  handler: ({ store, params }) => {
    const sender = found(store.state.senders.get(pathId(params.id as string) ?? -1), "sender");
    if (sender.Confirmed) throw new ControlError("sender already confirmed");
    sender.Confirmed = true;
    return senderJson(sender);
  },
});
