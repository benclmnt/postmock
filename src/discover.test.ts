import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { seedFromDirectory } from "./control/seed.ts";
import { importAll } from "./discover.ts";
import { createRuntime } from "./runtime.ts";

function fixture(files: Record<string, string>): URL {
  const dir = mkdtempSync(join(tmpdir(), "postmock-discover-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return pathToFileURL(`${dir}/`);
}

describe("importAll", () => {
  it("imports .ts files in filename order, skipping tests and dotfiles (AppleDouble ._*)", async () => {
    const dir = fixture({
      "b.ts": "export const name = 'b';",
      "a.ts": "export const name = 'a';",
      "a.test.ts": "throw new Error('test file imported');",
      "._a.ts": "not typescript {{{",
      ".hidden.ts": "throw new Error('dotfile imported');",
    });
    const found = (await importAll(dir)) as Array<{ module: { name: string } }>;
    expect(found.map((f) => f.module.name)).toEqual(["a", "b"]);
  });

  it("throws for a group folder without the expected file", async () => {
    const dir = fixture({ "server/routes.ts": "export {};", "templates/route.ts": "export {};" });
    await expect(importAll(dir, "routes.ts")).rejects.toThrow("templates has no routes.ts");
  });

  it("ignores dot folders in group mode", async () => {
    const dir = fixture({ "server/routes.ts": "export {};", ".cache/x": "" });
    expect(await importAll(dir, "routes.ts")).toHaveLength(1);
  });
});

describe("seedFromDirectory", () => {
  it("names a part file without a default export", async () => {
    const dir = fixture({ "10-part.ts": "export const seed = () => {};" });
    await expect(seedFromDirectory(dir)(createRuntime())).rejects.toThrow(
      /10-part\.ts has no default export function/,
    );
  });
});
