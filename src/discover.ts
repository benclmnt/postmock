import { readdirSync } from "node:fs";

/**
 * Imports modules found on disk, sorted by path, so parallel tracks add files without editing a
 * shared list (docs/11 §5). Without `file`: each `.ts` file in `dir`. With `file`: `<subdir>/<file>` for each subdirectory.
 */
export async function importAll(dir: URL, file?: string): Promise<unknown[]> {
  const entries = readdirSync(dir, { withFileTypes: true });
  const urls =
    file === undefined
      ? entries
          .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
          .map((e) => new URL(e.name, dir))
      : entries
          .filter((e) => e.isDirectory())
          .map((e) => new URL(`${e.name}/${file}`, dir))
          .filter((u) => readdirSync(new URL("./", u)).includes(file));
  urls.sort((a, b) => (a.href < b.href ? -1 : 1));
  const modules: unknown[] = [];
  for (const url of urls) modules.push(await import(url.href));
  return modules;
}
