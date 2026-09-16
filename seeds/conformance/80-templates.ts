import type { Seed } from "../../src/control/seed.ts";
import { createServer } from "../../src/state/servers.ts";
import { TEMPLATE_SERVER } from "../lib/template-server.ts";

/** A server with one standard template that renders without a model. */
const templates: Seed = ({ store, clock }) => {
  createServer(store, clock.now(), {
    ID: TEMPLATE_SERVER.id,
    Name: TEMPLATE_SERVER.name,
    ApiTokens: [TEMPLATE_SERVER.token],
  });
  store.state.templates.set(store.useId("template", TEMPLATE_SERVER.templateId), {
    TemplateId: TEMPLATE_SERVER.templateId,
    ServerID: TEMPLATE_SERVER.id,
    Name: "postmock welcome",
    Alias: "postmock-welcome",
    Subject: "Welcome",
    HtmlBody: "<p>Welcome</p>",
    TextBody: "Welcome",
    TemplateType: "Standard",
    LayoutTemplate: null,
    Active: true,
  });
};
export default templates;
