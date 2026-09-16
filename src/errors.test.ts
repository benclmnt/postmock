import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ApiError, apiError, apiErrorOf, ERROR_TABLE, errorBody } from "./errors.ts";

// Parses the docs/02 §4.4 table: section rows `| **Family** |` and code rows `| code | HTTP | Meaning | cite |`.
function documentedRows() {
  const doc = readFileSync(new URL("../docs/02-transport-auth-errors.md", import.meta.url), "utf8");
  const section = doc.split("### 4.4 Error code table")[1]?.split("\n---")[0] ?? "";
  const rows: Array<{ family: string; code: number; statuses: number[]; message: string }> = [];
  let family = "";
  for (const line of section.split("\n")) {
    const heading = /^\| \*\*(.+?)\*\* \|/.exec(line);
    if (heading?.[1]) family = heading[1].split("—")[0]?.trim() ?? "";
    const row = /^\| (\d+) \| ([^|]+) \| (.+?) \| /.exec(line);
    if (row?.[1] && row[2] && row[3]) {
      rows.push({
        family,
        code: Number(row[1]),
        statuses: [...row[2].matchAll(/\d{3}/g)].map((m) => Number(m[0])),
        message: row[3].replaceAll("`", "'"),
      });
    }
  }
  return rows;
}

// Rows whose Message comes from an SDK test or a per-item doc example, not the table text.
const MESSAGE_OVERRIDES = new Set([406, 1235, 1406]);

describe("ERROR_TABLE", () => {
  const documented = documentedRows();

  it("has one entry per documented row, in doc order", () => {
    expect(documented.length).toBe(149);
    expect(ERROR_TABLE.map(([code, , statuses]) => [code, statuses])).toEqual(
      documented.map((r) => [r.code, r.statuses]),
    );
  });

  it("keeps each family's rows together", () => {
    const familyOf = new Map<string, string>();
    ERROR_TABLE.forEach(([, family], i) => {
      const docFamily = documented[i]?.family ?? "";
      expect(familyOf.get(docFamily) ?? family).toBe(family);
      familyOf.set(docFamily, family);
    });
    expect(new Set(familyOf.values()).size).toBe(familyOf.size);
  });

  it("uses the doc text as the message template", () => {
    ERROR_TABLE.forEach(([code, , , , text], i) => {
      if (!MESSAGE_OVERRIDES.has(code)) expect(text).toBe(documented[i]?.message);
    });
  });
});

describe("errorBody / apiError", () => {
  it("builds the envelope with the table status (docs/02 §4.1)", () => {
    const error = apiError(1235, { params: { stream: "unknown-stream" } });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.body).toEqual({
      ErrorCode: 1235,
      Message: "The stream provided: 'unknown-stream' does not exist on this server.",
    });
  });

  it("E4: the 406 message matches the postmark.js recipient regex", () => {
    const { Message } = errorBody(406, { params: { addresses: "a@example.com, b@example.com" } });
    const match = /Found inactive addresses: (.+?)\.? Inactive/.exec(Message);
    expect(match?.[1]?.split(",").map((s) => s.trim())).toEqual(["a@example.com", "b@example.com"]);
  });

  it("requires a family for a code listed twice", () => {
    expect(() => errorBody(614)).toThrow("needs a family");
    expect(errorBody(614, { family: "stats" }).Message).toContain("stats API");
  });

  it("requires a status for a code with several statuses", () => {
    const message = "Signature not found.";
    expect(() => apiError(501, { message })).toThrow("needs a status");
    expect(apiError(501, { message, status: 404 }).status).toBe(404);
    expect(() => apiError(501, { message, status: 400 })).toThrow("needs a status");
  });

  it("refuses an HTTP error for a code that only appears inside 200 bodies", () => {
    expect(() => apiError(1406)).toThrow("inside a 200 body");
    expect(errorBody(1406).ErrorCode).toBe(1406);
  });

  it("rejects missing, unused and unknown params", () => {
    expect(() => errorBody(406)).toThrow("missing message param 'addresses'");
    expect(() => errorBody(402, { params: { x: "1" } })).toThrow("unused message params: x");
    expect(() => errorBody(9999)).toThrow("not in docs/02");
  });

  it("needs the exact message for a summary row", () => {
    expect(() => apiError(300)).toThrow("summary row");
    const message = "Zero recipients specified";
    expect(apiError(300, { message }).body).toEqual({ ErrorCode: 300, Message: message });
  });

  it("uses a caller message verbatim, braces included (Mustachio text)", () => {
    const message = "Unexpected '{{name}' in template";
    expect(errorBody(1122, { message }).Message).toBe(message);
  });

  it("refuses extra keys that would replace ErrorCode or Message", () => {
    expect(() => apiError(402, { extra: { Message: "other" } })).toThrow(
      "extra may not set Message",
    );
    expect(() => apiError(402, { extra: { ErrorCode: 0 } })).toThrow("extra may not set ErrorCode");
  });

  it("merges extra keys (ErrorCode 11 Errors)", () => {
    const message = "Multiple errors occurred. Inspect the Errors property for more information.";
    const error = apiError(11, { message, extra: { Errors: { From: [] } } });
    expect(error.body.Errors).toEqual({ From: [] });
  });
});

describe("apiErrorOf", () => {
  it("answers a built body with the one status of its code, under any family", () => {
    const body = errorBody(614, { family: "senders", message: "Signature limit reached." });
    expect(apiErrorOf(body)).toMatchObject({ status: 422, body });
  });

  it("refuses a code with several statuses or only a 200 status", () => {
    expect(() => apiErrorOf({ ErrorCode: 501, Message: "Signature not found." })).toThrow(
      "ErrorCode 501 has no single HTTP status",
    );
    expect(() => apiErrorOf({ ErrorCode: 1406, Message: "x" })).toThrow(
      "ErrorCode 1406 has no single HTTP status",
    );
  });
});
