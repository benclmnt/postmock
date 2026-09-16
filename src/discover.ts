import { existsSync, readdirSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

export interface Discovered {
  url: URL;
  module: unknown;
}

/** `.ts` when Node runs the sources, `.js` in the built package: discovered files share it. */
export const MODULE_EXTENSION = extname(fileURLToPath(import.meta.url));

const visible = (name: string) => !name.startsWith(".");

/**
 * Imports modules found on disk, sorted by path, so parallel tracks add files without editing a
 * shared list (docs/11 §5). Names starting with `.` are skipped (macOS `._*` files).
 * Without `file`: each module file in `dir` (`MODULE_EXTENSION`), tests excluded.
 * With `file`: `<subdir>/<file><MODULE_EXTENSION>` for each subdirectory; a subdirectory without it
 * throws.
 */
export async function importAll(dir: URL, file?: string): Promise<Discovered[]> {
  const ext = MODULE_EXTENSION;
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => visible(e.name));
  const urls =
    file === undefined
      ? entries
          .filter((e) => e.isFile() && e.name.endsWith(ext) && !e.name.endsWith(`.test${ext}`))
          .map((e) => new URL(e.name, dir))
      : entries
          .filter((e) => e.isDirectory())
          .map((e) => {
            const url = new URL(`${e.name}/${file}${ext}`, dir);
            if (!existsSync(url))
              throw new Error(
                `${new URL(`${e.name}/`, dir).pathname}: ${e.name} has no ${file}${ext}`,
              );
            return url;
          });
  urls.sort((a, b) => (a.href < b.href ? -1 : 1));
  const found: Discovered[] = [];
  for (const url of urls) found.push({ url, module: await import(url.href) });
  return found;
}

/** The default export of a discovered module, which must be a function. */
export function defaultFunction<F extends (...args: never[]) => unknown>(found: Discovered): F {
  const value = (found.module as { default?: unknown }).default;
  if (typeof value !== "function")
    throw new Error(`${found.url.pathname} has no default export function`);
  return value as F;
}
