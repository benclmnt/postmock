import type { Address } from "../state/types.ts";

/**
 * Splits a Postmark address list: commas outside double quotes separate entries; each entry is
 * `addr` or `[name] <addr>` (docs/03 §1.8, INFERRED). Returns undefined for a malformed entry.
 */
export function parseAddressList(raw: string): Address[] | undefined {
  const entries: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of raw) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      entries.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  entries.push(current);
  const addresses: Address[] = [];
  for (const entry of entries.map((e) => e.trim())) {
    if (entry === "") continue;
    const named = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(entry);
    if (named?.[2] !== undefined) {
      const name = (named[1] ?? "").replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');
      addresses.push({ Email: named[2], Name: name === "" ? null : name });
    } else if (/^[^<>\s"]+@[^<>\s"]+$/.test(entry)) {
      addresses.push({ Email: entry, Name: null });
    } else {
      return undefined;
    }
  }
  return addresses;
}
