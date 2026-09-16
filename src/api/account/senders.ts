import { apiError } from "../../errors.ts";
import type { State } from "../../state/store.ts";
import type { SenderSignature } from "../../state/types.ts";
import { authenticationJson, isEmail, newAuthentication } from "./authentication.ts";
import { checkReturnPath } from "./domains.ts";
import { pathId } from "./paging.ts";

// Sender Signatures API (docs/06 §4.4; refs/api_signatures-api.md). Messages of summary rows are INFERRED.

export interface NewSender {
  FromEmail: string;
  Name: string;
  ReplyToEmail: string;
  ReturnPathDomain: string;
  ConfirmationPersonalNote: string;
}

export const emailDomain = (email: string): string => email.slice(email.lastIndexOf("@") + 1);

/** An unconfirmed signature with a pending DKIM key (refs/api_signatures-api.md:250-273). */
export const newSender = (id: number, s: NewSender, now: Date): SenderSignature => ({
  ID: id,
  Domain: emailDomain(s.FromEmail),
  EmailAddress: s.FromEmail,
  ReplyToEmailAddress: s.ReplyToEmail,
  Name: s.Name,
  Confirmed: false,
  ConfirmationPersonalNote: s.ConfirmationPersonalNote,
  ...newAuthentication(emailDomain(s.FromEmail), s.ReturnPathDomain, now),
});

/**
 * ErrorCode 501 for an unknown or non-numeric ID. The doc gives 422 or 404; 404 is INFERRED from the
 * postmark.js cleanup that tolerates a 404 on delete (sdk/postmark.js/test/integration/Signatures.test.ts:37-40).
 */
export function findSender(state: State, id: string): SenderSignature {
  const sender = state.senders.get(pathId(id) ?? -1);
  if (sender === undefined) throw apiError(501, { status: 404, message: "Signature not found." });
  return sender;
}

// Free mail domains cannot hold a signature (ErrorCode 503). The list is INFERRED.
const PUBLIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "aol.com",
  "icloud.com",
]);

export function checkFromEmail(state: State, email: string | undefined): string {
  if (email === undefined) throw apiError(520);
  if (email.length > 255) throw tooLong("FromEmail");
  if (!isEmail(email)) throw invalidEmail("FromEmail");
  if (PUBLIC_DOMAINS.has(emailDomain(email).toLowerCase())) throw apiError(503);
  const taken = [...state.senders.values()].some(
    (s) => s.EmailAddress.toLowerCase() === email.toLowerCase(),
  );
  if (taken) throw apiError(504, { message: "This signature already exists." });
  return email;
}

export function checkReplyTo(email: string): string {
  if (email.length > 255) throw tooLong("ReplyToEmail");
  if (!isEmail(email)) throw invalidEmail("ReplyToEmail");
  return email;
}

// The note has at most 400 characters (refs/api_signatures-api.md:202).
export function checkNote(note: string): string {
  if (note.length > 400) throw tooLong("ConfirmationPersonalNote");
  return note;
}

export const checkSenderReturnPath = (returnPath: string, email: string): string =>
  checkReturnPath(returnPath, emailDomain(email));

const tooLong = (field: string) => apiError(521, { message: `The '${field}' field is too long.` });
const invalidEmail = (field: string) =>
  apiError(522, { message: `The '${field}' field is not a valid email address.` });

// refs/api_signatures-api.md:107-129.
export const senderJson = (s: SenderSignature) => ({
  Domain: s.Domain,
  EmailAddress: s.EmailAddress,
  ReplyToEmailAddress: s.ReplyToEmailAddress,
  Name: s.Name,
  Confirmed: s.Confirmed,
  ...authenticationJson(s),
  ID: s.ID,
  ConfirmationPersonalNote: s.ConfirmationPersonalNote,
});

// refs/api_signatures-api.md:43-48.
export const senderListItemJson = (s: SenderSignature) => ({
  Domain: s.Domain,
  EmailAddress: s.EmailAddress,
  ReplyToEmailAddress: s.ReplyToEmailAddress,
  Name: s.Name,
  Confirmed: s.Confirmed,
  ID: s.ID,
});
