#!/usr/bin/env bash
# Packs postmock, installs the tarball in a temp dir outside the repo, starts `npm exec postmock`
# there, and checks REST and SMTP against the installed package (docs/11 §3.4).
# Needs the npm registry for the dependencies. Sends nothing outside 127.0.0.1.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
pid=""
cleanup() {
  [ -z "$pid" ] || kill "$pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

(cd "$root" && npm pack --silent --pack-destination "$work" >/dev/null)
cd "$work"
echo '{"name": "postmock-pack-smoke", "private": true}' >package.json
pnpm add --silent ./benclmnt-postmock-*.tgz nodemailer@9.1.1
[ ! -e node_modules/@benclmnt/postmock/src ] || { echo "the package ships the sources" >&2; exit 1; }
# Discovery loads what is on disk, so a module missing from dist/ is a missing route or seed part.
# Test files and test helpers stay out of the package (tsconfig.build.json).
(cd "$root" && find src seeds -name '*.ts' ! -name '*.test.ts' ! -name 'test-*.ts' ! -name 'testkit.ts' |
  sed 's/\.ts$//' | sort) >expected-modules
(cd node_modules/@benclmnt/postmock/dist && find src seeds -name '*.js' | sed 's/\.js$//' | sort) >packed-modules
diff expected-modules packed-modules || { echo "dist/ modules differ from the sources" >&2; exit 1; }
echo "modules: $(wc -l <packed-modules | tr -d ' ') in dist/"

npm exec -- postmock --seed conformance --api-port 0 --control-port 0 --smtp-ports 0 >postmock.log 2>&1 &
pid=$!
for _ in $(seq 100); do
  grep -q '^postmock ' postmock.log && break
  kill -0 "$pid" 2>/dev/null || { cat postmock.log >&2; exit 1; }
  sleep 0.1
done
line="$(grep '^postmock ' postmock.log)" || { cat postmock.log >&2; exit 1; }
echo "$line"

cat >smoke.mjs <<'JS'
import nodemailer from "nodemailer";

const listeners = Object.fromEntries(
  process.argv.slice(2).filter((w) => w.includes("=")).map((w) => w.split(/=(.*)/s).slice(0, 2)),
);
const token = "postmock-server-token";
const server = await fetch(`${listeners.api}/server`, { headers: { "X-Postmark-Server-Token": token } });
if (server.status !== 200) throw new Error(`GET /server answered ${server.status}`);
console.log(`GET /server: ${server.status}`);

const smtp = new URL(listeners.smtp);
const info = await nodemailer
  .createTransport({ host: smtp.hostname, port: Number(smtp.port), secure: false, auth: { user: token, pass: token } })
  .sendMail({ from: "sender@example.com", to: "smoke@example.com", subject: "smoke", text: "smoke" });
console.log(`SMTP: ${info.response}`);

const stored = await (await fetch(`${listeners.control}/control/messages?channel=smtp&to=smoke@example.com`)).json();
if (stored.Messages.length !== 1) throw new Error(`control API holds ${stored.Messages.length} SMTP messages`);
console.log("control API: 1 SMTP message");
JS
# shellcheck disable=SC2086
node smoke.mjs $line
