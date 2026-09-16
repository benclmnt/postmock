import { z } from "zod";
import { apiError } from "../../errors.ts";
import { absent, objectOrEmptyArray } from "../../http/normalize.ts";
import {
  mergeModels,
  type ParsedTemplate,
  parseTemplate,
  renderTemplate,
  suggestModel,
  type TemplateError,
} from "../../render/mustachio.ts";
import type { State } from "../../state/store.ts";
import { checkInlineCss } from "./content.ts";
import {
  activeLayout,
  CONTENT_PARTS,
  type ContentPart,
  layoutRuleError,
  parseOrReject,
  parseTemplateType,
} from "./templates.ts";

// `POST /templates/validate` (docs/06 §3.3; refs/api_templates-api.md:779-887).

const text = absent(z.string());

const validateBody = z.object({
  Subject: text,
  HtmlBody: text,
  TextBody: text,
  TestRenderModel: z.preprocess(
    (v) => (v === null ? undefined : v),
    objectOrEmptyArray(z.record(z.string(), z.unknown())).optional(),
  ),
  InlineCssForHtmlTestRender: absent(z.boolean()),
  TemplateType: text,
  LayoutTemplate: text,
});

interface PartResult {
  ContentIsValid: boolean;
  ValidationErrors: TemplateError[];
  RenderedContent: string | null;
}

export function validateTemplate(state: State, serverId: number, body: unknown) {
  const input = parseOrReject(validateBody, body);
  if (CONTENT_PARTS.every((part) => input[part] === undefined)) {
    // refs/api_templates-api.md:813-815: one part is required. Code and text INFERRED.
    throw apiError(1120, { message: "One of 'Subject', 'HtmlBody' or 'TextBody' is required." });
  }
  const type = parseTemplateType(input.TemplateType);
  if (type === "Layout" && input.LayoutTemplate !== undefined) {
    throw apiError(1123, { message: "A layout template cannot use a 'LayoutTemplate'." });
  }
  const layout =
    input.LayoutTemplate === undefined ? null : activeLayout(state, serverId, input.LayoutTemplate);

  const parsed = new Map<ContentPart, ParsedTemplate>();
  const results = new Map<ContentPart, PartResult>();
  for (const part of CONTENT_PARTS) {
    const source = input[part];
    if (source === undefined) continue;
    const result = parseTemplate(source);
    const ruleError = result.ok
      ? layoutRuleError(type, part, result.template.contentPlaceholders)
      : undefined;
    if (!result.ok || ruleError !== undefined) {
      // RenderedContent is null for invalid content (INFERRED, docs/06 Q7).
      const errors = result.ok
        ? [{ Message: ruleError ?? "", Line: null, CharacterPosition: null }]
        : result.errors;
      results.set(part, { ContentIsValid: false, ValidationErrors: errors, RenderedContent: null });
    } else {
      parsed.set(part, result.template);
    }
  }

  // The layout's own keys join the suggestion (INFERRED).
  const frames = new Map<ContentPart, ParsedTemplate>();
  for (const part of ["HtmlBody", "TextBody"] as const) {
    const source = layout?.[part] ?? null;
    const frame = source === null ? undefined : parseTemplate(source);
    if (frame?.ok) frames.set(part, frame.template);
  }
  const SuggestedTemplateModel = mergeModels(
    suggestModel([...parsed.values(), ...frames.values()]),
    input.TestRenderModel ?? {},
  );

  for (const [part, template] of parsed) {
    // A layout renders with an empty `{{{ @content }}}` (INFERRED).
    let rendered = renderTemplate(template, SuggestedTemplateModel);
    const frame = frames.get(part);
    if (frame !== undefined) rendered = renderTemplate(frame, SuggestedTemplateModel, rendered);
    if (part === "HtmlBody") checkInlineCss(rendered, input.InlineCssForHtmlTestRender ?? true);
    results.set(part, { ContentIsValid: true, ValidationErrors: [], RenderedContent: rendered });
  }

  // A part not sent is null (INFERRED from sdk/postmark-python/tests/test_templates.py:373-375).
  return {
    AllContentIsValid: [...results.values()].every((r) => r.ContentIsValid),
    HtmlBody: results.get("HtmlBody") ?? null,
    TextBody: results.get("TextBody") ?? null,
    Subject: results.get("Subject") ?? null,
    SuggestedTemplateModel,
  };
}
