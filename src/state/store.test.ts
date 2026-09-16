import { describe, expect, it } from "vitest";
import { createServer } from "./servers.ts";
import { Store } from "./store.ts";

describe("Store IDs", () => {
  it("nextId skips fixed IDs a seed part claimed", () => {
    const store = new Store();
    expect(store.useId("server", 5)).toBe(5);
    expect(store.nextId("server")).toBe(6);
    expect(() => store.useId("server", 5)).toThrow("taken");
  });

  it("a part's fixed server ID does not depend on servers other parts created first", () => {
    const store = new Store();
    createServer(store, new Date());
    expect(createServer(store, new Date(), { ID: 7 }).ID).toBe(7);
  });

  it("reset frees every ID", () => {
    const store = new Store();
    store.nextId("bounce");
    store.reset();
    expect(store.nextId("bounce")).toBe(1);
  });
});

describe("createServer", () => {
  it("refuses a token another server holds, without case", () => {
    const store = new Store();
    createServer(store, new Date(), { ApiTokens: ["abc"] });
    expect(() => createServer(store, new Date(), { ApiTokens: ["ABC"] })).toThrow(
      "server 1 already holds token abc",
    );
    expect(store.state.servers.size).toBe(1);
  });
});
