import { describe, expect, it } from "vitest";
import { ApiError } from "../../errors.ts";
import { sendResponse } from "./json.ts";

describe("sendResponse", () => {
  it("answers a rejection whose code is listed under two families (1226)", () => {
    const error = {
      ErrorCode: 1226,
      Message: "The message stream for the provided 'ID' was not found.",
    };
    const reply = (() => {
      try {
        sendResponse({ outcome: "rejected", error }, "");
      } catch (thrown) {
        return thrown;
      }
    })();
    expect(reply).toBeInstanceOf(ApiError);
    expect(reply).toMatchObject({ status: 422, body: error });
  });
});
