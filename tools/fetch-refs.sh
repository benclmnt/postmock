#!/usr/bin/env bash
# Recreates refs/ (git-ignored): Postmark developer docs as markdown, and the
# Swagger specs behind https://postmarkapp.com/api-explorer.
# Postmark may have edited a page since the 2026-09-16 snapshot the docs cite.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/refs/html" "$root/refs/openapi"
cd "$root/refs"
for f in server.yml account.yml; do
  curl -fsSL -o "openapi/$f" "https://postmarkapp.com/swagger/$f"
done
while read -r path; do
  [ -n "$path" ] || continue
  curl -fsSL -o "html/$(echo "${path#developer/}" | tr / _).html" "https://postmarkapp.com/$path"
done <<'LIST'
developer/api/overview
developer/api/email-api
developer/api/bulk-email
developer/api/bounce-api
developer/api/templates-api
developer/api/server-api
developer/api/servers-api
developer/api/message-streams-api
developer/api/messages-api
developer/api/domains-api
developer/api/signatures-api
developer/api/stats-api
developer/api/inbound-rules-triggers-api
developer/api/suppressions-api
developer/api/webhooks-api
developer/api/data-removals-api
developer/webhooks/webhooks-overview
developer/webhooks/bounce-webhook
developer/webhooks/delivery-webhook
developer/webhooks/open-tracking-webhook
developer/webhooks/click-webhook
developer/webhooks/spam-complaint-webhook
developer/webhooks/subscription-change-webhook
developer/webhooks/inbound-webhook
developer/webhooks/smtp-api-error
developer/user-guide/send-email-with-api
developer/user-guide/send-email-with-api/send-a-single-email
developer/user-guide/send-email-with-api/batch-emails
developer/user-guide/send-email-with-smtp
developer/user-guide/sandbox-mode
developer/user-guide/sandbox-mode/server-sandbox-mode
developer/user-guide/sandbox-mode/generate-fake-bounces
developer/user-guide/inbound/parse-an-email
developer/user-guide/ip-allowlisting
developer/user-guide/managing-your-account
developer/user-guide/tracking-links
developer/user-guide/tracking-opens
developer/user-guide/tracking-opens/tracking-opens-per-email
developer/user-guide/tracking-opens/tracking-opens-per-message-stream
support/article/1056-what-are-the-attachment-and-email-size-limits
support/article/1077-template-syntax
support/article/1125-custom-metadata-faq
support/article/1239-how-to-test-bounces
support/article/how-long-are-inbound-and-outbound-messages-stored-in-activity
LIST
[ -d "$root/refs/.venv" ] || python3 -m venv "$root/refs/.venv"
"$root/refs/.venv/bin/pip" -q install beautifulsoup4 markdownify
"$root/refs/.venv/bin/python" - <<'PY'
import glob, os, re
from bs4 import BeautifulSoup
from markdownify import markdownify as md
for f in sorted(glob.glob("html/*.html")):
    name = os.path.basename(f)[:-5]
    soup = BeautifulSoup(open(f).read(), "html.parser")
    main = soup.find("main") or soup.body
    for t in main.find_all(["script", "style", "nav", "footer", "header", "aside"]):
        t.decompose()
    out = "\n".join(l.rstrip() for l in md(str(main), heading_style="ATX").splitlines())
    out = re.sub(r"\n{3,}", "\n\n", out)
    i = out.find("\n# ")
    out = out[i + 1:] if i > 0 else out
    if name.startswith("support_article_"):
        url = "https://postmarkapp.com/support/article/" + name[len("support_article_"):]
    else:
        url = "https://postmarkapp.com/developer/" + name.replace("_", "/")
    open(name + ".md", "w").write(f"<!-- source: {url} fetched 2026-09-16 -->\n" + out)
PY
