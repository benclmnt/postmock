import type { ResultsFile } from "../results.ts";
import { runRspec } from "../rspec.ts";

// Runs the postmark-rails live integration specs, unmodified, against postmock (docs/08 §5.2).
// They use the postmark gem that the rails Gemfile resolves, not sdk/postmark-gem.
// The Gemfile defaults to actionmailer ~> 7.0 (sdk/postmark-rails/Gemfile:5). ActiveSupport 7.2
// passes `quirks_mode` to JSON.generate, which json 3 rejects, so every delivery raises
// ArgumentError. ActiveSupport 8.1 does not pass it.
export const run = (): Promise<ResultsFile> =>
  runRspec("postmark-rails", ["spec/integration"], { RAILS_TEST_VERSION: "~> 8.1" });
