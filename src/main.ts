#!/usr/bin/env node
import { applyFlags, configFromEnv, USAGE } from "./config.ts";
import { startPostmock } from "./server.ts";

if (applyFlags(process.argv.slice(2), process.env) === "help") {
  console.log(USAGE);
  process.exit(0);
}
const config = configFromEnv(process.env);
const running = await startPostmock(config);
const urls = Object.entries(running.listeners).map(([name, url]) => `${name}=${url}`);
console.log(`postmock ${urls.join(" ")} seed=${config.seed}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void running.close().then(() => process.exit(0)));
}
