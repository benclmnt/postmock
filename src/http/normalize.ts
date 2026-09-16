import { z } from "zod";
import { apiError } from "../errors.ts";
import { easternWallTime } from "../time.ts";
import { Unsupported } from "./respond.ts";

// Request normalization: the accept rules of docs/08 §4.1. SDKs disagree on key case,
// boolean text and date shapes, so the server accepts every form an official SDK sends.

// Query names match without case and without underscores: SDKs send `fromEmail`, `fromemail`,
// `clientName` for the doc's `client_name` (docs/08 R3; docs/06 §1.1, INFERRED).
const foldQueryKey = (key: string): string => key.toLowerCase().replaceAll("_", "");

export class Query {
  private readonly values = new Map<string, string[]>();
  private readonly raw: URLSearchParams;

  constructor(params: URLSearchParams) {
    this.raw = params;
    for (const [key, value] of params) {
      // An empty `key=` is absent (docs/08 R4; gem and dotnet send them).
      if (value === "") continue;
      const folded = foldQueryKey(key);
      this.values.set(folded, [...(this.values.get(folded) ?? []), value]);
    }
  }

  /** The last value for `name`. */
  get(name: string): string | undefined {
    return this.values.get(foldQueryKey(name))?.at(-1);
  }

  /** Every value for `name`: postmark.js repeats a key for an array (docs/02 §2.6). */
  all(name: string): string[] {
    return this.values.get(foldQueryKey(name)) ?? [];
  }

  /** `metadata_<key>=value` pairs, prefix matched without case, key case kept (docs/08 R3). */
  prefixed(prefix: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of this.raw) {
      if (value !== "" && key.toLowerCase().startsWith(prefix.toLowerCase())) {
        out[key.slice(prefix.length)] = value;
      }
    }
    return out;
  }

  /** Parses the schema's keys (each read with `get`) with the schema. */
  pick<S extends z.ZodObject>(schema: S): z.ZodSafeParseResult<z.output<S>> {
    const input: Record<string, string> = {};
    for (const key of Object.keys(schema.shape)) {
      const value = this.get(key);
      if (value !== undefined) input[key] = value;
    }
    return schema.safeParse(input);
  }
}

/** `true`/`True`/`1` and the false forms (docs/08 R4). */
export const queryBool = z.string().transform((value, ctx) => {
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  ctx.issues.push({ code: "custom", message: `not a boolean: ${value}`, input: value });
  return z.NEVER;
});

export const queryInt = z
  .string()
  .regex(/^-?\d+$/)
  .transform(Number);

export interface QueryDate {
  instant: Date;
  /** True for `YYYY-MM-DD`; an inclusive `todate` then covers the whole day. */
  dateOnly: boolean;
}

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)? ?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS`, and `...SS.fffffff` (docs/08 R5). A zoneless value is US
 * Eastern time (docs/02 §7.1). postmark.js sends `Date#toISOString()`, which carries `Z`.
 */
export function parseQueryDate(value: string): QueryDate | undefined {
  const m = DATE_RE.exec(value);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const n = (x: string | undefined) => Number(x ?? 0);
  // Date.UTC rolls 2024-13-45 over into 2025; a field out of range is no date.
  const probe = new Date(Date.UTC(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s)));
  if (
    probe.getUTCFullYear() !== n(y) ||
    probe.getUTCMonth() !== n(mo) - 1 ||
    probe.getUTCDate() !== n(d) ||
    probe.getUTCHours() !== n(h) ||
    probe.getUTCMinutes() !== n(mi) ||
    probe.getUTCSeconds() !== n(s)
  ) {
    return undefined;
  }
  const ms = Math.floor(Number(`0.${frac ?? 0}`) * 1000);
  if (h === undefined) return { instant: easternWallTime(n(y), n(mo), n(d)), dateOnly: true };
  if (zone === undefined) {
    return { instant: easternWallTime(n(y), n(mo), n(d), n(h), n(mi), n(s), ms), dateOnly: false };
  }
  const utc = Date.UTC(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s), ms);
  const offset =
    zone === "Z"
      ? 0
      : (zone.startsWith("-") ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
  return { instant: new Date(utc - offset * 60000), dateOnly: false };
}

