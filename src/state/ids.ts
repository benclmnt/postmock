import { randomBytes, randomUUID } from "node:crypto";

/** Postmark MessageID and bulk Id: a lowercase UUID (docs/08 E7). */
export const newMessageId = (): string => randomUUID();

/** A server or account token: a UUID, like the tokens Postmark issues. */
export const newToken = (): string => randomUUID();

/** Lowercase hex, for inbound hashes and SMTP token keys. */
export const newHex = (bytes: number): string => randomBytes(bytes).toString("hex");
