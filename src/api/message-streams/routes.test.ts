import { describe, expect, it } from "vitest";
import { recipientsKit } from "../../recipients/testkit.ts";

const DAY = 24 * 60 * 60 * 1000;
const create = (ID: string, MessageStreamType = "Transactional", extra: object = {}) => ({
  ID,
  Name: "Dummy Test Stream",
  Description: "This is a dummy description.",
  MessageStreamType,
  ...extra,
});

describe("message streams", () => {
  it("lists the default streams, creates one with null UpdatedAt and ArchivedAt, and counts it", async () => {
    const { call } = await recipientsKit();
    const created = await call("POST", "/message-streams/", create("test", "Broadcasts"));
    expect(created.body).toMatchObject({
      ID: "test",
      ServerID: 1,
      MessageStreamType: "Broadcasts",
      Description: "This is a dummy description.",
      UpdatedAt: null,
      ArchivedAt: null,
      ExpectedPurgeDate: null,
      SubscriptionManagementConfiguration: { UnsubscribeHandlingType: "Postmark" },
    });
    const all = await call(
      "GET",
      "/message-streams?MessageStreamType=All&IncludeArchivedStreams=False",
    );
    expect(all.body.TotalCount).toBe(4);
    const broadcasts = await call("GET", "/message-streams?messageStreamType=broadcasts");
    expect(broadcasts.body.MessageStreams.map((s: { ID: string }) => s.ID)).toEqual([
      "broadcast",
      "test",
    ]);
  });

  it("edits only Name, Description and handling type from a whole-object PATCH (java)", async () => {
    const { call } = await recipientsKit();
    const stream = (await call("GET", "/message-streams/outbound")).body;
    const res = await call("PATCH", "/message-streams/outbound", {
      Id: "outbound",
      ServerId: "1",
      Description: "Some description",
      MessageStreamType: "Transactional",
      CreatedAt: 1726000000000,
      SubscriptionManagementConfiguration: { UnsubscribeHandlingType: "None" },
    });
    expect(res.body).toMatchObject({ Name: stream.Name, Description: "Some description" });
    expect(res.body.UpdatedAt).not.toBeNull();
  });

  it("archives, hides, unarchives, and refuses unarchive after the purge date", async () => {
    const { call, runtime } = await recipientsKit();
    await call("POST", "/message-streams", create("test-a"));
    const archived = await call("POST", "/message-streams/test-a/archive");
    expect(Object.keys(archived.body)).toEqual(["ID", "ServerID", "ExpectedPurgeDate"]);
    const purge = Date.parse(archived.body.ExpectedPurgeDate);
    expect(purge - runtime.clock.now().getTime()).toBeGreaterThan(44 * DAY);
    const hidden = await call("GET", "/message-streams?MessageStreamType=Transactional");
    expect(hidden.body.TotalCount).toBe(1);
    const shown = await call(
      "GET",
      "/message-streams?MessageStreamType=Transactional&IncludeArchivedStreams=true",
    );
    expect(shown.body.MessageStreams[1].ArchivedAt).not.toBeNull();
    expect((await call("POST", "/message-streams/test-a/unarchive")).body.ArchivedAt).toBeNull();

    await call("POST", "/message-streams/test-a/archive");
    await runtime.clock.advance(45 * DAY);
    expect((await call("GET", "/message-streams/test-a")).body.ErrorCode).toBe(1226);
    expect((await call("POST", "/message-streams/test-a/unarchive")).body.ErrorCode).toBe(1232);
  });

  it("purges a stream with its suppressions; a new stream with the same ID starts empty", async () => {
    const { call, runtime } = await recipientsKit();
    await call("POST", "/message-streams", create("promo", "Broadcasts"));
    const rows = "/message-streams/promo/suppressions";
    await call("POST", rows, { Suppressions: [{ EmailAddress: "a@example.com" }] });
    await call("POST", "/message-streams/promo/archive");
    await runtime.clock.advance(45 * DAY);
    expect(runtime.store.state.suppressions.size).toBe(1); // the seeded outbound row
    expect((await call("POST", "/message-streams", create("promo", "Broadcasts"))).status).toBe(
      200,
    );
    expect((await call("GET", `${rows}/dump`)).body.Suppressions).toEqual([]);
  });

  it("keeps a stream unarchived before its purge date", async () => {
    const { call, runtime } = await recipientsKit();
    await call("POST", "/message-streams", create("keep"));
    await call("POST", "/message-streams/keep/archive");
    await call("POST", "/message-streams/keep/unarchive");
    await runtime.clock.advance(46 * DAY);
    expect((await call("GET", "/message-streams/keep")).body.ArchivedAt).toBeNull();
  });

  it("refuses an empty Name on edit and answers 501 for editing an archived stream", async () => {
    const { call } = await recipientsKit();
    expect((await call("PATCH", "/message-streams/outbound", { Name: "" })).body.ErrorCode).toBe(
      1223,
    );
    expect((await call("PATCH", "/message-streams/outbound", { Name: null })).status).toBe(200);
    await call("POST", "/message-streams/broadcast/archive");
    expect((await call("PATCH", "/message-streams/broadcast", { Name: "x" })).status).toBe(501);
  });

  it.each([
    [create(""), 1222],
    [create("pm-stream"), 1233],
    [create("1abc"), 1227],
    [create("a".repeat(31)), 1227],
    [{ ...create("ok"), Name: "" }, 1223],
    [create("ok", "Inbound"), 1228],
    [create("ok", "Marketing"), 1221],
    [create("outbound"), 1230],
    [create("ok", "Transactional", { Description: "<b>hi</b>" }), 1234],
    [
      create("ok", "Broadcasts", {
        SubscriptionManagementConfiguration: { UnsubscribeHandlingType: "None" },
      }),
      1239,
    ],
    [
      create("ok", "Broadcasts", {
        SubscriptionManagementConfiguration: { UnsubscribeHandlingType: "Custom" },
      }),
      1238,
    ],
    [
      create("ok", "Broadcasts", {
        SubscriptionManagementConfiguration: { UnsubscribeHandlingType: "Other" },
      }),
      1240,
    ],
  ])("refuses create body %j with ErrorCode %i", async (body, code) => {
    const { call } = await recipientsKit();
    const res = await call("POST", "/message-streams", body);
    expect(res).toMatchObject({ status: 422, body: { ErrorCode: code } });
  });

  it("refuses an 11th stream, archiving default streams, and all calls without API access", async () => {
    const { call, runtime } = await recipientsKit();
    for (let i = 0; i < 7; i++) await call("POST", "/message-streams", create(`s${i}`));
    expect((await call("POST", "/message-streams", create("s7"))).body.ErrorCode).toBe(1225);
    expect((await call("POST", "/message-streams/inbound/archive")).body.ErrorCode).toBe(1229);
    expect((await call("POST", "/message-streams/broadcast/archive")).status).toBe(200);
    runtime.store.state.account.messageStreamsApiEnabled = false;
    expect((await call("GET", "/message-streams")).body.ErrorCode).toBe(1220);
  });
});
