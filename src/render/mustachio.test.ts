import { describe, expect, it } from "vitest";
import { Unsupported } from "../http/respond.ts";
import {
  mergeModels,
  type ParsedTemplate,
  parseTemplate,
  renderTemplate,
  suggestModel,
} from "./mustachio.ts";

const parse = (source: string): ParsedTemplate => {
  const result = parseTemplate(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.template;
};
const render = (source: string, model: unknown, content?: string) =>
  renderTemplate(parse(source), model, content);

describe("rendering (docs/06 §3.5)", () => {
  it("interpolates dot paths with spaces inside the braces", () => {
    expect(render("Hello {{ person.first_name }}", { person: { first_name: "Andrew" } })).toBe(
      "Hello Andrew",
    );
  });

  it("scopes a section and skips it for a missing, null, false or empty value", () => {
    const source = "{{#person}}Hi {{first_name}}{{/person}}";
    expect(render(source, { person: { first_name: "Ann" } })).toBe("Hi Ann");
    for (const person of [undefined, null, false, "", []]) {
      expect(render(source, { person })).toBe("");
    }
  });

  it("iterates #each and reaches up with ../ per scope level", () => {
    const model = { company: "ACME", employees: [{ name: "Wile" }, { name: "Road" }] };
    expect(render("{{#each employees}}[{{name}}@{{../../company}}]{{/each}}", model)).toBe(
      "[Wile@ACME][Road@ACME]",
    );
  });

  it("renders the current value with {{.}} and inverted groups when absent", () => {
    const source = "{{#position}}as {{.}}{{/position}}{{^years}}since ever{{/years}}";
    expect(render(source, { position: "Tester" })).toBe("as Testersince ever");
    expect(render(source, { years: 3 })).toBe("");
  });

  it("HTML-encodes {{x}} and keeps {{{x}}} and {{& x}} raw", () => {
    const model = { x: `<b>"Tom" & 'Jerry'</b>` };
    expect(render("{{x}}", model)).toBe("&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;");
    expect(render("{{{ x }}}|{{& x}}", model)).toBe(`${model.x}|${model.x}`);
  });

  it("renders a missing value as an empty string", () => {
    expect(render("a{{missing.deep}}b", {})).toBe("ab");
  });

  it("fills the layout placeholder and keeps the unsubscribe placeholder", () => {
    expect(render("<h1>{{{ @content }}}</h1>{{{ pm:unsubscribe }}}", {}, "body")).toBe(
      "<h1>body</h1>{{{ pm:unsubscribe }}}",
    );
    expect(parse("{{{@content}}} {{{ @content }}}").contentPlaceholders).toBe(2);
  });

  it("fails loudly where the article gives no rule", () => {
    expect(() => render("{{#list}}x{{/list}}", { list: [1] })).toThrow(Unsupported);
    expect(() => render("{{obj}}", { obj: { a: 1 } })).toThrow(Unsupported);
    expect(() => parseTemplate("{{! comment }}")).toThrow(Unsupported);
  });
});

describe("syntax errors", () => {
  it("reports each error with a 1-based line and character position", () => {
    const result = parseTemplate("ok\n  {{bad path}}\n{{#open}}");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => [e.Line, e.CharacterPosition])).toEqual([
      [2, 3],
      [3, 1],
    ]);
  });

  it("rejects a mismatched close and an unterminated tag", () => {
    expect(parseTemplate("{{#a}}{{/b}}").ok).toBe(false);
    expect(parseTemplate("{{#each a}}{{/a}}").ok).toBe(false);
    expect(parseTemplate("<p>{{unclosed").ok).toBe(false);
    expect(parseTemplate("{{#each a}}{{/each}}").ok).toBe(true);
    const badPath = parseTemplate("{{#bad path}}x{{/bad path}}");
    expect(badPath.ok === false && badPath.errors.length).toBe(1);
  });
});

describe("suggested model", () => {
  it("matches the validate doc example, with three items per list (dotnet live test)", () => {
    const templates = [
      "{{#company}}{{name}}{{/company}} {{subjectHeadline}}",
      "{{#company}}{{address}}{{/company}}{{#each person}} {{name}} {{/each}}",
    ].map(parse);
    const person = { name: "name_Value" };
    expect(suggestModel(templates)).toEqual({
      company: { name: "name_Value", address: "address_Value" },
      subjectHeadline: "subjectHeadline_Value",
      person: [person, person, person],
    });
  });

  it("infers dot paths and empty lists", () => {
    expect(suggestModel([parse("{{company.address}}{{#each products}}{{/each}}")])).toEqual({
      company: { address: "address_Value" },
      products: ["products_Value", "products_Value", "products_Value"],
    });
  });

  it("merges the test render model over the suggestion", () => {
    expect(
      mergeModels(
        { company: { name: "name_Value", phone: "phone_Value" } },
        {
          userName: "bobby",
          company: { name: "ACME" },
        },
      ),
    ).toEqual({ userName: "bobby", company: { name: "ACME", phone: "phone_Value" } });
  });
});