export const queryDate = z.string().transform((value, ctx) => {
  const parsed = parseQueryDate(value);
  if (parsed) return parsed;
  ctx.issues.push({ code: "custom", message: `not a date: ${value}`, input: value });
  return z.NEVER;
});

/**
 * The request body as JSON. Bytes decode as UTF-8 whatever the charset (docs/08 R13).
 * Empty, whitespace or the literal `null` is absent, with or without Content-Type (docs/08 R7).
 * Malformed JSON is ErrorCode 402 (docs/02 §7).
 */
export function decodeJsonBody(bytes: ArrayBuffer): unknown {
  const text = new TextDecoder("utf-8").decode(bytes).trim();
  if (text === "") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw apiError(402);
  }
  return value === null ? undefined : value;
}

type Def = { type: string } & Record<string, unknown>;
const defOf = (schema: unknown): Def => (schema as { _zod: { def: Def } })._zod.def;
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Renames body keys to the schema's spelling, matched without case, at every object level the
 * schema describes: `HTMLBody`, `htmlBody` → `HtmlBody`; `ReturnPathDOmain` → `ReturnPathDomain`
 * (docs/08 R8). Record keys (Metadata) keep their case. Unknown keys pass through; zod strips them
 * (docs/08 R12).
 */
export function canonicalizeKeys(schema: unknown, value: unknown): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case "object": {
      if (!isPlainObject(value)) return value;
      const shape = def.shape as Record<string, unknown>;
      const byFolded = new Map(Object.keys(shape).map((k) => [k.toLowerCase(), k]));
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const canonical = byFolded.get(key.toLowerCase());
        const target = canonical ?? key;
        // Postmark's answer is not captured; answer 501, not a guess (AGENTS.md rule 5).
        if (target in out) throw new Unsupported(`body has two spellings of key '${target}'`);
        out[target] = canonical === undefined ? item : canonicalizeKeys(shape[canonical], item);
      }
      return out;
    }
    case "array":
      return Array.isArray(value) ? value.map((v) => canonicalizeKeys(def.element, v)) : value;
    case "record":
      return isPlainObject(value)
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, canonicalizeKeys(def.valueType, v)]),
          )
        : value;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
    case "nonoptional":
      return canonicalizeKeys(def.innerType, value);
    case "pipe":
      return canonicalizeKeys(defOf(def.in).type === "transform" ? def.out : def.in, value);
    case "union":
      return (def.options as unknown[]).reduce((v, option) => canonicalizeKeys(option, v), value);
    case "intersection":
      return canonicalizeKeys(def.right, canonicalizeKeys(def.left, value));
    case "tuple": {
      if (!Array.isArray(value)) return value;
      const items = def.items as unknown[];
      return value.map((v, i) => {
        const item = i < items.length ? items[i] : def.rest;
        return item === undefined || item === null ? v : canonicalizeKeys(item, v);
      });
    }
    case "lazy":
      return canonicalizeKeys((def.getter as () => unknown)(), value);
    default:
      return value;
  }
}

/** Parses a JSON body with key case folding (docs/08 R8). The route maps issues to ErrorCodes. */
export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
): z.ZodSafeParseResult<z.output<S>> {
  return schema.safeParse(canonicalizeKeys(schema, body));
}

/** An optional scalar where `null` and `""` mean absent (docs/08 R9). */
export const absent = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (v === null || v === "" ? undefined : v), schema.optional());

/** An integer sent as a number or a numeric string (docs/08 R10: cli `TemplateId`, py server IDs). */
export const intLike = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/)
    .transform(Number),
]);

/** An object that PHP serializes as `[]` when empty (docs/08 R10: `TemplateModel: []`). */
export const objectOrEmptyArray = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (Array.isArray(v) && v.length === 0 ? {} : v), schema);

/** Base64 content; line breaks inside are allowed (docs/08 R11: the gem wraps every 60 chars). */
export const base64 = z.string().transform((value, ctx) => {
  const compact = value.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/]*={0,2}$/.test(compact) && compact.length % 4 === 0) {
    return Buffer.from(compact, "base64");
  }
  ctx.issues.push({ code: "custom", message: "not base64", input: value });
  return z.NEVER;
});
