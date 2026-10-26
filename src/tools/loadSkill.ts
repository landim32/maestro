import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { findSkill, sourceLabel } from '../skills/catalog.js';
import type { SkillCatalog, SkillEntry } from '../skills/catalog.js';
import { parseFrontmatter } from '../skills/frontmatter.js';
import { truncate } from './sandbox.js';
import type { SkillLoadDisplay, ToolDefinition, ToolResult } from './types.js';

/** specs/013 contracts/load-skill-tool.md § 2–4. */
export const MAX_SKILL_FILE_BYTES = 256 * 1024;
export const MAX_LISTED_FILES = 100;
const MAX_DEPTH = 3;
const MAX_NAMES_IN_ERROR = 50;

const inputSchema = z.object({
  name: z.string().min(1).describe('Skill name, exactly as listed in the system prompt.'),
  file: z.string().min(1).optional().describe('Reference file relative to the skill folder.'),
});

export type LoadSkillInput = z.infer<typeof inputSchema>;

export const LOAD_SKILL_DESCRIPTION =
  'Load a skill listed in the system prompt: returns its SKILL.md instructions and the list of its reference files. Pass "file" (a path relative to the skill folder, as listed) to read one reference file instead.';

const countLines = (text: string): number => {
  const lines = text.split('\n');
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
};

/** Files of the skill folder, relative with `/`, without SKILL.md, dot folders and node_modules. */
async function listFiles(root: string): Promise<{ files: string[]; more: number }> {
  const files: string[] = [];
  let total = 0;
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || depth >= MAX_DEPTH) continue;
        await walk(path.join(dir, e.name), relPath, depth + 1);
      } else if (relPath !== 'SKILL.md') {
        total += 1;
        if (files.length < MAX_LISTED_FILES) files.push(relPath);
      }
    }
  };
  await walk(root, '', 1);
  return { files, more: total - files.length };
}

type Read = { ok: true; text: string } | { ok: false; output: string };

async function readText(abs: string, shown: string): Promise<Read> {
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat) return { ok: false, output: `file not found: ${shown}` };
  if (stat.isDirectory())
    return { ok: false, output: `${shown} is a directory; pick a file from the reference list` };
  if (stat.size > MAX_SKILL_FILE_BYTES)
    return { ok: false, output: `file too large (${stat.size} bytes)` };
  const buf = await fs.readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) return { ok: false, output: `not a text file: ${shown}` };
  return { ok: true, text: buf.toString('utf8').replace(/\r\n/g, '\n') };
}

/** `file` inside the real folder of the skill, after resolving links and `..` (research R5). */
async function confine(skill: SkillEntry, file: string): Promise<string | undefined> {
  if (path.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.includes('\0')) return undefined;
  const root = await fs.realpath(skill.dir).catch(() => undefined);
  if (!root) return undefined;
  const target = path.resolve(root, file);
  const real = await fs.realpath(target).catch(() => target);
  return real.startsWith(root + path.sep) ? real : undefined;
}

/** `load_skill` over the session's catalogue (specs/013). Reads the disk on every call (FR-019). */
export function createLoadSkillTool(catalog: SkillCatalog): ToolDefinition<LoadSkillInput> {
  return {
    name: 'load_skill',
    description: LOAD_SKILL_DESCRIPTION,
    inputSchema,
    kind: 'read',
    async run(input, ctx): Promise<ToolResult> {
      const skill = findSkill(catalog, input.name);
      const fail = (output: string, extra: Partial<SkillLoadDisplay> = {}): ToolResult => ({
        isError: true,
        output,
        display: { skill: { name: input.name, file: input.file, ok: false, ...extra } },
      });
      if (!skill) {
        const names = catalog.skills.map((s) => s.name);
        const shown = names.slice(0, MAX_NAMES_IN_ERROR).join(', ');
        return fail(
          `unknown skill "${input.name}". Available: ${shown}${names.length > MAX_NAMES_IN_ERROR ? ', …' : ''}`,
        );
      }
      const base = { name: skill.name, source: skill.source, file: input.file };

      if (input.file !== undefined) {
        const abs = await confine(skill, input.file);
        if (!abs) return fail(`file outside the skill folder: ${input.file}`, base);
        const r = await readText(abs, input.file);
        if (!r.ok)
          return fail(
            r.output.startsWith('file not found')
              ? `file not found in skill ${skill.name}: ${input.file}`
              : r.output,
            base,
          );
        const lines = countLines(r.text);
        return {
          isError: false,
          output: truncate(
            `# Skill file: ${skill.name}/${input.file} (${lines} lines)\n${r.text}`,
            ctx.settings.maxOutputChars,
          ),
          display: { skill: { ...base, ok: true, lines } },
        };
      }

      const r = await readText(skill.file, 'SKILL.md');
      if (!r.ok)
        return fail(
          r.output.startsWith('file not found')
            ? `skill ${skill.name} is no longer available (SKILL.md not found)`
            : r.output,
          base,
        );
      const parsed = parseFrontmatter(r.text);
      const body = ('error' in parsed ? r.text : parsed.body).trim();
      const { files, more } = await listFiles(skill.dir);
      const out = [`# Skill: ${skill.name}`, `Source: ${sourceLabel(skill.source)}`, '', body, ''];
      out.push(`## Reference files (${files.length + more})`);
      for (const f of files) out.push(`- ${f}`);
      if (more > 0) out.push(`- … +${more} more`);
      if (files.length)
        out.push('', `Read one with load_skill(name: "${skill.name}", file: "<path>").`);
      return {
        isError: false,
        output: truncate(out.join('\n'), ctx.settings.maxOutputChars),
        display: {
          skill: { ...base, ok: true, lines: countLines(body), files: files.length + more },
        },
      };
    },
  };
}
