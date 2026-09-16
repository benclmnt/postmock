import { z } from "zod";
import { apiError } from "../../errors.ts";
import { absent, parseBody } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import { defineRoute } from "../../http/routes.ts";
import { createServer } from "../../state/servers.ts";
import { serverJson } from "../server/json.ts";
import { refuseWhileRenewing, rotateDkim, setReturnPath, verifySpf } from "./authentication.ts";
import {
  checkDomainName,
  checkReturnPath,
  domainDkimJson,
  domainJson,
  domainListItemJson,
  domainSpfJson,
  findDomain,
  newDomain,
} from "./domains.ts";
import { accountPage, byId } from "./paging.ts";
import { pushTemplates } from "./push.ts";
import {
  checkFromEmail,
  checkNote,
  checkReplyTo,
  checkSenderReturnPath,
  findSender,
  newSender,
  senderJson,
  senderListItemJson,
} from "./senders.ts";
import { definedSettings, deleteServer, findServer, parseServerInput } from "./servers.ts";

// The account-token API: servers, domains, sender signatures, template push (docs/06 §3.4, §4.2–4.4).

// A body that is no JSON object, or a field of the wrong JSON type, has no documented ErrorCode.
function parseAccountBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = parseBody(schema, body ?? {});
  if (!parsed.success) {
    throw new Unsupported(`${z.prettifyError(parsed.error)}: Postmark's answer is not captured`);
  }
  return parsed.data;
}

// Servers (refs/api_servers-api.md).

defineRoute({
  method: "GET",
  path: "/servers",
  auth: "account",
  handler: ({ store, query }) => {
    // "a string search" (refs/api_servers-api.md:385); case-insensitive is INFERRED.
    const name = query.get("name")?.toLowerCase();
    const servers = byId(store.state.servers.values()).filter(
      (s) => name === undefined || s.Name.toLowerCase().includes(name),
    );
    return accountPage(query, "Servers", servers.map(serverJson), 600);
  },
});

defineRoute({
  method: "GET",
  path: "/servers/:id",
  auth: "account",
  handler: ({ store, params }) => serverJson(findServer(store.state, params.id as string)),
});

defineRoute({
  method: "POST",
  path: "/servers",
  auth: "account",
  handler: ({ store, clock, body }) => {
    const input = parseServerInput(store.state, body, null);
    if (input.Name === undefined) throw apiError(608, { message: "A server name is required." });
    return serverJson(createServer(store, clock.now(), definedSettings(input)));
  },
});

defineRoute({
  method: "PUT",
  path: "/servers/:id",
  auth: "account",
  handler: ({ store, params, body }) => {
    const server = findServer(store.state, params.id as string);
    const input = parseServerInput(store.state, body, server);
    // DeliveryType is fixed at create (refs/api_servers-api.md:38).
    if (input.DeliveryType !== undefined && input.DeliveryType !== server.DeliveryType) {
      throw new Unsupported("a DeliveryType change: Postmark's answer is not captured");
    }
    Object.assign(server, definedSettings(input));
    return serverJson(server);
  },
});

defineRoute({
  method: "DELETE",
  path: "/servers/:id",
  auth: "account",
  handler: ({ store, params }) => {
    if (!store.state.account.serverDeletionEnabled) throw apiError(604);
    const server = findServer(store.state, params.id as string);
    deleteServer(store.state, server);
    // refs/api_servers-api.md:520.
    return { ErrorCode: 0, Message: `Server ${server.Name} removed.` };
  },
});

// Domains (refs/api_domains-api.md).

defineRoute({
  method: "GET",
  path: "/domains",
  auth: "account",
  handler: ({ store, query }) =>
    accountPage(query, "Domains", byId(store.state.domains.values()).map(domainListItemJson), 500),
});

defineRoute({
  method: "GET",
  path: "/domains/:id",
  auth: "account",
  handler: ({ store, params }) => domainJson(findDomain(store.state, params.id as string)),
});

const createDomainSchema = z.object({
  Name: absent(z.string()),
  ReturnPathDomain: absent(z.string()),
});

defineRoute({
  method: "POST",
  path: "/domains",
  auth: "account",
  handler: ({ store, clock, body }) => {
    const input = parseAccountBody(createDomainSchema, body);
    const name = checkDomainName(store.state, input.Name);
    const returnPath = checkReturnPath(input.ReturnPathDomain ?? "", name);
    const domain = newDomain(store.nextId("domain"), name, returnPath, clock.now());
    store.state.domains.set(domain.ID, domain);
    return domainJson(domain);
  },
});

// `""` clears the Return-Path, unlike docs/08 R9: dotnet sends `""` for "clear"
// (sdk/postmark-dotnet/src/Postmark/PostmarkAdminClient.cs:345). `null` keeps it.
const returnPathEdit = z.string().nullable().optional();

defineRoute({
  method: "PUT",
  path: "/domains/:id",
  auth: "account",
  handler: ({ store, params, body }) => {
    const domain = findDomain(store.state, params.id as string);
    const input = parseAccountBody(z.object({ ReturnPathDomain: returnPathEdit }), body);
    if (typeof input.ReturnPathDomain === "string") {
      setReturnPath(domain, checkReturnPath(input.ReturnPathDomain, domain.Name));
    }
    return domainJson(domain);
  },
});

defineRoute({
  method: "DELETE",
  path: "/domains/:id",
  auth: "account",
  handler: ({ store, params }) => {
    const domain = findDomain(store.state, params.id as string);
    store.state.domains.delete(domain.ID);
    // refs/api_domains-api.md:377.
    return { ErrorCode: 0, Message: `Domain ${domain.Name} removed.` };
  },
});

