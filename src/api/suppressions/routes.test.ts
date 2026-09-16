import { describe, expect, it } from "vitest";
import { recipientsKit } from "../../recipients/testkit.ts";
import { formatEasternDate } from "../../time.ts";

const base = "/message-streams/outbound/suppressions";
const items = (...emails: string[]) => ({
  Suppressions: emails.map((EmailAddress) => ({ EmailAddress })),
});

describe("suppressions", () => {
  it("creates Customer rows, one result per item in order, with Failed for a bad address", async () => {
    const { call } = await recipientsKit();
    const res = await call("POST", base, items("a@example.com", "not-a-correct-email-address"));
    expect(res.body.Suppressions).toEqual([
      { EmailAddress: "a@example.com", Status: "Suppressed", Message: null },
      {
        EmailAddress: "not-a-correct-email-address",
        Status: "Failed",
        Message: "An invalid email address was provided.",
      },
    ]);
  });

  it("filters the dump by reason, origin, address and inclusive dates, with any key case", async () => {
    const { call, runtime } = await recipientsKit();
    await call("POST", base, items("a@example.com", "b@example.com"));
    const dump = (query: string) =>
      call("GET", `${base}/dump?${query}`).then((r) =>
        r.body.Suppressions.map((s: { EmailAddress: string }) => s.EmailAddress),
      );
    expect(
      await dump("emailAddress=A@example.com&origin=Customer&suppressionReason=ManualSuppression"),
    ).toEqual(["a@example.com"]);
    expect(await dump("EmailAddress=a@example.com&Origin=Admin")).toEqual([]);
    expect(await dump("SuppressionReason=HardBounce")).toEqual(["hardbounce@example.com"]);
    const today = formatEasternDate(runtime.clock.now());
    expect(await dump(`todate=${today}&fromdate=2000-01-01&count=100&offset=0`)).toHaveLength(3);
  });

  it("deletes a Customer row and answers Deleted for an address with no row", async () => {
    const { call } = await recipientsKit();
    await call("POST", base, items("a@example.com"));
    const res = await call("POST", `${base}/delete`, items("a@example.com", "none@example.com"));
    expect(res.body.Suppressions.map((s: { Status: string }) => s.Status)).toEqual([
      "Deleted",
      "Deleted",
    ]);
    expect(
      (await call("GET", `${base}/dump?emailAddress=a@example.com`)).body.Suppressions,
    ).toEqual([]);
  });

  it.each([
    ["GET", "/message-streams/nope/suppressions/dump", undefined, 1226],
    ["GET", `${base}/dump?SuppressionReason=Bounce`, undefined, 1404],
    ["GET", `${base}/dump?Origin=Robot`, undefined, 1405],
    ["POST", base, undefined, 1409],
    ["POST", base, { Suppressions: "a@example.com" }, 1409],
    [
      "POST",
      `${base}/delete`,
      items(...Array.from({ length: 51 }, (_, i) => `a${i}@example.com`)),
      1410,
    ],
  ])("%s %s answers ErrorCode %i", async (method, path, body, code) => {
    const { call } = await recipientsKit();
    expect(await call(method, path, body)).toMatchObject({
      status: 422,
      body: { ErrorCode: code },
    });
  });
});
