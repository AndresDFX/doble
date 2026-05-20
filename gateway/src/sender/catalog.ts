import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dirname, "../../sender/messages.json");

export type Catalog = Record<string, string[]>;

export async function readCatalog(path: string = DEFAULT_PATH): Promise<Catalog> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as Catalog;
}

export function catalogSummary(c: Catalog): { theme: string; count: number; samples: string[] }[] {
  return Object.entries(c).map(([theme, msgs]) => ({
    theme,
    count: msgs.length,
    samples: msgs.slice(0, 3),
  }));
}
