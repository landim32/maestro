import fs from 'node:fs/promises';
import { z } from 'zod';
import { resolveInsideCwd, truncate } from './sandbox.js';
import type { ToolDefinition } from './types.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const inputSchema = z.object({
  path: z.string().describe('File path, relative to the working directory.'),
  offset: z.number().int().min(1).optional().describe('First line to return (1-based).'),
  limit: z.number().int().min(1).optional().describe('Maximum number of lines to return.'),
});

export type ReadFileInput = z.infer<typeof inputSchema>;

export const readFileTool: ToolDefinition<ReadFileInput> = {
  name: 'read_file',
  description:
    'Read a UTF-8 text file inside the working directory. Returns numbered lines. Use offset/limit for large files.',
  inputSchema,
  kind: 'read',
  async run(input, ctx) {
    const abs = resolveInsideCwd(ctx.cwd, input.path);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) return { isError: true, output: `file not found: ${input.path}` };
    if (stat.isDirectory())
      return { isError: true, output: `${input.path} is a directory; use list_directory` };
    if (stat.size > MAX_FILE_BYTES)
      return {
        isError: true,
        output: `file too large (${stat.size} bytes); use offset/limit on a smaller file`,
      };

    const buf = await fs.readFile(abs);
    if (buf.subarray(0, 8000).includes(0))
      return { isError: true, output: `${input.path} looks like a binary file` };

    const lines = buf.toString('utf8').split(/\r?\n/);
    const start = (input.offset ?? 1) - 1;
    const end = input.limit !== undefined ? start + input.limit : lines.length;
    const slice = lines.slice(start, end);
    const width = String(end).length;
    const body = slice.map((l, i) => `${String(start + i + 1).padStart(width)}\t${l}`).join('\n');
    const header = `${input.path} (${lines.length} lines${start > 0 || end < lines.length ? `, showing ${start + 1}-${Math.min(end, lines.length)}` : ''})\n`;
    return { isError: false, output: truncate(header + body, ctx.settings.maxOutputChars) };
  },
};
