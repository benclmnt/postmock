import { existsSync, readdirSync } from "node:fs";
import type { Runtime } from "../runtime.ts";

/** A seed builds state that real Postmark could hold, directly in the store (CONTROL-API.md). */
export type Seed = (runtime: Runtime) => void;

const SEEDS_DIR = new URL("../../seeds/", import.meta.url);
const parts = new Map<string, Seed[]>();

/**
 * Adds a part to a composed seed. `seeds/<name>.ts` imports each part file once, so a track adds
 * its own file and one import line (docs/11 §5). A part that needs another part imports it.
 */
export function defineSeedPart(seedName: string, part: Seed): void {
  parts.set(seedName, [...(parts.get(seedName) ?? []), part]);
}

/** The seed made of every part registered under `seedName`, in import order. */
export const seedFromParts =
  (seedName: string): Seed =>
  (runtime) => {
    for (const part of parts.get(seedName) ?? []) part(runtime);
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
  module.default(runtime);
}
