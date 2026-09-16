import { importAll } from "../discover.ts";

// Loads every `src/api/<group>/routes.ts`; each registers its routes with `defineRoute`.
await importAll(new URL("./", import.meta.url), "routes.ts");
