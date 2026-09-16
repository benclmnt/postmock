import { describe, expect, it } from "vitest";
import { CONFORMANCE } from "../../seeds/lib/conformance.ts";
import { recipientsKit } from "../recipients/testkit.ts";

const send = (To: string, Headers: { Name: string; Value: string }[] = []) => ({
  From: CONFORMANCE.senderEmail,
  To,
  Subject: "Hi",
  TextBody: "Hi",
  Headers,
});

describe("bounce-testing.postmarkapp.com", () => {
  it("bounces a HardBounce send at once and suppresses the address", async () => {
    const { call } = await recipientsKit();
    const to = "HardBounce@bounce-testing.postmarkapp.com";
    const sent = await call("POST", "/email", send(to));
    expect(sent.status).toBe(200);
    const bounces = (await call("GET", "/bounces?count=20&offset=0")).body.Bounces;
    expect(
      bounces.filter((b: { MessageID: string }) => b.MessageID === sent.body.MessageID),
    ).toEqual([
      expect.objectContaining({ Type: "HardBounce", Email: to, Inactive: true, CanActivate: true }),
    ]);
    expect((await call("POST", "/email", send(to))).body.ErrorCode).toBe(406);
  });

  it("takes the type from the header or the local part, without case or underscores", async () => {
    const { call } = await recipientsKit();
    const typeOf = async (to: string, headers: { Name: string; Value: string }[] = []) => {
      const sent = await call("POST", "/email", send(to, headers));
      const bounces = (await call("GET", "/bounces?count=50&offset=0")).body.Bounces;
      return bounces.find((b: { MessageID: string }) => b.MessageID === sent.body.MessageID)?.Type;
    };
    expect(await typeOf("soft_bounce@bounce-testing.postmarkapp.com")).toBe("SoftBounce");
    expect(
      await typeOf("any@Bounce-Testing.postmarkapp.com", [
        { Name: "X-PM-Bounce-Type", Value: "transient" },
      ]),
    ).toBe("Transient");
    expect(await typeOf("spamcomplaint@bounce-testing.postmarkapp.com")).toBe("HardBounce");
    expect(await typeOf("recipient@example.com")).toBeUndefined();
  });
});
