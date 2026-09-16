import type { ResultsFile } from "../results.ts";
import { runRspec } from "../rspec.ts";

// Runs the postmark-gem live integration specs, unmodified, against postmock (docs/08 §5.2).
// The unit specs stub the default host with FakeWeb, so the route shim applies to integration only.
export const run = (): Promise<ResultsFile> => runRspec("postmark-gem", ["spec/integration"]);
