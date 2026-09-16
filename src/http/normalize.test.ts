import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "../errors.ts";
import {
  absent,
  base64,
  decodeJsonBody,
  inclusiveUpperBound,
  intLike,
  objectOrEmptyArray,
  parseBody,
  parseQueryDate,
  Query,
  type QueryDate,
  queryBool,
  queryDate,
  queryInt,
} from "./normalize.ts";
import { Unsupported } from "./respond.ts";

const query = (qs: string) => new Query(new URLSearchParams(qs));
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("R3 query keys", () => {
  it("match without case and without underscores", () => {
    expect(query("fromEmail=a@x.com").get("fromemail")).toBe("a@x.com");
    expect(query("EmailAddress=a@x.com").get("emailAddress")).toBe("a@x.com");
    expect(query("clientName=Gmail").get("client_name")).toBe("Gmail");
  });

  it("collect metadata_ prefixed keys, keeping key case", () => {
    expect(query("Metadata_Color=blue&metadata_size=L&tag=x").prefixed("metadata_")).toEqual({
      Color: "blue",
      size: "L",
    });
  });

  it("keep repeated keys", () => {
    expect(query("tag=a&tag=b").all("TAG")).toEqual(["a", "b"]);
    expect(query("tag=a&tag=b").get("tag")).toBe("b");
  });

  it("pick reads the schema keys and ignores others", () => {
    const schema = z.object({ count: queryInt, offset: queryInt });
    expect(query("Count=10&offset=0&unknown=1").pick(schema)).toMatchObject({
      success: true,
      data: { count: 10, offset: 0 },
    });
  });
});

describe("R4 query booleans", () => {
  const schema = z.object({ inactive: queryBool.optional() });
  it.each([
    ["true", true],
    ["True", true],
    ["1", true],
    ["false", false],
    ["False", false],
    ["0", false],
  ])("reads %s", (text, value) => {
    expect(query(`inactive=${text}`).pick(schema).data).toEqual({ inactive: value });
  });

  it("treats an empty value as absent", () => {
    expect(query("inactive=").pick(schema).data).toEqual({});
  });

  it("rejects other text", () => {
    expect(query("inactive=yes").pick(schema).success).toBe(false);
  });
});

describe("R5 query dates", () => {
  it("reads a date as Eastern midnight", () => {
    expect(parseQueryDate("2020-02-01")).toEqual({
      instant: new Date("2020-02-01T05:00:00Z"),
      dateOnly: true,
    });
  });

  it("reads a zoneless date-time as Eastern time", () => {
    expect(parseQueryDate("2021-07-01T12:00:00")?.instant).toEqual(
      new Date("2021-07-01T16:00:00Z"),
    );
  });

  it("reads 7 fraction digits (dotnet `O` without zone)", () => {
    expect(parseQueryDate("2020-02-01T00:00:00.0000000")?.instant).toEqual(
      new Date("2020-02-01T05:00:00Z"),
    );
  });

  it("reads a zoned value (postmark.js toISOString)", () => {
    expect(parseQueryDate("2020-02-01T10:00:00.000Z")?.instant).toEqual(
      new Date("2020-02-01T10:00:00Z"),
    );
    expect(parseQueryDate("2020-02-01T10:00:00-05:00")?.instant).toEqual(
      new Date("2020-02-01T15:00:00Z"),
    );
  });

  it.each([
    "2024-01-01T00:00:00+99:99",
    "2024-01-01T00:00:00-12:60",
    "2024-13-01",
    "2024-02-30",
    "2024-01-01T24:00:00",
    "2024-01-01T10:60:00",
  ])("rejects the impossible date %s", (text) => {
    expect(parseQueryDate(text)).toBeUndefined();
  });

  it("rejects other text through the zod codec", () => {
    expect(queryDate.safeParse("yesterday").success).toBe(false);
  });

  it("ends an inclusive date-only todate at the next Eastern midnight, also on DST days", () => {
    const end = (text: string) => inclusiveUpperBound(parseQueryDate(text) as QueryDate);
    expect(end("2020-02-01")).toEqual(new Date("2020-02-02T05:00:00Z"));
    expect(end("2024-03-10")).toEqual(new Date("2024-03-11T04:00:00Z"));
    expect(end("2024-11-03")).toEqual(new Date("2024-11-04T05:00:00Z"));
    expect(end("2020-02-01T10:00:00Z")).toEqual(new Date("2020-02-01T10:00:00.001Z"));
  });
});

