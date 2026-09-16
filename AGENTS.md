1. Read `README.md` first: goal, scope, layout. This repo builds postmock, a mock Postmark
   **server** in TypeScript. Real, unmodified Postmark clients (every official
   SDK, and plain SMTP clients) talk to it as if it were Postmark.
2. Scope is every official SDK's surface: server-token API, account-token API,
   SMTP, and outbound webhooks. `docs/11` is the build plan. Done means every
   official SDK's live integration suite passes (`conformance/`).
3. Never require a change to client code. A client reaches the mock through its
   base-URL option, or through DNS plus a trusted test CA (`docs/01`).
4. Brevity. Have only one way of doing things; refactor relentlessly.
5. If something doesn't work, return the error Postmark would return, or crash.
   No fallbacks. A mock that silently answers wrong teaches the wrong API.
6. Every claim in `docs/` cites a source and a confidence mark:
   - `refs/openapi/<file>.yml:LINE` or `refs/<page>.md:LINE` → **DOC**
   - `sdk/<repo>/<path>:LINE` → **SDK** (what an official client sends or expects)
   - third-party client library code (nodemailer, undici) → **LIB**
   - a real Postmark response in `captures/` → **CAPTURED**
   - otherwise → **INFERRED**
   Source order: CAPTURED > SDK live integration test > DOC > other SDK code >
   INFERRED (`docs/11` B3). Where sources disagree, say so.
7. Never call real Postmark. Captures (`docs/10`) are deferred; when they run,
   they use a dedicated sandbox server only. `captures/` stays git-ignored; redact tokens.
8. `sdk/` and `refs/` are git-ignored: they hold third-party code and Postmark's
   copyrighted docs. Recreate them with `tools/fetch-sources.sh` and
   `tools/fetch-refs.sh`. Line cites into `refs/` match the 2026-09-16 snapshot.
9. `grep` may be ugrep: a complex regex can report 0 hits. Use Python for
   anything beyond a plain string search.
10. Write docs in Simplified Technical English: short active sentences, one
    fact per line, tables over prose.
