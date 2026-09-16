import type { Store } from "../state/store.ts";
import type { SmtpFault } from "../state/types.ts";

/**
 * An SMTP error reply. `smtp-server` sends `responseCode` and the message, and adds the enhanced
 * status code itself. A 421 closes the connection.
 */
export class SmtpReply extends Error {
  readonly responseCode: number;

  constructor(responseCode: number, message: string) {
    super(message);
    this.responseCode = responseCode;
  }
}

/** Reply code for behavior postmock does not know yet; the SMTP twin of REST 501 `Unsupported`. */
export const UNSUPPORTED_CODE = 502;

/** Consumes one armed fault for the stage and throws its reply. */
export function takeFault(store: Store, stage: SmtpFault["stage"]): void {
  const faults = store.state.smtpFaults;
  const fault = faults.find((f) => f.stage === stage);
  if (fault === undefined) return;
  fault.remaining -= 1;
  if (fault.remaining === 0) faults.splice(faults.indexOf(fault), 1);
  throw new SmtpReply(fault.code, fault.message);
}
