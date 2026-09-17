import { describe, expect, it } from "vitest";
import { isLocalAddress } from "./docker.ts";

describe("isLocalAddress", () => {
  it("is true for loopback and false for an address no host holds", async () => {
    expect(await isLocalAddress("127.0.0.1")).toBe(true);
    // RFC 5737 TEST-NET-1.
    expect(await isLocalAddress("192.0.2.1")).toBe(false);
  });
});
