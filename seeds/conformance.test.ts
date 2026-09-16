import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applySeed, seedNames } from "../src/control/seed.ts";
import { createRuntime } from "../src/runtime.ts";
import { streamKey } from "../src/state/store.ts";
import { CONFORMANCE } from "./lib/conformance.ts";

describe("conformance seed", () => {
  it("matches the keys the postmark.js runner configures", () => {
    const keys = JSON.parse(
      readFileSync(
        new URL("../conformance/postmark.js/testing_keys.json", import.meta.url),
        "utf8",
      ),
    );
    expect(keys).toEqual({
      SERVER_API_TOKEN: CONFORMANCE.serverToken,
      ACCOUNT_API_TOKEN: CONFORMANCE.accountToken,
      SENDER_EMAIL_ADDRESS: CONFORMANCE.senderEmail,
      RECIPIENT_EMAIL_ADDRESS: CONFORMANCE.recipientEmail,
      DOMAIN_NAME: CONFORMANCE.domain,
    });
  });

  it("E12: uses addresses that pass email validation (no .test or .local)", () => {
    for (const email of [CONFORMANCE.senderEmail, CONFORMANCE.recipientEmail]) {
      expect(email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
      expect(email).not.toMatch(/\.(test|local)$/);
    }
  });

  it("creates the account token, the conformance server and its three default streams", async () => {
    const runtime = createRuntime();
    await applySeed(runtime, "conformance");
    const { account, servers, streams } = runtime.store.state;
    expect(account.tokens).toEqual([CONFORMANCE.accountToken]);
    expect(servers.get(CONFORMANCE.serverId)?.ApiTokens).toEqual([CONFORMANCE.serverToken]);
    expect(
      ["outbound", "inbound", "broadcast"].map(
        (id) => streams.get(streamKey(CONFORMANCE.serverId, id))?.MessageStreamType,
      ),
    ).toEqual(["Transactional", "Inbound", "Broadcasts"]);
  });

  it("is listed with the empty seed", () => {
    expect(seedNames()).toEqual(["conformance", "empty"]);
  });
});
