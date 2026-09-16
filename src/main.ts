import { z } from "zod";
import { startPostmock } from "./server.ts";

const port = z.coerce.number().int().min(0).max(65535);

// Every setting comes from the environment; a bad value stops startup.
const env = z
  .object({
    POSTMOCK_HOST: z.string().default("127.0.0.1"),
    POSTMOCK_API_PORT: port.default(8080),
    POSTMOCK_CONTROL_PORT: port.default(8025),
    POSTMOCK_SEED: z.string().default("empty"),
  })
  .parse(process.env);

const running = await startPostmock({
  host: env.POSTMOCK_HOST,
  apiPort: env.POSTMOCK_API_PORT,
  controlPort: env.POSTMOCK_CONTROL_PORT,
  seed: env.POSTMOCK_SEED,
});
console.log(
  `postmock api=${running.apiUrl} control=${running.controlUrl} seed=${env.POSTMOCK_SEED}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void running.close().then(() => process.exit(0)));
}
