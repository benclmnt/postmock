import { randomBytes, randomUUID } from "node:crypto";

/** Postmark MessageID and bulk Id: a UUID (docs/08 E7). Lowercase hex as in doc examples (INFERRED). */
export const newMessageId = (): string => randomUUID();

/** A server or account token. The UUID shape matches no documented format (INFERRED). */
export const newToken = (): string => randomUUID();

/** Lowercase hex, for inbound hashes and SMTP token keys. */
export const newHex = (bytes: number): string => randomBytes(bytes).toString("hex");
