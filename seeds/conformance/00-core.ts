import type { Seed } from "../../src/control/seed.ts";
import { createServer } from "../../src/state/servers.ts";
import { CONFORMANCE } from "../lib/conformance.ts";

/** Account token and server 1 with the default streams. */
const core: Seed = ({ store, clock }) => {
  store.state.account.tokens.push(CONFORMANCE.accountToken);
  createServer(store, clock.now(), {
    ID: CONFORMANCE.serverId,
    Name: CONFORMANCE.serverName,
    ApiTokens: [CONFORMANCE.serverToken],
  });
};
export default core;
