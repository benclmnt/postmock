#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [patch|minor|major]\n' "$0" >&2
}

bump="${1:-patch}"
if [[ $# -gt 1 ]] || [[ "$bump" != patch && "$bump" != minor && "$bump" != major ]]; then
  usage
  exit 2
fi

for command in git node npm gh; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'error: %s is required\n' "$command" >&2
    exit 1
  fi
done

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  printf 'error: the working tree must be clean\n' >&2
  exit 1
fi

if [[ "$(git branch --show-current)" != main ]]; then
  printf 'error: run this from the main branch\n' >&2
  exit 1
fi

git fetch origin main --quiet
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  printf 'error: local main is not up to date with origin/main\n' >&2
  exit 1
fi

next_version="$(BUMP="$bump" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!match) {
  console.error(`error: package.json has unsupported version ${version}`);
  process.exit(1);
}

let [, major, minor, patch] = match.map(Number);
if (process.env.BUMP === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (process.env.BUMP === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}
console.log(`${major}.${minor}.${patch}`);
NODE
)"

release_branch="chore/npm-release-v${next_version}"
if git show-ref --verify --quiet "refs/heads/${release_branch}" || \
  git ls-remote --exit-code --heads origin "$release_branch" >/dev/null 2>&1; then
  printf 'error: release branch %s already exists\n' "$release_branch" >&2
  exit 1
fi

printf 'Running checks before preparing v%s...\n' "$next_version"
npm run check

git switch -c "$release_branch"
npm version "$bump" --no-git-tag-version >/dev/null

actual_version="$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  console.log(JSON.parse(readFileSync("package.json", "utf8")).version);
')"
if [[ "$actual_version" != "$next_version" ]]; then
  printf 'error: npm calculated a different version\n' >&2
  exit 1
fi

if [[ "$(git diff --name-only)" != package.json ]]; then
  printf 'error: version bump changed files other than package.json\n' >&2
  exit 1
fi

git add package.json
git commit -m "chore: bump package to ${next_version}"
git push --set-upstream origin "$release_branch"

pr_body="$(cat <<EOF
## Summary

- Bump @benclmnt/postmock from the current version to ${next_version}.
- Publish the package after this PR merges.

## Verification

- npm run check
EOF
)"

gh pr create \
  --base main \
  --head "$release_branch" \
  --title "chore: bump package to ${next_version}" \
  --body "$pr_body"
