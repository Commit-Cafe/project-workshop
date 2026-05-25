import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PHASE_DIR = join(__dirname, "../../docs/prompts/phase");

const cache = new Map<string, string>();

function loadTemplate(filename: string): string {
  if (cache.has(filename)) return cache.get(filename)!;
  try {
    const content = readFileSync(join(PHASE_DIR, filename), "utf-8").trim();
    cache.set(filename, content);
    return content;
  } catch (err) {
    throw new Error(`Cannot load phase template "${filename}": ${err}`);
  }
}

export function render(filename: string, vars: Record<string, string>): string {
  let tpl = loadTemplate(filename);
  for (const [key, val] of Object.entries(vars)) {
    tpl = tpl.replaceAll(`{{${key}}}`, val);
  }
  return tpl;
}
