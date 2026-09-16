import { confirmDkim } from "../../src/api/account/authentication.ts";
import { addVerifiedDomain } from "../../src/api/account/domains.ts";
import { newSender } from "../../src/api/account/senders.ts";
import type { Seed } from "../../src/control/seed.ts";
import { CONFORMANCE } from "../lib/conformance.ts";

/**
 * The account the SDK suites ran against: server deletion enabled, verified domains, and a
 * confirmed sender signature. The dotnet, java and php suites read the first domain and signature
 * (sdk/postmark-java/src/test/java/integration/DomainTest.java:36-41). A send needs a `From` on a
 * verified domain or a confirmed signature (docs/03 §3.4).
 */
const account: Seed = ({ store, clock }) => {
  const now = clock.now();
  store.state.account.serverDeletionEnabled = true;

  addVerifiedDomain(store.state, store.useId("domain", 7000), CONFORMANCE.domain, now);
  // The postmark-python start example sends from its placeholder domain
  // (sdk/postmark-python/examples/start_here.py:53); its owner verifies that domain first.
  addVerifiedDomain(store.state, store.useId("domain", 7001), CONFORMANCE.exampleDomain, now);

  const sender = newSender(
    store.useId("sender", 7000),
    {
      FromEmail: CONFORMANCE.senderEmail,
      Name: "postmock sender",
      ReplyToEmail: "",
      ReturnPathDomain: "",
      ConfirmationPersonalNote: "",
    },
    now,
  );
  sender.Confirmed = true;
  confirmDkim(sender);
  store.state.senders.set(sender.ID, sender);
};
export default account;
