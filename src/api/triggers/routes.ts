import { z } from "zod";
import { apiError } from "../../errors.ts";
import { parseBody, queryInt } from "../../http/normalize.ts";
import { paged } from "../../http/respond.ts";
import { defineRoute } from "../../http/routes.ts";

// Inbound rule triggers (docs/05 §1.6). postmark.js and java spell the path `inboundRules`; route
// literals match without case.

const MAX_COUNT = 500;

defineRoute({
  method: "GET",
  path: "/triggers/inboundrules",
  auth: "server",
  handler: ({ store, query, auth }) => {
    const parsed = query.pick(z.object({ count: queryInt, offset: queryInt }));
    // 800 texts INFERRED from the docs/02 §4.4 summary.
    if (!parsed.success || parsed.data.count < 0 || parsed.data.offset < 0) {
      throw apiError(800, {
        message: "The 'count' and 'offset' parameters are required integers.",
      });
    }
    const { count, offset } = parsed.data;
    if (count > MAX_COUNT) {
      throw apiError(800, { message: "You may only request up to 500 triggers per call." });
    }
    const rules = [...store.state.inboundRules.values()]
      .filter((r) => r.ServerID === auth.server.ID)
      .map((r) => ({ ID: r.ID, Rule: r.Rule }));
    return paged("InboundRules", rules, count, offset);
  },
});

defineRoute({
  method: "POST",
  path: "/triggers/inboundrules",
  auth: "server",
  handler: ({ store, body, auth }) => {
    const parsed = parseBody(z.object({ Rule: z.string().trim().min(1) }), body);
    // A rule is an address or a domain (refs/api_inbound-rules-triggers-api.md:98); postmock checks
    // no form (INFERRED).
    if (!parsed.success) throw apiError(809);
    const rule = parsed.data.Rule;
    const rules = [...store.state.inboundRules.values()].filter(
      (r) => r.ServerID === auth.server.ID,
    );
    if (rules.some((r) => r.Rule.toLowerCase() === rule.toLowerCase())) throw apiError(810);
    const created = { ID: store.nextId("inboundRule"), ServerID: auth.server.ID, Rule: rule };
    store.state.inboundRules.set(created.ID, created);
    return { ID: created.ID, Rule: created.Rule };
  },
});

defineRoute({
  method: "DELETE",
  path: "/triggers/inboundrules/:id",
  auth: "server",
  handler: ({ store, params, auth }) => {
    const id = /^\d+$/.test(params.id ?? "") ? Number(params.id) : undefined;
    const rule = id === undefined ? undefined : store.state.inboundRules.get(id);
    if (rule === undefined || rule.ServerID !== auth.server.ID) throw apiError(812);
    store.state.inboundRules.delete(rule.ID);
    return { ErrorCode: 0, Message: `Rule ${rule.Rule} removed.` };
  },
});