describe("R7 body", () => {
  it.each(["", "  ", "null"])("reads %j as absent", (text) => {
    expect(decodeJsonBody(bytes(text))).toBeUndefined();
  });

  it("reads {}", () => {
    expect(decodeJsonBody(bytes("{}"))).toEqual({});
  });

  it("answers malformed JSON with ErrorCode 402", () => {
    expect(() => decodeJsonBody(bytes("{nope"))).toThrow(ApiError);
    try {
      decodeJsonBody(bytes("{nope"));
    } catch (error) {
      expect((error as ApiError).body.ErrorCode).toBe(402);
    }
  });
});

describe("R8 body key case", () => {
  const schema = z.object({
    HtmlBody: z.string(),
    ReturnPathDomain: z.string().optional(),
    Attachments: z.array(z.object({ ContentID: z.string().nullable() })).optional(),
    Metadata: z.record(z.string(), z.string()).optional(),
    Model: objectOrEmptyArray(z.object({ Name: z.string() }).partial()),
  });

  it("renames keys at every schema level, not record keys", () => {
    const result = parseBody(schema, {
      HTMLBody: "<b>x</b>",
      ReturnPathDOmain: "pm.example.com",
      attachments: [{ ContentId: null }],
      metadata: { OrderID: "1" },
      model: { name: "n" },
    });
    expect(result.data).toEqual({
      HtmlBody: "<b>x</b>",
      ReturnPathDomain: "pm.example.com",
      Attachments: [{ ContentID: null }],
      Metadata: { OrderID: "1" },
      Model: { Name: "n" },
    });
  });

  it("R12: drops unknown keys", () => {
    expect(parseBody(schema, { htmlBody: "x", New: true, Model: {} }).data).toEqual({
      HtmlBody: "x",
      Model: {},
    });
  });

  it("answers two spellings of one key as Unsupported (not captured)", () => {
    expect(() => parseBody(schema, { HtmlBody: "a", htmlbody: "b" })).toThrow(Unsupported);
  });

  it("renames keys inside intersections and tuples", () => {
    const joined = z.intersection(
      z.object({ HtmlBody: z.string() }),
      z.object({ TextBody: z.string() }),
    );
    expect(parseBody(joined, { htmlbody: "a", TEXTBODY: "b" }).data).toEqual({
      HtmlBody: "a",
      TextBody: "b",
    });
    const pair = z.tuple([z.object({ Name: z.string() })], z.object({ Value: z.string() }));
    expect(parseBody(pair, [{ name: "n" }, { value: "v" }]).data).toEqual([
      { Name: "n" },
      { Value: "v" },
    ]);
  });
});

describe("R9–R11 value codecs", () => {
  it("R9: null and empty string are absent", () => {
    const schema = z.object({ TrackLinks: absent(z.enum(["None", "HtmlOnly"])) });
    expect(parseBody(schema, { TrackLinks: "" }).data).toEqual({});
    expect(parseBody(schema, { TrackLinks: null }).data).toEqual({});
    expect(parseBody(schema, { TrackLinks: "HtmlOnly" }).data).toEqual({ TrackLinks: "HtmlOnly" });
  });

  it("R10: integers as numbers or numeric strings; [] as an empty object", () => {
    expect(intLike.parse("42")).toBe(42);
    expect(intLike.parse(42)).toBe(42);
    expect(intLike.safeParse("4x").success).toBe(false);
    expect(objectOrEmptyArray(z.object({})).parse([])).toEqual({});
  });

  it("R11: base64 with line breaks", () => {
    expect(base64.parse("aGVs\nbG8g\r\nd29y\nbGQ=").toString()).toBe("hello world");
    expect(base64.safeParse("not base64!").success).toBe(false);
  });
});

describe("R13 JSON forms", () => {
  it("reads indented JSON, \\u escapes, \\/ and UTF-8 without charset", () => {
    const text = '{\n  "Subject": "Caf\\u00e9 \\/ ✓",\n  "From": "Tëst <a@example.com>"\n}';
    expect(decodeJsonBody(bytes(text))).toEqual({
      Subject: "Café / ✓",
      From: "Tëst <a@example.com>",
    });
  });
});