// Verification reads the state the control API sets (`POST /control/domains/:id/verify`): postmock
// has no DNS to look at.
for (const path of ["/domains/:id/verifyDkim", "/domains/:id/verifyReturnPath"]) {
  defineRoute({
    method: "PUT",
    path,
    auth: "account",
    handler: ({ store, params }) => domainJson(findDomain(store.state, params.id as string)),
  });
}

defineRoute({
  method: "POST",
  path: "/domains/:id/verifyspf",
  auth: "account",
  handler: ({ store, params }) => {
    const domain = findDomain(store.state, params.id as string);
    verifySpf(domain);
    return domainSpfJson(domain);
  },
});

defineRoute({
  method: "POST",
  path: "/domains/:id/rotatedkim",
  auth: "account",
  handler: ({ store, clock, params }) => {
    const domain = findDomain(store.state, params.id as string);
    rotateDkim(domain, domain.Name, clock.now());
    return domainDkimJson(domain);
  },
});

// Sender signatures (refs/api_signatures-api.md).

defineRoute({
  method: "GET",
  path: "/senders",
  auth: "account",
  handler: ({ store, query }) =>
    accountPage(
      query,
      "SenderSignatures",
      byId(store.state.senders.values()).map(senderListItemJson),
      500,
    ),
});

defineRoute({
  method: "GET",
  path: "/senders/:id",
  auth: "account",
  handler: ({ store, params }) => senderJson(findSender(store.state, params.id as string)),
});

const senderSchema = z.object({
  FromEmail: absent(z.string()),
  Name: absent(z.string()),
  ReplyToEmail: absent(z.string()),
  ReturnPathDomain: returnPathEdit,
  ConfirmationPersonalNote: absent(z.string()),
});

defineRoute({
  method: "POST",
  path: "/senders",
  auth: "account",
  handler: ({ store, clock, body }) => {
    if (body === undefined) throw apiError(502);
    const input = parseAccountBody(senderSchema, body);
    const email = checkFromEmail(store.state, input.FromEmail);
    // Name is required (refs/api_signatures-api.md:199); no ErrorCode names it.
    if (input.Name === undefined) {
      throw new Unsupported("a signature without Name: Postmark's answer is not captured");
    }
    const sender = newSender(
      store.nextId("sender"),
      {
        FromEmail: email,
        Name: input.Name,
        ReplyToEmail: input.ReplyToEmail === undefined ? "" : checkReplyTo(input.ReplyToEmail),
        ReturnPathDomain: checkSenderReturnPath(input.ReturnPathDomain ?? "", email),
        ConfirmationPersonalNote: checkNote(input.ConfirmationPersonalNote ?? ""),
      },
      clock.now(),
    );
    store.state.senders.set(sender.ID, sender);
    return senderJson(sender);
  },
});

// Every field is optional on edit: the dotnet live test edits only the Return-Path
// (sdk/postmark-dotnet/src/Postmark.Tests/AdminClientSenderSignatureTests.cs:141).
defineRoute({
  method: "PUT",
  path: "/senders/:id",
  auth: "account",
  handler: ({ store, params, body }) => {
    const sender = findSender(store.state, params.id as string);
    if (body === undefined) throw apiError(502);
    const input = parseAccountBody(senderSchema.omit({ FromEmail: true }), body);
    // Check every field before the first change: a rejected edit changes nothing.
    const replyTo = input.ReplyToEmail === undefined ? undefined : checkReplyTo(input.ReplyToEmail);
    const returnPath =
      typeof input.ReturnPathDomain === "string"
        ? checkSenderReturnPath(input.ReturnPathDomain, sender.EmailAddress)
        : undefined;
    const note =
      input.ConfirmationPersonalNote === undefined
        ? undefined
        : checkNote(input.ConfirmationPersonalNote);
    if (input.Name !== undefined) sender.Name = input.Name;
    if (replyTo !== undefined) sender.ReplyToEmailAddress = replyTo;
    if (returnPath !== undefined) setReturnPath(sender, returnPath);
    if (note !== undefined) sender.ConfirmationPersonalNote = note;
    return senderJson(sender);
  },
});

defineRoute({
  method: "DELETE",
  path: "/senders/:id",
  auth: "account",
  handler: ({ store, params }) => {
    const sender = findSender(store.state, params.id as string);
    store.state.senders.delete(sender.ID);
    // refs/api_signatures-api.md:424.
    return { ErrorCode: 0, Message: `Signature ${sender.EmailAddress} removed.` };
  },
});

defineRoute({
  method: "POST",
  path: "/senders/:id/resend",
  auth: "account",
  handler: ({ store, params }) => {
    const sender = findSender(store.state, params.id as string);
    if (sender.Confirmed) throw apiError(506);
    // refs/api_signatures-api.md:466.
    return {
      ErrorCode: 0,
      Message: `Confirmation email for Sender Signature ${sender.EmailAddress} was re-sent.`,
    };
  },
});

defineRoute({
  method: "POST",
  path: "/senders/:id/verifyspf",
  auth: "account",
  handler: ({ store, params }) => {
    const sender = findSender(store.state, params.id as string);
    verifySpf(sender);
    return senderJson(sender);
  },
});

defineRoute({
  method: "POST",
  path: "/senders/:id/requestnewdkim",
  auth: "account",
  handler: ({ store, params }) => {
    const sender = findSender(store.state, params.id as string);
    refuseWhileRenewing(sender);
    // The doc shows only the 505 body; dotnet reads {ErrorCode, Message}, postmark.js a signature.
    throw new Unsupported("the requestnewdkim success body is not captured");
  },
});

// Template push (refs/api_templates-api.md:353-430). A literal `push` beats T3's `:idOrAlias`.
defineRoute({
  method: "PUT",
  path: "/templates/push",
  auth: "account",
  handler: ({ store, body }) => pushTemplates(store, body),
});
