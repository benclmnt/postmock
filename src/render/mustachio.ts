import { Unsupported } from "../http/respond.ts";

// Mustachio, the Postmark template language (docs/06 §3.5; refs/support_article_1077-template-syntax.md).
// Rules the article does not state are INFERRED and marked where they apply.

/** `up` counts `../` prefixes; empty `keys` is `{{.}}`. */
interface Path {
  raw: string;
  up: number;
  keys: string[];
}

interface Position {
  line: number;
  column: number;
}

type Node =
  | { kind: "text"; text: string }
  | { kind: "value"; path: Path; escape: boolean }
  | { kind: "section"; path: Path; inverted: boolean; children: Node[] }
  | { kind: "each"; path: Path; children: Node[] }
  /** `{{{ @content }}}`: where a layout takes the template (article :320-326). */
  | { kind: "content" };

/** A `/templates/validate` error: 1-based, `null` when unknown (refs/api_templates-api.md:842). */
export interface TemplateError {
  Message: string;
  Line: number | null;
  CharacterPosition: number | null;
}

export interface ParsedTemplate {
  nodes: Node[];
  /** Number of `{{{ @content }}}` placeholders. */
  contentPlaceholders: number;
}

export type ParseResult =
  | { ok: true; template: ParsedTemplate }
  | { ok: false; errors: TemplateError[] };

// Postmark renders the unsubscribe placeholder at send time on broadcast streams (docs/03 §5.4);
// the renderer keeps it as written.
const UNSUBSCRIBE = /^pm:unsubscribe$/;
const CONTENT = /^@content$/;
// Key characters: letters, digits, `_`, `-` (INFERRED; the article shows only word keys).
const PATH = /^((?:\.\.\/)*)([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)$/u;

// Error texts are INFERRED: only "The syntax for this template is invalid." is documented
// (refs/api_templates-api.md:862).
const messages = {
  syntax: "The syntax for this template is invalid.",
  path: (raw: string) =>
    `The path '${raw}' is not valid. Please see documentation for examples of valid paths.`,
  unclosed: (raw: string) =>
    `A block for the path '${raw}' was opened but not closed. Close it with '{{/${raw}}}'.`,
  unopened: (raw: string) =>
    `A closing tag '{{/${raw}}}' was found without a matching opening tag.`,
};

function parsePath(raw: string): Path | undefined {
  if (raw === ".") return { raw, up: 0, keys: [] };
  const match = PATH.exec(raw);
  if (!match) return undefined;
  return { raw, up: (match[1] ?? "").length / 3, keys: (match[2] ?? "").split(".") };
}

function positionOf(source: string, index: number): Position {
  const before = source.slice(0, index);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: index - lineStart + 1 };
}

interface Open {
  node: Extract<Node, { kind: "section" | "each" }>;
  closeName: string;
  at: Position;
}

/** Parses Mustachio source. Every syntax error is collected with its position. */
export function parseTemplate(source: string): ParseResult {
  const errors: TemplateError[] = [];
  const root: Node[] = [];
  const stack: Open[] = [];
  let contentPlaceholders = 0;
  const target = () => stack.at(-1)?.node.children ?? root;
  const fail = (message: string, at: Position) =>
    errors.push({ Message: message, Line: at.line, CharacterPosition: at.column });

  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("{{", index);
    if (open === -1) {
      target().push({ kind: "text", text: source.slice(index) });
      break;
    }
    if (open > index) target().push({ kind: "text", text: source.slice(index, open) });
    const at = positionOf(source, open);
    const triple = source.startsWith("{{{", open);
    const closer = triple ? "}}}" : "}}";
    const end = source.indexOf(closer, open + closer.length);
    // An unterminated tag is an error, not text (INFERRED).
    if (end === -1) {
      fail(messages.syntax, at);
      break;
    }
    const tag = source.slice(open, end + closer.length);
    const inner = source.slice(open + closer.length, end).trim();
    index = end + closer.length;

    if (UNSUBSCRIBE.test(inner)) {
      target().push({ kind: "text", text: tag });
      continue;
    }
    if (triple || inner.startsWith("&")) {
      const raw = triple ? inner : inner.slice(1).trim();
      if (triple && CONTENT.test(raw)) {
        contentPlaceholders += 1;
        target().push({ kind: "content" });
        continue;
      }
      const path = parsePath(raw);
      if (path) target().push({ kind: "value", path, escape: false });
      else fail(messages.path(raw), at);
      continue;
    }
    const sigil = inner.charAt(0);
    if (sigil === "!" || sigil === ">" || sigil === "=") {
      // Comments, partials and delimiter changes are not in the article.
      throw new Unsupported(`Mustachio tag '${tag}' is not documented (docs/06 §3.5)`);
    }
    if (sigil === "#" || sigil === "^") {
      const body = inner.slice(1).trim();
      const each = sigil === "#" ? /^each\s+(.+)$/.exec(body) : null;
      const raw = each ? (each[1] ?? "").trim() : body;
      // A bad path still opens a block, so its close tag adds no second error.
      const path = parsePath(raw) ?? { raw, up: 0, keys: [] };
      if (path.keys.length === 0 && raw !== ".") fail(messages.path(raw), at);
      const node: Open["node"] = each
        ? { kind: "each", path, children: [] }
        : { kind: "section", path, inverted: sigil === "^", children: [] };
      target().push(node);
      stack.push({ node, closeName: each ? "each" : raw, at });
      continue;
    }
    if (sigil === "/") {
      const name = inner.slice(1).trim();
      if (stack.at(-1)?.closeName === name) stack.pop();
      else fail(messages.unopened(name), at);
      continue;
    }
    const path = parsePath(inner);
    if (path) target().push({ kind: "value", path, escape: true });
    else fail(messages.path(inner), at);
  }
  for (const open of stack) {
    fail(messages.unclosed(open.node.path.raw), open.at);
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, template: { nodes: root, contentPlaceholders } };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function resolve(path: Path, scopes: readonly unknown[]): unknown {
  // Each `../` leaves one scope; `{{#each}}` opens two: the collection, then the item (article :98-107).
  let value = scopes[scopes.length - 1 - path.up];
  for (const key of path.keys) {
    value = isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
  }
  return value;
}

