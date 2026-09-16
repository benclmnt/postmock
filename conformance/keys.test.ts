import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFORMANCE } from "../seeds/lib/conformance.ts";
import { applySeed } from "../src/control/seed.ts";
import { createRuntime } from "../src/runtime.ts";

const root = new URL("./", import.meta.url);
const runners = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/testing_keys.json`, root)))
  .map((d) => d.name);

describe("runner keys", () => {
  it.each(runners)(
    "%s configures only tokens and addresses the conformance seed holds",
    async (sdk) => {
      const runtime = createRuntime();
      await applySeed(runtime, "conformance");
      const { account, servers } = runtime.store.state;
      const tokens = [...account.tokens, ...[...servers.values()].flatMap((s) => s.ApiTokens)];
      const keys = JSON.parse(
        readFileSync(new URL(`${sdk}/testing_keys.json`, root), "utf8"),
      ) as Record<string, string>;
      for (const [name, value] of Object.entries(keys)) {
        if (/TOKEN|_KEY$/.test(name)) expect(tokens, name).toContain(value);
        if (value.includes("@")) expect(value.split("@")[1], name).toBe(CONFORMANCE.domain);
      }
    },
  );
});
