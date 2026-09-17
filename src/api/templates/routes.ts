import { z } from "zod";
import { apiError } from "../../errors.ts";
import { absent, queryInt } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import { defineRoute } from "../../http/routes.ts";
import type { Template } from "../../state/types.ts";
import { sendBatchWithTemplates, sendWithTemplate } from "./send.ts";
import {
  activeTemplate,
  checkCanCreate,
  checkLayoutChange,
  checkTemplate,
  findTemplate,
  generatedAlias,
  parseOrReject,
  parseTemplateType,
  TEMPLATE_TYPES,
  type TemplateDraft,
  templateJson,
  templateListJson,
  templateNotFound,
  templateSummaryJson,
} from "./templates.ts";
import { validateTemplate } from "./validate.ts";

// Templates API (docs/06 §3). Template push (`PUT /templates/push`) belongs to the account API.

const text = absent(z.string());

// dotnet sends every key, null when unset (docs/08 §1.3). `LayoutTemplate: ""` clears the layout
// (refs/api_templates-api.md:545), so it keeps "" apart from null.
const templateBody = z.object({
  Name: text,
  Subject: text,
  HtmlBody: text,
  TextBody: text,
  Alias: text,
  TemplateType: text,
  LayoutTemplate: z.string().nullable().optional(),
});

defineRoute({
  method: "GET",
  path: "/templates",
  auth: "server",
  handler: ({ store, query, auth }) => {
    const paging = query.pick(z.object({ count: queryInt, offset: queryInt }));
    // refs/api_templates-api.md:694-695: both required. Messages INFERRED.
    if (!paging.success || paging.data.count < 1 || paging.data.offset < 0) {
      throw apiError(1100, {
        message: "The 'Count' and 'Offset' query parameters are required non-negative integers.",
      });
    }
    const filter = query.get("TemplateType") ?? "All";
    if (filter !== "All" && !TEMPLATE_TYPES.some((t) => t === filter)) {
      throw apiError(1100, {
        message: `Invalid 'TemplateType': '${filter}'. Use All, Standard or Layout.`,
      });
    }
    const layout = query.get("LayoutTemplate");
    // A deleted template leaves the list (sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:150-155).
    const templates = [...store.state.templates.values()]
      .filter(
        (t) =>
          t.ServerID === auth.server.ID &&
          t.Active &&
          (filter === "All" || t.TemplateType === filter) &&
          (layout === undefined || t.LayoutTemplate === layout),
      )
      .sort((a, b) => a.TemplateId - b.TemplateId);
    const { count, offset } = paging.data;
    return {
      TotalCount: templates.length,
      Templates: templates.slice(offset, offset + count).map(templateListJson),
    };
  },
});

// A deleted template stays readable with `Active: false`
// (sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:112-115).
defineRoute({
  method: "GET",
  path: "/templates/:idOrAlias",
  auth: "server",
  handler: ({ store, params, auth }) => {
    const template = findTemplate(store.state, auth.server.ID, params.idOrAlias ?? "");
    if (template === undefined) throw templateNotFound(params.idOrAlias ?? "");
    return templateJson(template);
  },
});

defineRoute({
  method: "POST",
  path: "/templates",
  auth: "server",
  handler: ({ store, body, auth }) => {
    // An empty body is 1109 (refs/api_overview.md:86; INFERRED trigger).
    if (body === undefined || JSON.stringify(body) === "{}") {
      throw apiError(1109);
    }
    const input = parseOrReject(templateBody, body);
    const { state } = store;
    checkCanCreate(state, auth.server.ID);
    const draft: TemplateDraft = {
      TemplateId: 0,
      ServerID: auth.server.ID,
      Name: input.Name ?? "",
      Alias: input.Alias ?? null,
      Subject: input.Subject ?? null,
      HtmlBody: input.HtmlBody ?? null,
      TextBody: input.TextBody ?? null,
      TemplateType: parseTemplateType(input.TemplateType),
      LayoutTemplate: input.LayoutTemplate || null,
      Active: true,
    };
    checkTemplate(state, draft);
    const created = { ...draft, TemplateId: store.nextId("template") };
    const template: Template = {
      ...created,
      Alias: created.Alias ?? generatedAlias(state, created),
    };
    state.templates.set(template.TemplateId, template);
    return templateSummaryJson(template);
  },
});

// Edit changes only the fields sent: postmark.js sends `{Name}` alone, php sends only a layout
// (sdk/postmark.js/test/integration/Templates.test.ts:100; sdk/postmark-php/tests/PostmarkClientTemplatesTest.php:86).
defineRoute({
  method: "PUT",
  path: "/templates/:idOrAlias",
  auth: "server",
  handler: ({ store, body, params, auth }) => {
    const input = parseOrReject(templateBody, body ?? {});
    const { state } = store;
    const before = activeTemplate(state, auth.server.ID, params.idOrAlias ?? "");
    if (
      input.TemplateType !== undefined &&
      parseTemplateType(input.TemplateType) !== before.TemplateType
    ) {
      // "After creation, it's not possible to change a template type." (refs/api_templates-api.md:544)
      throw new Unsupported("the response to a TemplateType change is not captured");
    }
    const after: Template = {
      ...before,
      Name: input.Name ?? before.Name,
      Alias: input.Alias ?? before.Alias,
      Subject: input.Subject ?? before.Subject,
      HtmlBody: input.HtmlBody ?? before.HtmlBody,
      TextBody: input.TextBody ?? before.TextBody,
      LayoutTemplate:
        input.LayoutTemplate === undefined || input.LayoutTemplate === null
          ? before.LayoutTemplate
          : input.LayoutTemplate || null,
    };
    checkTemplate(state, after);
    checkLayoutChange(state, before, after);
    state.templates.set(after.TemplateId, after);
    return templateSummaryJson(after);
  },
});

defineRoute({
  method: "DELETE",
  path: "/templates/:idOrAlias",
  auth: "server",
  handler: ({ store, params, auth }) => {
    const { state } = store;
    const template = activeTemplate(state, auth.server.ID, params.idOrAlias ?? "");
    checkLayoutChange(state, template, null);
    state.templates.set(template.TemplateId, { ...template, Active: false });
    // refs/api_templates-api.md:769-771.
    return { ErrorCode: 0, Message: `Template ${template.TemplateId} removed.` };
  },
});

defineRoute({
  method: "POST",
  path: "/templates/validate",
  auth: "server",
  handler: ({ store, body, auth }) => validateTemplate(store.state, auth.server.ID, body ?? {}),
});

defineRoute({
  method: "POST",
  path: "/email/withTemplate",
  auth: "server",
  handler: (ctx) => sendWithTemplate(ctx, ctx.auth, ctx.body),
});

defineRoute({
  method: "POST",
  path: "/email/batchWithTemplates",
  auth: "server",
  handler: (ctx) => sendBatchWithTemplates(ctx, ctx.auth, ctx.body),
});
