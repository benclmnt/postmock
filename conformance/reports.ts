// Readers for the XML test reports the non-Node suites write: JUnit (phpunit, surefire) and TRX
// (dotnet test). Each reads only the elements and attributes the runners need.

export interface ReportCase {
  /** Attributes of the test element. */
  attrs: Record<string, string>;
  state: "pass" | "fail" | "skip";
  error?: string;
}

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, entity: string) => {
    const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return named[entity.toLowerCase()] ?? "";
  });

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[match[1] as string] = decode(match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Each `<name …>…</name>` or `<name …/>`: its attributes and inner XML. */
function elements(
  xml: string,
  name: string,
): Array<{ attrs: Record<string, string>; body: string }> {
  const found: Array<{ attrs: Record<string, string>; body: string }> = [];
  const open = new RegExp(`<${name}(\\s[^>]*?)?(/?)>`, "g");
  for (let match = open.exec(xml); match !== null; match = open.exec(xml)) {
    const attrs = attributes(match[1] ?? "");
    if (match[2] === "/") {
      found.push({ attrs, body: "" });
      continue;
    }
    const close = xml.indexOf(`</${name}>`, open.lastIndex);
    if (close === -1) throw new Error(`<${name}> has no closing tag`);
    found.push({ attrs, body: xml.slice(open.lastIndex, close) });
    open.lastIndex = close;
  }
  return found;
}

const text = (body: string) =>
  decode(body.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "")).trim();

/** JUnit XML: every `<testcase>`, with `<failure>` or `<error>` as fail and `<skipped>` as skip. */
export function parseJUnit(xml: string): ReportCase[] {
  return elements(xml, "testcase").map(({ attrs, body }) => {
    const problem = [...elements(body, "failure"), ...elements(body, "error")][0];
    if (problem) {
      const message = problem.attrs.message ?? "";
      return { attrs, state: "fail", error: message !== "" ? message : text(problem.body) };
    }
    if (elements(body, "skipped").length > 0) return { attrs, state: "skip" };
    return { attrs, state: "pass" };
  });
}

/** TRX (Visual Studio test results): every `<UnitTestResult>` by `outcome`. */
export function parseTrx(xml: string): ReportCase[] {
  return elements(xml, "UnitTestResult").map(({ attrs, body }) => {
    const outcome = attrs.outcome ?? "";
    if (outcome === "Passed") return { attrs, state: "pass" };
    if (outcome === "NotExecuted") return { attrs, state: "skip" };
    const message = elements(body, "Message")[0];
    return { attrs, state: "fail", error: message ? text(message.body) : outcome };
  });
}
