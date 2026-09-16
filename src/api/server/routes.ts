import { defineRoute } from "../../http/routes.ts";
import { editServer } from "../account/servers.ts";
import { serverJson } from "./json.ts";

// refs/api_server-api.md:10-80 (docs/06 §4.1). `PUT /server` below.
defineRoute({
  method: "GET",
  path: "/server",
  auth: "server",
  handler: ({ auth }) => serverJson(auth.server),
});

// refs/api_server-api.md:93-200 (docs/06 §4.1). The Servers API edit takes the same body.
defineRoute({
  method: "PUT",
  path: "/server",
  auth: "server",
  handler: ({ store, body, auth }) => serverJson(editServer(store.state, auth.server, body)),
});
