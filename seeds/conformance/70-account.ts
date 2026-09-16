import { confirmDkim } from "../../src/api/account/authentication.ts";
import { newDomain } from "../../src/api/account/domains.ts";
import { newSender } from "../../src/api/account/senders.ts";
import type { Seed } from "../../src/control/seed.ts";
import { CONFORMANCE } from "../lib/conformance.ts";

/**
 * The account the SDK suites ran against: server deletion enabled, a verified domain, and a
 * confirmed sender signature. The dotnet, java and php suites read the first domain and signature
 * (sdk/postmark-java/src/test/java/integration/DomainTest.java:36-41).
 */
const account: Seed = ({ store, clock }) => {
  const now = clock.now();
  store.state.account.serverDeletionEnabled = true;

  const domain = newDomain(store.useId("domain", 7000), CONFORMANCE.domain, "", now);
  confirmDkim(domain);
  store.state.domains.set(domain.ID, domain);

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
