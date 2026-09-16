import type { Seed } from "../../src/control/seed.ts";
import { addAccountToken, createServer } from "../../src/state/servers.ts";
import { CONFORMANCE } from "../lib/conformance.ts";

/** Account token and server 1 with the default streams. */
const core: Seed = ({ store, clock }) => {
  addAccountToken(store, CONFORMANCE.accountToken);
  createServer(store, clock.now(), {
    ID: CONFORMANCE.serverId,
    Name: CONFORMANCE.serverName,
    ApiTokens: [CONFORMANCE.serverToken],
  });
};
export default core;
