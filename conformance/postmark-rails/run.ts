import type { ResultsFile } from "../results.ts";
import { runRspec } from "../rspec.ts";

// Runs the postmark-rails live integration specs, unmodified, against postmock (docs/08 §5.2).
// They use the postmark gem that the rails Gemfile resolves, not sdk/postmark-gem.
// json 3 breaks ActiveSupport 7.2 and 8.1: encoding passes `quirks_mode`, decoding passes a second
// argument to JSON.parse. Every delivery then raises ArgumentError, so json stays below 3.
export const run = (): Promise<ResultsFile> =>
  runRspec("postmark-rails", ["spec/integration"], { json: "< 3" });
