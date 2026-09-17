1. Read `README.md` first: goal, scope, layout. This repo builds postmock, a mock Postmark
   **server** in TypeScript. Real, unmodified Postmark clients (every official
   SDK, and plain SMTP clients) talk to it as if it were Postmark.
   `ARCHITECTURE.md` is the design and the shared contracts, `CONTROL-API.md` the
   test-facing API, and `TESTING.md` how to verify the mock.
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
   Never modify files under `sdk/`.
9. `grep` may be ugrep: a complex regex can report 0 hits. Use Python for
   anything beyond a plain string search.
10. Write docs in Simplified Technical English: short active sentences, one
    fact per line, tables over prose.
11. Do not keep old methods or compatibility shims. This is a new project with no
    compatibility concerns.
12. The control API never produces a state that a real Postmark client action or
    a real Postmark event could not produce (`CONTROL-API.md`).
13. The repo is `github.com/benclmnt/postmock`. Work on branches and open pull requests.
    Never push to or force-push `main`. Only the owner, or the integrator the owner names, merges pull requests.
14. Commit your changes before you finish your turn.
15. Read the traps before debugging: server and client traps in `ARCHITECTURE.md`,
    test and harness traps in `TESTING.md`. When a new trap costs you an hour,
    add it there.
