import type { z } from "zod";
import { apiError } from "../../errors.ts";
import { parseBody } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import { parseTemplate } from "../../render/mustachio.ts";
import type { State } from "../../state/store.ts";
import type { Template } from "../../state/types.ts";

// Templates API rules (docs/06 §3.1–§3.2). Messages marked INFERRED have no documented text.

export const TEMPLATE_TYPES = ["Standard", "Layout"] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const CONTENT_PARTS = ["Subject", "HtmlBody", "TextBody"] as const;
export type ContentPart = (typeof CONTENT_PARTS)[number];
export type Content = Record<ContentPart, string | null>;

/** ErrorCode 403 for a field of the wrong type, as in the send pipeline (docs/02 §9 Q13, INFERRED). */
export const invalidField = (field: string) =>
  apiError(403, { message: `Invalid request field(s): '${field}'.` });

/** Parses a body with zod; a failure is 403 naming the first bad field. */
export function parseOrReject<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Unsupported("a send body that is not a JSON object is not captured");
  }
  const result = parseBody(schema, body);
  if (!result.success) throw invalidField(String(result.error.issues[0]?.path[0]));
  return result.data;
}

/** `Standard` (default) or `Layout` (refs/api_templates-api.md:544); another value is 1122 (INFERRED text). */
export function parseTemplateType(value: string | undefined): TemplateType {
  const type = TEMPLATE_TYPES.find((t) => t === (value ?? "Standard"));
  if (type === undefined) {
    throw apiError(1122, {
      message: `Invalid 'TemplateType': '${value}'. Use Standard or Layout.`,
    });
  }
  return type;
}

// refs/api_templates-api.md:466.
const ALIAS = /^[A-Za-z][A-Za-z0-9._-]*$/;
// refs/api_templates-api.md:6.
const MAX_TEMPLATES = 100;

/**
 * The template a path or send names: digits are an ID (an alias starts with a letter), anything
 * else an alias. An alias matches exactly, active templates first (INFERRED).
 */
export function findTemplate(
  state: State,
  serverId: number,
  idOrAlias: string,
): Template | undefined {
  const own = [...state.templates.values()].filter((t) => t.ServerID === serverId);
  if (/^\d+$/.test(idOrAlias)) return own.find((t) => t.TemplateId === Number(idOrAlias));
  const matches = own.filter((t) => t.Alias === idOrAlias);
  return matches.find((t) => t.Active) ?? matches[0];
}

/**
 * 1101. The alias text is SDK-quoted (sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:248);
 * the ID text follows it (INFERRED, docs/06 Q9).
 */
export const templateNotFound = (field: "Alias" | "TemplateId") =>
  apiError(1101, {
    message: `The Template's '${field}' associated with this request is not valid or was not found.`,
  });

export function activeTemplate(state: State, serverId: number, idOrAlias: string): Template {
  const template = findTemplate(state, serverId, idOrAlias);
  if (template?.Active !== true)
    throw templateNotFound(/^\d+$/.test(idOrAlias) ? "TemplateId" : "Alias");
  return template;
}

/** An active layout by alias; a missing or standard one is 1101 (refs/api_overview.md:84). */
export function activeLayout(state: State, serverId: number, alias: string): Template {
  const layout = findTemplate(state, serverId, alias);
  if (layout?.Active !== true || layout.TemplateType !== "Layout") throw templateNotFound("Alias");
  return layout;
}

const layoutUsers = (state: State, layout: Template): Template[] =>
  [...state.templates.values()].filter(
    (t) => t.Active && t.ServerID === layout.ServerID && t.LayoutTemplate === layout.Alias,
  );

/**
 * The placeholder rule for one part: a layout body holds `{{{ @content }}}` exactly once
 * (refs/api_templates-api.md:541-542); a standard template holds none (INFERRED).
 */
export function layoutRuleError(
  type: TemplateType,
  part: ContentPart,
  placeholders: number,
): string | undefined {
  if (type === "Layout" && part !== "Subject" && placeholders !== 1) {
    return `The layout content placeholder must be present exactly once in the ${part}.`;
  }
  if ((type === "Standard" || part === "Subject") && placeholders > 0) {
    return `The layout content placeholder is only allowed in the body of a layout template.`;
  }
  return undefined;
}

/**
 * Checks a template as it will be stored, after create or edit. Error codes per docs/02 §4.4;
 * every message is INFERRED except the 1131 prefix the postmark.js live test reads
 * (sdk/postmark.js/test/integration/Templates.test.ts:122).
 */