// Missing, null, false and empty values skip a section (article :111, :264). Zero skips it too
// (INFERRED, as in Mustache).
const truthy = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  value !== false &&
  value !== 0 &&
  value !== "" &&
  !(Array.isArray(value) && value.length === 0);

// `{{x}}` HTML-encodes in every part (article :300). The encoded set is INFERRED.
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

function scalarText(value: unknown, raw: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  // .NET prints booleans as True/False (INFERRED).
  if (typeof value === "boolean") return value ? "True" : "False";
  throw new Unsupported(`rendering the object or array at '{{${raw}}}' is not captured`);
}

/**
 * Renders a parsed template with a model. `content` fills `{{{ @content }}}` in a layout.
 * A missing value renders as "" (docs/06 §3.5, INFERRED).
 */
export function renderTemplate(template: ParsedTemplate, model: unknown, content = ""): string {
  const renderNode = (node: Node, scopes: readonly unknown[]): string => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "content":
        return content;
      case "value": {
        const text = scalarText(resolve(node.path, scopes), node.path.raw);
        return node.escape ? escapeHtml(text) : text;
      }
      case "section": {
        const value = resolve(node.path, scopes);
        if (node.inverted) return truthy(value) ? "" : render(node.children, scopes);
        if (!truthy(value)) return "";
        // Mustache iterates here; the article iterates only with `#each`.
        if (Array.isArray(value)) {
          throw new Unsupported(`'{{#${node.path.raw}}}' on a list is not captured; use #each`);
        }
        return render(node.children, [...scopes, value]);
      }
      case "each": {
        const value = resolve(node.path, scopes);
        if (!truthy(value)) return "";
        if (!Array.isArray(value)) {
          throw new Unsupported(`'{{#each ${node.path.raw}}}' on a non-list is not captured`);
        }
        return value.map((item) => render(node.children, [...scopes, value, item])).join("");
      }
    }
  };
  const render = (nodes: readonly Node[], scopes: readonly unknown[]): string =>
    nodes.map((node) => renderNode(node, scopes)).join("");
  return render(template.nodes, [model]);
}

interface Inferred {
  usage: "value" | "object" | "collection";
  children: Map<string, Inferred>;
}

const newInferred = (): Inferred => ({ usage: "value", children: new Map() });

/** Collects every key a template reads into `into` (root of the suggested model). */
function inferInto(template: ParsedTemplate, into: Inferred): void {
  // A scope entry is null where no key can be added: the list level of `#each`.
  const walk = (nodes: readonly Node[], scopes: readonly (Inferred | null)[]) => {
    for (const node of nodes) {
      if (node.kind === "text" || node.kind === "content") continue;
      let target = scopes[scopes.length - 1 - node.path.up] ?? null;
      node.path.keys.forEach((key) => {
        if (target === null) return;
        if (target.usage === "value") target.usage = "object";
        const child = target.children.get(key) ?? newInferred();
        target.children.set(key, child);
        target = child;
      });
      if (node.kind === "value") continue;
      if (target === null || node.path.keys.length === 0) {
        const inner = node.kind === "each" ? [null, target] : [target];
        walk(node.children, [...scopes, ...inner]);
        continue;
      }
      if (node.kind === "each") {
        target.usage = "collection";
        walk(node.children, [...scopes, null, target]);
      } else {
        if (target.usage === "value") target.usage = "object";
        walk(node.children, [...scopes, target]);
      }
    }
  };
  walk(template.nodes, [into]);
}

function modelOf(key: string, node: Inferred): unknown {
  const inner = (): unknown =>
    node.children.size === 0
      ? `${key}_Value`
      : Object.fromEntries([...node.children].map(([k, child]) => [k, modelOf(k, child)]));
  // A list gets three items: sdk/postmark-dotnet/src/Postmark.Tests/ClientTemplateTests.cs:203-205.
  if (node.usage === "collection") return [inner(), inner(), inner()];
  return inner();
}

/**
 * `SuggestedTemplateModel`: a placeholder `<key>_Value` for every key the templates read
 * (refs/api_templates-api.md:844, :873-886).
 */
export function suggestModel(templates: readonly ParsedTemplate[]): Record<string, unknown> {
  const root = newInferred();
  for (const template of templates) inferInto(template, root);
  return Object.fromEntries([...root.children].map(([k, child]) => [k, modelOf(k, child)]));
}

/** Deep merge; `override` values win and its keys come first (refs/api_templates-api.md:873-886). */
export function mergeModels(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(override)) {
    const under = base[key];
    out[key] = isObject(value) && isObject(under) ? mergeModels(under, value) : value;
  }
  for (const [key, value] of Object.entries(base)) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}
