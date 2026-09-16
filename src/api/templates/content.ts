import { Unsupported } from "../../http/respond.ts";
import { parseTemplate, renderTemplate, type TemplateError } from "../../render/mustachio.ts";
import type { Template } from "../../state/types.ts";
import { CONTENT_PARTS, type Content } from "./templates.ts";

export type RenderOutcome = { ok: true; content: Content } | { ok: false; errors: TemplateError[] };

/**
 * Renders message content with a model, inside a layout when given: each layout body gets the
 * rendered template body at `{{{ @content }}}` (sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:219-221).
 * A part the template lacks stays null; the layout alone renders nothing (INFERRED).
 */
export function renderContent(
  content: Content,
  layout: Template | null,
  model: Record<string, unknown>,
  inlineCss: boolean,
): RenderOutcome {
  const out: Content = { Subject: null, HtmlBody: null, TextBody: null };
  for (const part of CONTENT_PARTS) {
    const source = content[part];
    if (source === null) continue;
    const parsed = parseTemplate(source);
    if (!parsed.ok) return parsed;
    let rendered = renderTemplate(parsed.template, model);
    const frame = part === "Subject" ? null : (layout?.[part] ?? null);
    if (frame !== null) {
      const parsedFrame = parseTemplate(frame);
      if (!parsedFrame.ok) return parsedFrame;
      rendered = renderTemplate(parsedFrame.template, model, rendered);
    }
    out[part] = rendered;
  }
  checkInlineCss(out.HtmlBody, inlineCss);
  return { ok: true, content: out };
}

/**
 * `InlineCss` (default true) moves `<style>` rules into `style` attributes (refs/api_templates-api.md:47).
 * The inliner's output is not captured, so HTML with a style block fails loudly.
 */
export function checkInlineCss(html: string | null, inlineCss: boolean): void {
  if (inlineCss && html !== null && /<style[\s>]/i.test(html)) {
    throw new Unsupported("CSS inlining of <style> blocks is not built; send InlineCss: false");
  }
}
