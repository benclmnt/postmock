import { z } from "zod";
import { apiError } from "../../errors.ts";
import { absent, intLike, parseBody } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import type { Store } from "../../state/store.ts";
import type { Template } from "../../state/types.ts";

// PUT /templates/push (docs/06 §3.4; refs/api_templates-api.md:353-430).

const pushSchema = z.object({
  SourceServerID: absent(intLike),
  DestinationServerID: absent(intLike),
  PerformChanges: z.boolean(),
});

// docs/06 §6: 100 templates per server.
const TEMPLATE_LIMIT = 100;

/** The fields a push copies; a template whose fields all match needs no change (INFERRED). */
const CONTENT = ["Name", "Subject", "HtmlBody", "TextBody", "LayoutTemplate"] as const;

interface PushAction {
  Action: "Create" | "Edit";
  TemplateId?: number;
  Alias: string;
  Name: string;
  TemplateType: Template["TemplateType"];
}

export function pushTemplates(
  store: Store,
  body: unknown,
): { TotalCount: number; Templates: PushAction[] } {
  const parsed = parseBody(pushSchema, body);
  if (!parsed.success) {
    throw new Unsupported(
      `push body: ${parsed.error.issues[0]?.message}: Postmark's answer is not captured`,
    );
  }
  const { SourceServerID, DestinationServerID, PerformChanges } = parsed.data;
  const { state } = store;
  const server = (id: number | undefined) => (id === undefined ? undefined : state.servers.get(id));
  const sourceServer = server(SourceServerID);
  const destinationServer = server(DestinationServerID);
  // Wire text from the live tests (sdk/postmark.js/test/integration/Templates.test.ts:178-211).
  if (sourceServer === undefined && destinationServer === undefined) {
    throw apiError(601, { message: "The source and destination servers were not found." });
  }
  if (destinationServer === undefined) {
    throw apiError(601, { message: "The destination server was not found." });
  }
  if (sourceServer === undefined)
    throw apiError(601, { message: "The source server was not found." });

  const active = (serverId: number) =>
    [...state.templates.values()]
      .filter((t) => t.ServerID === serverId && t.Active)
      .sort((a, b) => a.TemplateId - b.TemplateId);
  // Only templates with an alias are pushed; the destination matches by alias (refs/api_templates-api.md:359).
  const sources = active(sourceServer.ID).filter(
    (t): t is Template & { Alias: string } => t.Alias !== null,
  );
  if (sources.length === 0) {
    // The message is INFERRED (a summary row).
    throw apiError(1124, { message: "No templates with aliases found to push." });
  }
  const destination = active(destinationServer.ID);
  // Aliases compare without case (INFERRED).
  const byAlias = new Map(destination.map((t) => [t.Alias?.toLowerCase(), t]));

  const changes = sources.flatMap((source) => {
    const target = byAlias.get(source.Alias.toLowerCase());
    if (target !== undefined && target.TemplateType !== source.TemplateType) throw apiError(1125);
    if (target !== undefined && CONTENT.every((key) => target[key] === source[key])) return [];
    return [{ source, target }];
  });
  const creates = changes.filter((c) => c.target === undefined).length;
  if (destination.length + creates > TEMPLATE_LIMIT) throw apiError(1105);

  const templates = changes.map(({ source, target }): PushAction => {
    let templateId = target?.TemplateId;
    if (PerformChanges) {
      const content = Object.fromEntries(CONTENT.map((key) => [key, source[key]]));
      if (target !== undefined) Object.assign(target, content);
      else {
        templateId = store.nextId("template");
        state.templates.set(templateId, {
          ...source,
          TemplateId: templateId,
          ServerID: destinationServer.ID,
        });
      }
    }
    return {
      Action: target === undefined ? "Create" : "Edit",
      // postmark.js types TemplateId as optional; a dry-run Create has no destination template yet,
      // so it omits TemplateId (INFERRED; the doc example is a real push, refs/api_templates-api.md:420-428).
      ...(templateId !== undefined && { TemplateId: templateId }),
      Alias: source.Alias,
      Name: source.Name,
      TemplateType: source.TemplateType,
    };
  });
  return { TotalCount: templates.length, Templates: templates };
}
