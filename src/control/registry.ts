import { z } from "zod";
import { type Method, RouteTable } from "../http/routes.ts";
import type { Runtime } from "../runtime.ts";

/** A control request the test got wrong. Answers 400 `{"error": "..."}` (CONTROL-API.md). */
export class ControlError extends Error {}

export interface ControlContext extends Runtime {
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body; `undefined` when empty. */
  body: unknown;
  /** The seed postmock started with; `POST /control/reset` applies it again. */
  startupSeed: string;
}

export interface ControlRoute {
  method: Method;
  path: string;
  /** Returns the JSON body of a 200 response. */
  handler: (ctx: ControlContext) => unknown;
}

export const controlRoutes = new RouteTable<ControlRoute>();

/** Registers a control endpoint under `/control`. Each `src/control/<topic>.ts` calls it at import. */
export function defineControl(route: ControlRoute): void {
  if (!route.path.startsWith("/control/")) throw new Error(`control path ${route.path}`);
  controlRoutes.add(route);
}

/** Parses a control body with zod; a failure is a `ControlError` naming the fields. */
export function controlInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new ControlError(z.prettifyError(result.error));
  return result.data;
}
