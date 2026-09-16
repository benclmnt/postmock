import { defineRoute } from "../../http/routes.ts";
import { serverJson } from "./json.ts";

// refs/api_server-api.md:10-80 (docs/06 §4.1). `PUT /server` belongs to T5 (hook fields).
defineRoute({
  method: "GET",
  path: "/server",
  auth: "server",
  handler: ({ auth }) => serverJson(auth.server),
});
