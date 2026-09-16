import { describe, expect, it } from "vitest";
import { stampedFiles } from "./stamp.ts";

describe("stampedFiles", () => {
  const files = stampedFiles("postmark.js");

  it("covers the server, seeds, shared runner code, this runner and dependencies", () => {
    for (const file of [
      "src/main.ts",
      "seeds/conformance.ts",
      "conformance/check.ts",
      "conformance/postmark.js/run.ts",
      "conformance/postmark.js/fetch-shim.cjs",
      "tools/test-ca.sh",
      "flake.lock",
      "package.json",
      "pnpm-lock.yaml",
    ]) {
      expect(files).toContain(file);
    }
  });

  it("leaves out docs, other runners, baselines and skips", () => {
    expect(
      files.filter((f) =>
        /^(README|docs\/|ARCHITECTURE|conformance\/[^/]+\/(baseline|skips)\/)/.test(f),
      ),
    ).toEqual([]);
    expect(files.every((f) => !f.includes("/.work/"))).toBe(true);
  });
});
