#!/usr/bin/env bash
# Recreates sdk/ (git-ignored) at the commits the docs cite: every SDK, or the named ones.
#   tools/fetch-sources.sh [repo]...
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/sdk"
list="$(cat <<'LIST'
postmark-cli c88a59d11eaefda69f01cd6a0cd753eee836b2fa
postmark-dotnet b4249c5b7715183f11bc2b92b9a9035b3b4feadb
postmark-gem a50ff395d04b1c0050d11ce0ece70543c31f7f8f
postmark-java c6c5eb68bedb71596121474bcada3598667fdf84
postmark-mcp 63ef055861820b12b748697339488d564d754a5c
postmark-nodemailer 899daae9fd4e59f24da28ef6e765544e2da96c3c
postmark-php ad4b80e1f9953e22a9f7e32cad9d1c4cfcf73c0e
postmark-python 620d659ea7a643121c051b4c2e402cbd32b7f536
postmark-rails f9e4accd3a808c9d6e7f2115103723e1992f6fa4
postmark.js f9552126ff83c07205576f42584487a651896945
LIST
)"
for want in "$@"; do
  grep -q "^$want " <<<"$list" || { echo "unknown repo: $want" >&2; exit 2; }
done
while read -r repo sha; do
  if [ $# -gt 0 ] && ! printf '%s\n' "$@" | grep -qx -- "$repo"; then continue; fi
  dir="$root/sdk/$repo"
  [ -d "$dir" ] || git clone -q --filter=blob:none https://github.com/ActiveCampaign/$repo.git "$dir"
  git -C "$dir" fetch -q --depth 1 origin "$sha"
  git -C "$dir" checkout -q "$sha"
done <<<"$list"
