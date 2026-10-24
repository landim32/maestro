import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveInsideCwd, truncate } from './sandbox.js';
import type { ToolDefinition } from './types.js';

const IGNORED = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__', '.venv']);
const MAX_DEPTH = 5;
const MAX_ENTRIES = 2000;

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Directory path relative to the working directory. Defaults to ".".'),
  recursive: z.boolean().optional().describe('List subdirectories recursively (depth-limited).'),
});

export type ListDirectoryInput = z.infer<typeof inputSchema>;

export const listDirectoryTool: ToolDefinition<ListDirectoryInput> = {
  name: 'list_directory',
  description:
    'List files and folders inside the working directory. Folders end with "/". node_modules, .git and build outputs are skipped.',
  inputSchema,
  requiresConfirmation: false,
  async run(input, ctx) {
    const rel = input.path ?? '.';
    const abs = resolveInsideCwd(ctx.cwd, rel);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) return { isError: true, output: `directory not found: ${rel}` };
    if (!stat.isDirectory()) return { isError: true, output: `${rel} is a file; use read_file` };

    const lines: string[] = [];
    let count = 0;
    const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort(
        (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
      );
      for (const e of entries) {
        if (IGNORED.has(e.name)) continue;
        if (++count > MAX_ENTRIES) {
          lines.push(`… (more than ${MAX_ENTRIES} entries, stopping)`);
          return;
        }
        const isDir = e.isDirectory();
        lines.push(`${prefix}${e.name}${isDir ? '/' : ''}`);
        if (isDir && input.recursive && depth < MAX_DEPTH) {
          await walk(path.join(dir, e.name), `${prefix}${e.name}/`, depth + 1);
        }
      }
    };
    await walk(abs, '', 0);
    const header = `${rel === '.' ? ctx.cwd : rel} (${lines.length} entries)\n`;
    return {
      isError: false,
      output: truncate(header + lines.join('\n'), ctx.settings.maxOutputChars),
    };
  },
};
