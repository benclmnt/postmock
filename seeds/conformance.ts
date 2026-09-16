import { seedFromDirectory } from "../src/control/seed.ts";

// The harness seed for SDK conformance suites (docs/08 §5.3): every part in `seeds/conformance/`.
export default seedFromDirectory(new URL("./conformance/", import.meta.url));