export function checkTemplate(state: State, template: Template): void {
  if (template.Name === "") throw apiError(1120, { message: "The 'Name' field is required." });
  if (template.HtmlBody === null && template.TextBody === null) {
    throw apiError(1120, { message: "Either 'HtmlBody' or 'TextBody' must be specified." });
  }
  if (template.Alias !== null) {
    if (!ALIAS.test(template.Alias)) {
      throw apiError(1122, {
        message: `The 'Alias' '${template.Alias}' is invalid. It must start with a letter and contain only letters, numbers, '.', '-' and '_'.`,
      });
    }
    const other = findTemplate(state, template.ServerID, template.Alias);
    if (other?.Active && other.TemplateId !== template.TemplateId) {
      throw apiError(1122, { message: `The 'Alias' '${template.Alias}' is already in use.` });
    }
  }
  if (template.TemplateType === "Layout") {
    if (template.Subject !== null) {
      throw apiError(1123, { message: "A layout template cannot have a 'Subject'." });
    }
    if (template.LayoutTemplate !== null) {
      throw apiError(1123, { message: "A layout template cannot use a 'LayoutTemplate'." });
    }
  } else {
    if (template.Subject === null) {
      throw apiError(1120, { message: "The 'Subject' field is required." });
    }
    if (template.LayoutTemplate !== null)
      activeLayout(state, template.ServerID, template.LayoutTemplate);
  }
  for (const part of CONTENT_PARTS) {
    const source = template[part];
    if (source === null) continue;
    const parsed = parseTemplate(source);
    if (!parsed.ok) {
      throw apiError(1122, {
        message: `The '${part}' content is invalid: ${parsed.errors[0]?.Message}`,
      });
    }
    const placeholder = layoutRuleError(
      template.TemplateType,
      part,
      parsed.template.contentPlaceholders,
    );
    if (placeholder !== undefined) throw apiError(1131, { message: placeholder });
  }
}

export function checkCanCreate(state: State, serverId: number): void {
  const active = [...state.templates.values()].filter((t) => t.ServerID === serverId && t.Active);
  if (active.length >= MAX_TEMPLATES) throw apiError(1105);
}

/** A layout that templates use keeps its alias and cannot be deleted. */
export function checkLayoutChange(state: State, before: Template, after: Template | null): void {
  if (before.TemplateType !== "Layout" || layoutUsers(state, before).length === 0) return;
  if (after === null) throw apiError(1130);
  if (after.Alias !== before.Alias) {
    throw new Unsupported("renaming the alias of a layout in use is not captured");
  }
}

/**
 * A new layout without an alias gets one: the dotnet and php live tests read a layout alias they
 * never set (sdk/postmark-php/tests/PostmarkClientTemplatesTest.php:55-57). The format is INFERRED.
 */
export function generatedLayoutAlias(state: State, template: Template): string {
  for (let n = 0; ; n += 1) {
    const alias = n === 0 ? `layout-${template.TemplateId}` : `layout-${template.TemplateId}-${n}`;
    if (findTemplate(state, template.ServerID, alias)?.Active !== true) return alias;
  }
}

/** GET response, doc field order (refs/api_templates-api.md:457-468). */
export const templateJson = (t: Template) => ({
  Name: t.Name,
  TemplateId: t.TemplateId,
  Subject: t.Subject,
  HtmlBody: t.HtmlBody,
  TextBody: t.TextBody,
  AssociatedServerId: t.ServerID,
  Active: t.Active,
  Alias: t.Alias,
  TemplateType: t.TemplateType,
  LayoutTemplate: t.LayoutTemplate,
});

/** List item (refs/api_templates-api.md:712-731). */
export const templateListJson = (t: Template) => ({
  Active: t.Active,
  TemplateId: t.TemplateId,
  Name: t.Name,
  Alias: t.Alias,
  TemplateType: t.TemplateType,
  LayoutTemplate: t.LayoutTemplate,
});

/**
 * Create and edit response (refs/api_templates-api.md:565-585). The edit doc omits `TemplateType`;
 * postmark-python requires it (sdk/postmark-python/postmark/models/templates/schemas.py:114).
 */
export const templateSummaryJson = (t: Template) => ({
  TemplateId: t.TemplateId,
  Name: t.Name,
  Active: t.Active,
  Alias: t.Alias,
  TemplateType: t.TemplateType,
  LayoutTemplate: t.LayoutTemplate,
});
