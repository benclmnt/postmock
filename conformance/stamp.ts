import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The postmock source a results file came from. */
export interface PostmockStamp {
  commit: string;
  dirty: boolean;
  /** Hash of the commit plus uncommitted changes. Baseline files do not count: they record results. */
  sourceHash: string;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const NOT_BASELINE = ":(glob,exclude)conformance/*/baseline/**";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer: 1 << 30 });

export function currentStamp(): PostmockStamp {
  const commit = git("rev-parse", "HEAD").toString().trim();
  const diff = git("diff", "HEAD", "--binary", "--", ".", NOT_BASELINE);
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z", "--", ".", NOT_BASELINE)
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256").update(commit).update(diff);
  for (const file of untracked) hash.update(file).update(readFileSync(`${root}/${file}`));
  return { commit, dirty: diff.length > 0 || untracked.length > 0, sourceHash: hash.digest("hex") };
}
