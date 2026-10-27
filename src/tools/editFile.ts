/**
 * @license
 * Portions adapted from qwen-code (https://github.com/QwenLM/qwen-code),
 * packages/core/src/tools/edit.ts @ a4dd42c4d67927dfd600d8e87d0c8f670c478ed9.
 * Copyright 2025 Qwen Team. Copyright 2025 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Maestro; see THIRD_PARTY_NOTICES.md.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { fileDiff } from './diff.js';
import { resolveInsideCwd } from './sandbox.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.object({
  path: z.string().describe('File path, relative to the working directory.'),
  old_string: z
    .string()
    .describe(
      'The exact literal text to replace, including whitespace and indentation, without the line-number prefix of read_file. Empty only to create a new file.',
    ),
  new_string: z.string().describe('The exact literal text that replaces old_string.'),
  // Optional (not `.default`) so the JSON Schema sent to the model keeps it non-required.
  replace_all: z
    .boolean()
    .optional()
    .describe('Replace every occurrence of old_string (default false: it must be unique).'),
});

export type EditFileInput = z.infer<typeof inputSchema>;

export const EDIT_FILE_DESCRIPTION = [
  'Replace text within a file inside the working directory. By default replaces a single occurrence; set replace_all to true to change every instance of old_string.',
  'Read the file with read_file first. old_string must be the exact literal text to replace (all whitespace, indentation and newlines), never escaped, and must identify one place: include a few lines of context before and after the change.',
  'If old_string is not found or matches several places, nothing is changed and the call fails. Use an empty old_string only to create a new file with new_string.',
  'May require user approval depending on the approval mode.',
].join(' ');

export interface EditPlan {
  abs: string;
  /** Current content, or null for a new file. */
  current: string | null;
  next: string;
  occurrences: number;
}

const countOf = (text: string, needle: string) => text.split(needle).length - 1;

/**
 * What the edit does, or why it cannot be applied (no write). A CRLF file is matched with LF
 * line ends and written back with CRLF, so the model's `\n` strings still apply.
 */
export async function planEdit(
  input: EditFileInput,
  cwd: string,
): Promise<EditPlan | { error: string }> {
  const abs = resolveInsideCwd(cwd, input.path);
  const current = await fs.readFile(abs, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  if (current === null) {
    if (input.old_string !== '')
      return {
        error: `file not found: ${input.path}. Use an empty old_string to create a new file.`,
      };
    return { abs, current, next: input.new_string, occurrences: 1 };
  }
  if (input.old_string === '')
    return {
      error: `${input.path} already exists; an empty old_string only creates new files. Use write_file to rewrite it whole.`,
    };
  if (input.old_string === input.new_string)
    return { error: `no changes to apply: old_string and new_string are identical.` };

  const crlf = current.includes('\r\n');
  const lf = (s: string) => (crlf ? s.replace(/\r\n/g, '\n') : s);
  const text = lf(current);
  const oldStr = lf(input.old_string);
  const newStr = lf(input.new_string);
  const occurrences = countOf(text, oldStr);
  if (occurrences === 0)
    return {
      error: `0 occurrences of old_string found in ${input.path}; no edits made. The text must match exactly (whitespace, indentation, no line-number prefix, no escaping). Read the file again with read_file and retry.`,
    };
  if (occurrences > 1 && !input.replace_all)
    return {
      error: `old_string matches ${occurrences} places in ${input.path}; no edits made. Include more surrounding context to make it unique, or set replace_all to true.`,
    };
  const replaced = input.replace_all
    ? text.split(oldStr).join(newStr)
    : text.replace(oldStr, () => newStr);
  return {
    abs,
    current,
    next: crlf ? replaced.replace(/\n/g, '\r\n') : replaced,
    occurrences,
  };
}

export const editFileTool: ToolDefinition<EditFileInput> = {
  name: 'edit_file',
  description: EDIT_FILE_DESCRIPTION,
  inputSchema,
  kind: 'edit',
  /** Structured diff for the dialog and the transcript (specs/009); computed before the write. */
  async diff(input, ctx) {
    const plan = await planEdit(input, ctx.cwd);
    if ('error' in plan) throw new Error(plan.error);
    return fileDiff(plan.current, plan.next, input.path);
  },
  async preview(input, ctx) {
    const plan = await planEdit(input, ctx.cwd);
    if ('error' in plan) return `edit: ${input.path} (will fail: ${plan.error})`;
    const d = fileDiff(plan.current, plan.next, input.path);
    const head =
      plan.current === null
        ? `new file: ${input.path} (${d.newLines} lines)`
        : `edit: ${input.path} (+${d.added} −${d.removed})`;
    const body = d.hunks.flatMap((h) => h.lines.map((l) => `${l.type}${l.text}`));
    return [head, ...body].join('\n');
  },
  async run(input, ctx) {
    const plan = await planEdit(input, ctx.cwd);
    if ('error' in plan) return { isError: true, output: plan.error };
    await fs.mkdir(path.dirname(plan.abs), { recursive: true });
    await fs.writeFile(plan.abs, plan.next, 'utf8');
    if (plan.current === null) return { isError: false, output: `created ${input.path}` };
    const n = plan.occurrences;
    return {
      isError: false,
      output: `edited ${input.path} (${n} ${n === 1 ? 'replacement' : 'replacements'})`,
    };
  },
};
