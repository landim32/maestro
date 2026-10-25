import fs from 'node:fs';
import path from 'node:path';

/** Project guidelines loaded into the system prompt (specs/006 contracts/init-and-context.md § 3). */
export interface ProjectContext {
  /** `MAESTRO.md` or `CLAUDE.md`. */
  file: string;
  path: string;
  text: string;
  bytes: number;
  /** Above PROJECT_CONTEXT_LIMIT: loaded anyway, the user is warned once. */
  large: boolean;
}

export const PROJECT_CONTEXT_FILES = ['MAESTRO.md', 'CLAUDE.md'] as const;
export const PROJECT_CONTEXT_LIMIT = 24 * 1024;

/** First of MAESTRO.md / CLAUDE.md found in `cwd`; undefined when neither exists. */
export function loadProjectContext(cwd: string): ProjectContext | undefined {
  for (const file of PROJECT_CONTEXT_FILES) {
    const abs = path.join(cwd, file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    const bytes = Buffer.byteLength(text, 'utf8');
    return { file, path: abs, text, bytes, large: bytes > PROJECT_CONTEXT_LIMIT };
  }
  return undefined;
}
