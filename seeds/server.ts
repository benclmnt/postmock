import { addVerifiedDomain } from "../src/api/account/domains.ts";
import type { Seed } from "../src/control/seed.ts";
import core from "./conformance/00-core.ts";
import { CONFORMANCE } from "./lib/conformance.ts";

/**
 * The `conformance` account token and server 10, and the verified domain `example.com`, with no
 * mail history: no message, bounce or suppression. An app's own tests start from it.
 */
const server: Seed = async (runtime) => {
  await core(runtime);
  const { store, clock } = runtime;
  addVerifiedDomain(store.state, store.useId("domain", 7000), CONFORMANCE.domain, clock.now());
};
export default server;
