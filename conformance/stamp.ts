import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The postmock source a results file came from. `commit` is for people; `sourceHash` decides. */
export interface PostmockStamp {
  commit: string;
  sourceHash: string;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });

/**
 * Files whose content decides a run's outcome: the server, the seeds, the shared runner code and the
 * test CA script, this SDK's runner folder without its baselines and skips, the dependency
 * manifests, and the toolchain flake.
 * Tracked and untracked files count; git-ignored files (`.work/`, results) do not.
 */
export function stampedFiles(sdk: string): string[] {
  const listed = git(
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    "src",
    "seeds",
    ":(glob)conformance/*.ts",
    "tools/test-ca.sh",
    "flake.nix",
    "flake.lock",
    `conformance/${sdk}`,
    "package.json",
    "pnpm-lock.yaml",
  );
  const runner = `conformance/${sdk}/`;
  return [...new Set(listed.split("\0"))]
    .filter(Boolean)
    .filter((f) => !f.startsWith(`${runner}baseline/`) && !f.startsWith(`${runner}skips/`))
    .filter((f) => existsSync(`${root}/${f}`))
    .sort();
}

export function currentStamp(sdk: string): PostmockStamp {
  const hash = createHash("sha256");
  for (const file of stampedFiles(sdk)) {
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(`${root}/${file}`))
      .update("\0");
  }
  return { commit: git("rev-parse", "HEAD").trim(), sourceHash: hash.digest("hex") };
}

/** The checked-out commit of `sdk/<sdk>`. A runner folder has the name of its `sdk/` folder. */
export function sdkCommit(sdk: string): string {
  const dir = `${root}/sdk/${sdk}`;
  if (!existsSync(dir)) throw new Error(`sdk/${sdk} is missing; run tools/fetch-sources.sh`);
  return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
}
