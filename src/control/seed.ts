import { existsSync, readdirSync } from "node:fs";
import { importAll } from "../discover.ts";
import type { Runtime } from "../runtime.ts";

/** A seed builds state that real Postmark could hold, directly in the store (CONTROL-API.md). */
export type Seed = (runtime: Runtime) => void | Promise<void>;

const SEEDS_DIR = new URL("../../seeds/", import.meta.url);

/**
 * A seed made of every part file in `dir`, applied in filename order. Each track adds its own part
 * file (docs/11 §5). A part uses fixed IDs (`store.useId`), so its IDs do not depend on other parts.
 */
export const seedFromDirectory =
  (dir: URL): Seed =>
  async (runtime) => {
    for (const part of (await importAll(dir)) as Array<{ default: Seed }>) {
      await part.default(runtime);
    }
  };

export const seedNames = (): string[] =>
  readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.slice(0, -3))
    .sort();

/** Loads `seeds/<name>.ts` and applies its default export. */
export async function applySeed(runtime: Runtime, name: string): Promise<void> {
  const file = new URL(`${name}.ts`, SEEDS_DIR);
  if (!/^[a-z0-9-]+$/.test(name) || !existsSync(file)) {
    throw new Error(`unknown seed '${name}'; seeds: ${seedNames().join(", ")}`);
  }
  const module = (await import(file.href)) as { default: Seed };
  await module.default(runtime);
}
