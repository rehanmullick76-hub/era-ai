import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const generatedDir = fileURLToPath(new URL("../lib/api-zod/src/generated/", import.meta.url));

async function normalize(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await normalize(path);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;

    const source = await readFile(path, "utf8");
    const normalized = source
      .replace(/from ['"]zod['"]/g, 'from "zod/v4"')
      // zod/v4 does not expose uuid() on coerced strings; path params are
      // already strings at the Express boundary, so keep the UUID refinement.
      .replace(/zod\.coerce\.string\(\)\.uuid\(\)/g, "zod.string().uuid()");
    if (normalized !== source) await writeFile(path, normalized);
  }
}

await normalize(generatedDir);