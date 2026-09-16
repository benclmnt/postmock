import { importAll } from "../discover.ts";

// Loads every `src/control/endpoints/*.ts`; each registers its endpoints with `defineControl`.
await importAll(new URL("./endpoints/", import.meta.url));
