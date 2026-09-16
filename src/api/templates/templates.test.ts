import { describe, expect, it } from "vitest";
import { createApiApp } from "../../http/app.ts";
import { createRuntime } from "../../runtime.ts";
import { createServer } from "../../state/servers.ts";

function setup() {
  const runtime = createRuntime();
  createServer(runtime.store, runtime.clock.now(), { ApiTokens: ["token"] });
  const app = createApiApp(runtime);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`http://api.postmarkapp.com${path}`, {
      method,
      headers: { "X-Postmark-Server-Token": "token", "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    // biome-ignore lint/suspicious/noExplicitAny: the tests read nested response JSON.
    return { status: res.status, json: (await res.json()) as any };
  };
  const layout = async () =>
    (
      await call("POST", "/templates/", {
        Name: "layout",
        HTMLBody: "<b>header</b> {{{@content}}} <b>footer</b>",
        TextBody: "header {{{ @content }}} footer",
        TemplateType: "Layout",
        Subject: null,
      })
    ).json;
  return { runtime, call, layout };
}

describe("templates CRUD (docs/06 §3.1–§3.2)", () => {
  it("creates, reads, deletes; a deleted template reads inactive and leaves the list", async () => {
    const { call } = setup();
    const created = await call("POST", "/templates", {
      Name: "welcome",
      Subject: "Hi {{name}}",
      HtmlBody: "<b>Hello, {{name}}</b>",
      Alias: null,
    });
    expect(created.json).toEqual({
      TemplateId: 1,
      Name: "welcome",
      Active: true,
      Alias: null,
      TemplateType: "Standard",
      LayoutTemplate: null,
    });
    expect((await call("GET", "/templates/1")).json).toMatchObject({
      AssociatedServerId: expect.any(Number),
      HtmlBody: "<b>Hello, {{name}}</b>",
      TextBody: null,
      Active: true,
    });
    expect((await call("DELETE", "/templates/1")).json).toEqual({
      ErrorCode: 0,
      Message: "Template 1 removed.",
    });
    expect((await call("GET", "/templates/1")).json.Active).toBe(false);
    expect((await call("GET", "/templates?count=100&offset=0")).json).toEqual({
      TotalCount: 0,
      Templates: [],
    });
    expect((await call("DELETE", "/templates/1")).json.ErrorCode).toBe(1101);
  });

  it("gives a layout an alias, links a standard template, filters and clears the layout", async () => {
    const { call, layout } = setup();
    const { Alias } = await layout();
    expect(Alias).toMatch(/^[A-Za-z]/);
    const standard = await call("POST", "/templates", {
      name: "s",
      subject: "{{subject}}",
      textBody: "Hello {{name}}!",
      layoutTemplate: Alias,
    });
    expect(standard.json.LayoutTemplate).toBe(Alias);
    const list = (query: string) => call("GET", `/templates/?Count=100&Offset=0&${query}`);
    expect((await list("TemplateType=Layout")).json.TotalCount).toBe(1);
    expect((await list(`TemplateType=All&LayoutTemplate=${Alias}`)).json.TotalCount).toBe(1);
    expect((await call("DELETE", `/templates/${Alias}`)).json.ErrorCode).toBe(1130);
    const cleared = await call("PUT", `/templates/${standard.json.TemplateId}`, {
      Name: null,
      LayoutTemplate: "",
    });
    expect(cleared.json).toMatchObject({ Name: "s", LayoutTemplate: null });
  });

  it("rejects a layout body without the content placeholder (postmark.js live test)", async () => {
    const { call, layout } = setup();
    const { TemplateId } = await layout();
    const res = await call("PUT", `/templates/${TemplateId}`, { HtmlBody: "Html content" });
    expect(res.status).toBe(422);
    expect(res.json.ErrorCode).toBe(1131);
    expect(res.json.Message).toContain("The layout content placeholder must be present");
  });

  it("answers bad paging with 1100", async () => {
    expect((await setup().call("GET", "/templates?offset=0")).json.ErrorCode).toBe(1100);
  });
});

describe("POST /templates/validate (docs/06 §3.3)", () => {
  it("suggests a model and renders with it (dotnet live test)", async () => {
    const res = await setup().call("POST", "/templates/validate", {
      Subject: "{{name}}",
      HtmlBody:
        "<html><body>{{content}}{{company.address}}{{#each products}}{{/each}}{{^competitors}}There are no substitutes.{{/competitors}}</body></html>",
      TextBody: "{{content}}",
      TestRenderModel: { name: "Johnny", content: "hello, world!" },
      InlineCssForHtmlTestRender: true,
    });
    expect(res.json.AllContentIsValid).toBe(true);
    expect(res.json.SuggestedTemplateModel.company.address).toBe("address_Value");
    expect(res.json.SuggestedTemplateModel.products).toHaveLength(3);
    expect(res.json.Subject).toEqual({
      ContentIsValid: true,
      ValidationErrors: [],
      RenderedContent: "Johnny",
    });
  });

  it("renders inside a layout", async () => {
    const { call, layout } = setup();
    const { Alias } = await layout();
    const res = await call("POST", "/templates/validate", {
      Subject: "Subject",
      HtmlBody: null,
      TextBody: "Mr. Jones",
      TestRenderModel: {},
      TemplateType: "Standard",
      LayoutTemplate: Alias,
    });
    expect(res.json.TextBody.RenderedContent).toBe("header Mr. Jones footer");
    expect(res.json.HtmlBody).toBeNull();
  });

  it("reports invalid content per part", async () => {
    const res = await setup().call("POST", "/templates/validate", {
      TextBody: "line\n{{#open}}",
      TemplateType: "Layout",
      HtmlBody: "no placeholder",
    });
    expect(res.json.AllContentIsValid).toBe(false);
    expect(res.json.TextBody.ValidationErrors[0]).toMatchObject({ Line: 2, CharacterPosition: 1 });
    expect(res.json.HtmlBody.ContentIsValid).toBe(false);
  });
});

describe("templated sends (docs/03 §1.4–§1.5)", () => {
  const message = { From: "sender@example.com", To: "to@example.com" };

  it("renders the template in its layout and submits the result", async () => {
    const { call, layout, runtime } = setup();
    const { Alias } = await layout();
    await call("POST", "/templates", {
      Name: "t",
      Alias: "welcome",
      Subject: "Hi {{name}}",
      TextBody: "Hello {{name}}",
      LayoutTemplate: Alias,
    });
    // php: TemplateId 0 beside the alias, TemplateModel as [] (docs/08 R10).
    const res = await call("POST", "/email/withTemplate", {
      ...message,
      TemplateId: 0,
      TemplateAlias: "welcome",
      TemplateModel: { name: "<Ann>" },
    });
    expect(res.json).toMatchObject({ To: "to@example.com", ErrorCode: 0, Message: "OK" });
    const [stored] = runtime.store.state.outbound.values();
    expect(stored).toMatchObject({
      Subject: "Hi &lt;Ann&gt;",
      TextBody: "header Hello &lt;Ann&gt; footer",
      HtmlBody: null,
      templateId: 2,
    });
  });

  it("answers per item in a batch with the SDK-quoted 1101 text", async () => {
    const { call } = setup();
    const res = await call("POST", "/email/batchWithTemplates", {
      Messages: [{ ...message, TemplateAlias: "invalid-alias", TemplateModel: null }],
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual([
      {
        ErrorCode: 1101,
        Message:
          "The Template's 'Alias' associated with this request is not valid or was not found.",
      },
    ]);
  });

  it("rejects content fields beside a template and a missing model", async () => {
    const { call } = setup();
    await call("POST", "/templates", { Name: "t", Subject: "s", TextBody: "b" });
    const mixed = await call("POST", "/email/withTemplate", {
      ...message,
      TemplateId: 1,
      TemplateModel: {},
      HtmlBody: "x",
    });
    expect(mixed.json.ErrorCode).toBe(1123);
    const noModel = await call("POST", "/email/withTemplate", { ...message, TemplateId: 1 });
    expect(noModel.json.ErrorCode).toBe(1120);
  });
});
