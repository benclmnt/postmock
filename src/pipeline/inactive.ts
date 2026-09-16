import { type ErrorBody, errorBody } from "../errors.ts";

/** 406 for a single send: the SDK fixture text (docs/03 §3.2, docs/01 §4.1). */
export const inactiveRecipientsError = (addresses: readonly string[]): ErrorBody =>
  errorBody(406, { params: { addresses: addresses.join(", ") } });

// The gem regex (docs/01 §4.1): the strictest of the three SDK regexes.
const ADDRESSES = /Found inactive addresses: (.+?)\. Inactive/;

/**
 * A batch item carries its own 406 wording, with a trailing space (refs/api_email-api.md:301-313).
 * Other errors are the same as on a single send.
 */
export function batchItemError(error: ErrorBody): ErrorBody {
  if (error.ErrorCode !== 406) return error;
  const addresses = ADDRESSES.exec(error.Message)?.[1];
  if (addresses === undefined) throw new Error(`406 without an address list: ${error.Message}`);
  return {
    ErrorCode: 406,
    Message: `You tried to send to a recipient that has been marked as inactive. Found inactive addresses: ${addresses}. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression. `,
  };
}
