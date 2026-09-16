import { describe, expect, it } from "vitest";
import { addAccountToken, createServer } from "./servers.ts";
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

describe("Store IDs at scale and while seeding", () => {
  it("nextId stays correct past 200k used IDs", () => {
    const store = new Store();
    for (let id = 1; id <= 200_000; id++) store.useId("webhookAttempt", id);
    expect(store.nextId("webhookAttempt")).toBe(200_001);
  });

  it("refuses nextId inside a seed; seed parts claim fixed IDs", async () => {
    const store = new Store();
    await expect(store.seeding(async () => store.nextId("server"))).rejects.toThrow(
      "fixed ID while seeding",
    );
    await store.seeding(async () => store.useId("server", 1000));
    expect(store.nextId("server")).toBe(1001);
  });
});

describe("token uniqueness", () => {
  it("refuses a token twice within one server, without case", () => {
    expect(() => createServer(new Store(), new Date(), { ApiTokens: ["abc", "ABC"] })).toThrow(
      "token abc appears twice",
    );
  });

  it("refuses POSTMARK_API_TEST as a stored token", () => {
    expect(() =>
      createServer(new Store(), new Date(), { ApiTokens: ["postmark_api_test"] }),
    ).toThrow("POSTMARK_API_TEST");
    expect(() => addAccountToken(new Store(), "POSTMARK_API_TEST")).toThrow("POSTMARK_API_TEST");
  });

  it("refuses a duplicate account token, without case", () => {
    const store = new Store();
    addAccountToken(store, "acct");
    expect(() => addAccountToken(store, "ACCT")).toThrow("account token ACCT exists");
    expect(store.state.account.tokens).toEqual(["acct"]);
  });
});
