// The harness seed for SDK conformance suites (docs/08 §5.3). One import per part file.
import "./conformance/core.ts";
import { seedFromParts } from "../src/control/seed.ts";

export default seedFromParts("conformance");
