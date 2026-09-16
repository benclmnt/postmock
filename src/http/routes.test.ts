import { describe, expect, it } from "vitest";
import { type Method, RouteTable } from "./routes.ts";

const table = () => {
  const t = new RouteTable<{ method: Method; path: string; name: string }>();
  t.add({ method: "GET", path: "/deliverystats", name: "stats" });
  t.add({ method: "PUT", path: "/templates/:idOrAlias", name: "edit" });
  t.add({ method: "PUT", path: "/templates/push", name: "push" });
  t.add({ method: "GET", path: "/message-streams/:stream/suppressions/dump", name: "dump" });
  return t;
};

describe("R2 path matching", () => {
  it("matches literal segments without case", () => {
    expect(table().match("GET", "/deliveryStats")?.route.name).toBe("stats");
    expect(table().match("get", "/DELIVERYSTATS")?.route.name).toBe("stats");
  });

  it("ignores a trailing slash", () => {
    expect(table().match("GET", "/deliveryStats/")?.route.name).toBe("stats");
  });

  it("keeps param case and decodes it", () => {
    expect(table().match("GET", "/Message-Streams/My%20Stream/suppressions/dump")?.params).toEqual({
      stream: "My Stream",
    });
  });

  it("prefers a literal segment over a param (§2.5 templates/push)", () => {
    expect(table().match("PUT", "/templates/PUSH")?.route.name).toBe("push");
    expect(table().match("PUT", "/templates/welcome")?.route).toMatchObject({ name: "edit" });
  });

  it("does not match another method or length", () => {
    expect(table().match("POST", "/deliverystats")).toBeUndefined();
    expect(table().match("GET", "/deliverystats/x")).toBeUndefined();
  });

  it("rejects a duplicate pattern", () => {
    const t = table();
    expect(() => t.add({ method: "GET", path: "/DeliveryStats/", name: "dup" })).toThrow("clashes");
    expect(() => t.add({ method: "PUT", path: "/templates/:other", name: "dup" })).toThrow(
      "clashes",
    );
  });
});
