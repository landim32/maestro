import fs from 'node:fs/promises';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import { resolveInsideCwd } from './sandbox.js';
import type { ToolDefinition } from './types.js';

const PREVIEW_LINES = 60;

const inputSchema = z.object({
  path: z.string().describe('File path, relative to the working directory.'),
  content: z
    .string()
    .describe('Full new content of the file (UTF-8). Overwrites the file if it exists.'),
});

export type WriteFileInput = z.infer<typeof inputSchema>;

export const writeFileTool: ToolDefinition<WriteFileInput> = {
  name: 'write_file',
  description:
    'Create or overwrite a text file inside the working directory with the given full content. May require user approval depending on the approval mode.',
  inputSchema,
  kind: 'edit',
  async preview(input, ctx) {
    const abs = resolveInsideCwd(ctx.cwd, input.path);
    const existing = await fs.readFile(abs, 'utf8').catch(() => null);
    if (existing === null) {
      const lines = input.content.split('\n');
      const shown = lines.slice(0, PREVIEW_LINES).map((l) => `+${l}`);
      if (lines.length > PREVIEW_LINES) shown.push(`… ${lines.length - PREVIEW_LINES} more lines`);
      return [`new file: ${input.path} (${lines.length} lines)`, ...shown].join('\n');
    }
    if (existing === input.content) return `${input.path}: no changes`;
    const patch = createTwoFilesPatch(
      input.path,
      input.path,
      existing,
      input.content,
      'current',
      'proposed',
    );
    const body = patch.split('\n').slice(2); // drop the "===" header lines
    const added = body.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    const removed = body.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    return [`edit: ${input.path} (+${added} −${removed})`, ...body].join('\n');
  },
  async run(input, ctx) {
    const abs = resolveInsideCwd(ctx.cwd, input.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, input.content, 'utf8');
    const bytes = Buffer.byteLength(input.content, 'utf8');
    return { isError: false, output: `wrote ${bytes} bytes to ${input.path}` };
  },
};
