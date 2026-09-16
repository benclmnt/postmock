import type { Seed } from "../../src/control/seed.ts";
import { CONFORMANCE } from "../lib/conformance.ts";

/**
 * The conformance server is yellow, the color the dotnet server test leaves after its reset. That
 * test sets purple and asserts the color changed
 * (sdk/postmark-dotnet/src/Postmark.Tests/ClientServerInformationTests.cs:76-98).
 */
const serverColor: Seed = ({ store }) => {
  const server = store.state.servers.get(CONFORMANCE.serverId);
  if (server === undefined) throw new Error("the core seed part creates the conformance server");
  server.Color = "yellow";
};
export default serverColor;
