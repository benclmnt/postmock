import { describe, expect, it } from "vitest";
import { parseAddressList } from "./addresses.ts";

describe("parseAddressList (docs/03 §1.8)", () => {
  it("reads bare, named and quoted entries; a comma inside quotes does not split", () => {
    expect(
      parseAddressList(
        'a@example.com, John Doe <b@example.com>, "Joe Receiver, Jr." <c@example.com>',
      ),
    ).toEqual([
      { Email: "a@example.com", Name: null },
      { Email: "b@example.com", Name: "John Doe" },
      { Email: "c@example.com", Name: "Joe Receiver, Jr." },
    ]);
  });

  it("reads an empty list as no addresses", () => {
    expect(parseAddressList("")).toEqual([]);
  });

  it("refuses a malformed entry", () => {
    expect(parseAddressList("test")).toBeUndefined();
    expect(parseAddressList("a@example.com, <nope>")).toBeUndefined();
  });
});
