import { describe, expect, it } from "vitest";
import { CONFORMANCE } from "../../../seeds/lib/conformance.ts";
import { createControlApp } from "../../control/app.ts";
import { applySeed } from "../../control/seed.ts";
import { createApiApp } from "../../http/app.ts";
import { createRuntime } from "../../runtime.ts";
import type { Template } from "../../state/types.ts";

// biome-ignore lint/suspicious/noExplicitAny: each test reads the response fields it asserts.
type Body = any;

async function setup() {
  const runtime = createRuntime();
  await applySeed(runtime, "conformance");
  const api = createApiApp(runtime);
  const control = createControlApp(runtime, "conformance");
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await api.request(path, {
      method,
      headers: { "X-Postmark-Account-Token": CONFORMANCE.accountToken },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const json: Body = res.status === 501 ? await res.text() : await res.json();
    return { status: res.status, json };
  };
  const controlPost = async (path: string, body: unknown = {}) => {
    const res = await control.request(path, { method: "POST", body: JSON.stringify(body) });
    const json: Body = await res.json();
    return { status: res.status, json };
  };
  return { runtime, call, controlPost };
}

describe("servers", () => {
  it("matches colors without case and answers lowercase", async () => {
    const { call } = await setup();
    const created = await call("POST", "/servers/", { Name: "a", Color: "Red" });
    expect(created.json).toMatchObject({ Name: "a", Color: "red", DeliveryType: "Live" });
    const edited = await call("PUT", `/servers/${created.json.ID}`, { color: "GREEN" });
    expect(edited.json.Color).toBe("green");
    expect(
      (await call("PUT", `/servers/${created.json.ID}`, { Color: "pink" })).json.ErrorCode,
    ).toBe(607);
  });

  it("keeps a name unique and a DeliveryType fixed", async () => {
    const { call } = await setup();
    expect(
      (await call("POST", "/servers", { Name: CONFORMANCE.serverName.toUpperCase() })).json
        .ErrorCode,
    ).toBe(603);
    const sandbox = await call("POST", "/servers", { Name: "s", DeliveryType: "sandbox" });
    expect(sandbox.json.DeliveryType).toBe("Sandbox");
    expect(
      (await call("PUT", `/servers/${sandbox.json.ID}`, { DeliveryType: "Live" })).status,
    ).toBe(501);
  });

  it("filters by name substring and requires paging", async () => {
    const { call } = await setup();
    await call("POST", "/servers", { Name: "Production One" });
    await call("POST", "/servers", { Name: "Staging" });
    const found = await call("GET", "/servers?count=10&offset=0&name=production");
    expect(found.json.Servers.map((s: { Name: string }) => s.Name)).toEqual(["Production One"]);
    expect((await call("GET", "/servers?count=501&offset=0")).json.ErrorCode).toBe(600);
    expect((await call("GET", "/servers?count=10")).json.ErrorCode).toBe(600);
  });

  it("deletes only when the account allows it, with the server's streams", async () => {
    const { runtime, call, controlPost } = await setup();
    const { json: server } = await call("POST", "/servers", { Name: "doomed" });
    await controlPost("/control/account/server-deletion", { enabled: false });
    expect((await call("DELETE", `/servers/${server.ID}`)).json.ErrorCode).toBe(604);
    await controlPost("/control/account/server-deletion", { enabled: true });
    expect((await call("DELETE", `/servers/${server.ID}`)).json).toEqual({
      ErrorCode: 0,
      Message: "Server doomed removed.",
    });
    const streams = [...runtime.store.state.streams.values()];
    expect(streams.some((s) => s.ServerID === server.ID)).toBe(false);
  });
});

describe("domains", () => {
  it("validates the name and the Return-Path", async () => {
    const { call } = await setup();
    expect((await call("POST", "/domains", {})).json.ErrorCode).toBe(514);
    expect((await call("POST", "/domains", { Name: "thisisntadomain" })).json.ErrorCode).toBe(516);
    expect((await call("POST", "/domains", { Name: CONFORMANCE.domain })).json.ErrorCode).toBe(512);
    const bad = await call("POST", "/domains", { Name: "a.org", ReturnPathDomain: "pm.b.org" });
    expect(bad.json.ErrorCode).toBe(522);
  });

  it("verifies DKIM only through the control API, and renews a verified key", async () => {
    const { call, controlPost } = await setup();
    const { json: domain } = await call("POST", "/domains", { Name: "new.org" });
    expect(domain).toMatchObject({
      DKIMVerified: false,
      DKIMHost: "",
      DKIMUpdateStatus: "Pending",
    });
    expect((await call("PUT", `/domains/${domain.ID}/verifyDKIM`)).json.DKIMVerified).toBe(false);
    expect((await call("POST", `/domains/${domain.ID}/rotateDKIM`)).json.ErrorCode).toBe(505);

    await controlPost(`/control/domains/${domain.ID}/verify`, { dkim: true });
    const verified = (await call("PUT", `/domains/${domain.ID}/verifydkim`)).json;
    expect(verified).toMatchObject({
      DKIMVerified: true,
      DKIMUpdateStatus: "Verified",
      DKIMHost: domain.DKIMPendingHost,
      DKIMPendingHost: "",
    });

    const rotated = (await call("POST", `/domains/${domain.ID}/rotatedkim`)).json;
    expect(rotated).toMatchObject({ DKIMUpdateStatus: "Pending", DKIMHost: verified.DKIMHost });
    expect(
      (await controlPost(`/control/domains/${domain.ID}/verify`, { dkim: true })).json,
    ).toMatchObject({
      DKIMRevokedHost: verified.DKIMHost,
      SafeToRemoveRevokedKeyFromDNS: true,
    });
  });

  it("a new Return-Path needs a new verification; empty clears, null keeps", async () => {
    const { call, controlPost } = await setup();
    const { json: domain } = await call("POST", "/domains", {
      Name: "rp.org",
      ReturnPathDomain: "pm.rp.org",
    });
    await controlPost(`/control/domains/${domain.ID}/verify`, { returnPath: true });
    expect(
      (await call("PUT", `/domains/${domain.ID}`, { ReturnPathDomain: null })).json,
    ).toMatchObject({
      ReturnPathDomain: "pm.rp.org",
      ReturnPathDomainVerified: true,
    });
    expect(
      (await call("PUT", `/domains/${domain.ID}`, { ReturnPathDomain: "b.rp.org" })).json,
    ).toMatchObject({
      ReturnPathDomainVerified: false,
    });
    expect(
      (await call("PUT", `/domains/${domain.ID}`, { ReturnPathDomain: "" })).json.ReturnPathDomain,
    ).toBe("");
    expect(
      (await controlPost(`/control/domains/${domain.ID}/verify`, { returnPath: true })).status,
    ).toBe(400);
  });

  it("answers 510 for an unknown domain", async () => {
    const { call } = await setup();
    expect(await call("GET", "/domains/99999")).toMatchObject({
      status: 422,
      json: { ErrorCode: 510 },
    });
  });
});

describe("sender signatures", () => {
  it("confirms through the control API; a confirmed signature cannot be re-sent", async () => {
    const { call, controlPost } = await setup();
    const { json: sender } = await call("POST", "/senders", {
      FromEmail: "qa@new.org",
      Name: "QA",
    });
    expect(sender).toMatchObject({ Domain: "new.org", Confirmed: false, ReplyToEmailAddress: "" });
    expect((await call("POST", `/senders/${sender.ID}/resend`)).json.ErrorCode).toBe(0);
    await controlPost(`/control/senders/${sender.ID}/confirm`);
    expect((await call("GET", `/senders/${sender.ID}`)).json.Confirmed).toBe(true);
    expect((await call("POST", `/senders/${sender.ID}/resend`)).json.ErrorCode).toBe(506);
    expect((await controlPost(`/control/senders/${sender.ID}/confirm`)).status).toBe(400);
  });

  it("validates create input", async () => {
    const { call } = await setup();
    expect((await call("POST", "/senders", { Name: "x" })).json.ErrorCode).toBe(520);
    expect((await call("POST", "/senders", { FromEmail: "nope", Name: "x" })).json.ErrorCode).toBe(
      522,
    );
    expect(
      (await call("POST", "/senders", { FromEmail: "me@gmail.com", Name: "x" })).json.ErrorCode,
    ).toBe(503);
    expect(
      (await call("POST", "/senders", { FromEmail: CONFORMANCE.senderEmail, Name: "x" })).json
        .ErrorCode,
    ).toBe(504);
    const note = "n".repeat(401);
    expect(
      (
        await call("POST", "/senders", {
          FromEmail: "a@b.org",
          Name: "x",
          ConfirmationPersonalNote: note,
        })
      ).json.ErrorCode,
    ).toBe(521);
  });

  it("refuses a DKIM renewal while a key is pending, and answers 404 for an unknown signature", async () => {
    const { call } = await setup();
    const { json: sender } = await call("POST", "/senders", {
      FromEmail: "dk@new.org",
      Name: "DK",
    });
    expect((await call("POST", `/senders/${sender.ID}/requestNewDkim`)).json.ErrorCode).toBe(505);
    expect(await call("GET", "/senders/99999")).toMatchObject({
      status: 404,
      json: { ErrorCode: 501 },
    });
  });
});

describe("template push", () => {
  const template = (id: number, serverId: number, fields: Partial<Template>): Template => ({
    TemplateId: id,
    ServerID: serverId,
    Name: `t${id}`,
    Alias: `alias-${id}`,
    Subject: "s",
    HtmlBody: "h",
    TextBody: null,
    TemplateType: "Standard",
    LayoutTemplate: null,
    Active: true,
    ...fields,
  });

  async function twoServers() {
    const ctx = await setup();
    const { json: destination } = await ctx.call("POST", "/servers", { Name: "destination" });
    const add = (t: Template) => {
      ctx.runtime.store.useId("template", t.TemplateId);
      ctx.runtime.store.state.templates.set(t.TemplateId, t);
    };
    const push = (PerformChanges: boolean) =>
      ctx.call("PUT", "/templates/push", {
        SourceServerId: CONFORMANCE.serverId,
        DestinationServerId: String(destination.ID),
        PerformChanges,
      });
    return { ...ctx, destination, add, push };
  }

  it("names the missing servers with the live-test text", async () => {
    const { call } = await setup();
    const push = (s: number, d: number) =>
      call("PUT", "/templates/push", {
        SourceServerID: s,
        DestinationServerID: d,
        PerformChanges: false,
      });
    expect((await push(0, 1)).json.Message).toBe(
      "The source and destination servers were not found.",
    );
    expect((await push(CONFORMANCE.serverId, 1)).json.Message).toBe(
      "The destination server was not found.",
    );
    expect((await push(1, CONFORMANCE.serverId)).json.Message).toBe(
      "The source server was not found.",
    );
  });

  it("dry run lists changes without applying them; a real push creates, edits and skips", async () => {
    const { runtime, destination, add, push } = await twoServers();
    add(template(1, CONFORMANCE.serverId, { Alias: "welcome", Name: "Welcome" }));
    add(template(2, CONFORMANCE.serverId, { Alias: "same" }));
    add(template(3, CONFORMANCE.serverId, { Alias: null }));
    add(template(4, destination.ID, { Alias: "SAME", Name: "t2" }));

    expect((await push(false)).json).toEqual({
      TotalCount: 1,
      Templates: [
        { Action: "Create", Alias: "welcome", Name: "Welcome", TemplateType: "Standard" },
      ],
    });
    const destinationTemplates = () =>
      [...runtime.store.state.templates.values()].filter((t) => t.ServerID === destination.ID);
    expect(destinationTemplates()).toHaveLength(1);

    const created = (await push(true)).json.Templates[0];
    expect(created).toMatchObject({ Action: "Create", Alias: "welcome" });
    expect(runtime.store.state.templates.get(created.TemplateId)).toMatchObject({
      ServerID: destination.ID,
      Name: "Welcome",
    });

    (runtime.store.state.templates.get(1) as Template).Subject = "changed";
    expect((await push(true)).json.Templates).toEqual([
      {
        Action: "Edit",
        TemplateId: created.TemplateId,
        Alias: "welcome",
        Name: "Welcome",
        TemplateType: "Standard",
      },
    ]);
    expect(runtime.store.state.templates.get(created.TemplateId)?.Subject).toBe("changed");
  });

  it("refuses a push with no aliased template, or with a type mismatch", async () => {
    const { destination, add, push } = await twoServers();
    add(template(1, CONFORMANCE.serverId, { Alias: null }));
    expect((await push(false)).json.ErrorCode).toBe(1124);
    add(template(2, CONFORMANCE.serverId, { Alias: "x" }));
    add(template(3, destination.ID, { Alias: "x", TemplateType: "Layout" }));
    expect((await push(true)).json.ErrorCode).toBe(1125);
  });
});
