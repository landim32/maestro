/**
 * Skills (specs/013): discovery of `SKILL.md` files, the catalogue shared by the system prompt,
 * `load_skill` and `/skills`, and the pure text builders for the prompt section and the report.
 */
import nodeFs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';

/** Where a skill comes from, in precedence order (data-model § 1). */
export type SkillSource = 'project-claude' | 'project-agents' | 'user';

export interface SkillEntry {
  name: string;
  /** Whitespace collapsed, full length. */
  description: string;
  source: SkillSource;
  /** Absolute folder of the skill, as found. */
  dir: string;
  /** Absolute path of its SKILL.md. */
  file: string;
}

export interface SkillCatalog {
  skills: SkillEntry[];
  shadowed: Array<SkillEntry & { by: SkillSource }>;
  /** `path` is the absolute path of the SKILL.md that was skipped. */
  ignored: Array<{ path: string; source: SkillSource; reason: string }>;
}

export const EMPTY_CATALOG: SkillCatalog = { skills: [], shadowed: [], ignored: [] };

export const DESCRIPTION_MAX = 250;
export const LIST_MAX_ITEMS = 50;
export const LIST_MAX_CHARS = 12_000;
const SPECKIT = /^speckit[-.]/i;
export const SPECKIT_REASON = 'comando do Spec Kit hospedado nativamente pelo Maestro';

const LABELS: Record<SkillSource, string> = {
  'project-claude': 'projeto (.claude/skills)',
  'project-agents': 'projeto (.agents/skills)',
  user: 'usuário (~/.claude/skills)',
};

export function sourceLabel(source: SkillSource): string {
  return LABELS[source];
}

/** The three roots, in precedence order (research R2). */
export function skillRoots(cwd: string, home: string): Array<{ source: SkillSource; dir: string }> {
  return [
    { source: 'project-claude', dir: path.join(cwd, '.claude', 'skills') },
    { source: 'project-agents', dir: path.join(cwd, '.agents', 'skills') },
    { source: 'user', dir: path.join(home, '.claude', 'skills') },
  ];
}

/** One SKILL.md as read from disk, before precedence is applied. */
export interface FoundSkill {
  source: SkillSource;
  dir: string;
  file: string;
  text?: string;
  /** Error code when the file could not be read. */
  readError?: string;
}

export const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Pure: header → entry, then precedence, Spec Kit skills and invalid headers (contract § 1). */
export function resolveCatalog(found: FoundSkill[]): SkillCatalog {
  const out: SkillCatalog = { skills: [], shadowed: [], ignored: [] };
  const byName = new Map<string, SkillEntry>();
  for (const f of found) {
    const skip = (reason: string) => out.ignored.push({ path: f.file, source: f.source, reason });
    if (f.text === undefined) {
      skip(`não foi possível ler (${f.readError ?? 'erro'})`);
      continue;
    }
    const parsed = parseFrontmatter(f.text);
    if ('error' in parsed) {
      skip(parsed.error);
      continue;
    }
    const name = parsed.fields['name']?.trim() || path.basename(f.dir);
    const description = collapse(parsed.fields['description'] ?? '');
    if (SPECKIT.test(name)) {
      skip(SPECKIT_REASON);
      continue;
    }
    if (!description) {
      skip('sem description no cabeçalho');
      continue;
    }
    const entry: SkillEntry = { name, description, source: f.source, dir: f.dir, file: f.file };
    const winner = byName.get(name.toLowerCase());
    if (winner) out.shadowed.push({ ...entry, by: winner.source });
    else {
      byName.set(name.toLowerCase(), entry);
      out.skills.push(entry);
    }
  }
  return out;
}

export type SkillFs = Pick<typeof nodeFs, 'readdirSync' | 'statSync' | 'readFileSync'>;

/**
 * Reads `skills/<name>/SKILL.md` one level below each root (research R2, R9). Synchronous,
 * never throws: missing or unreadable roots are skipped silently.
 */
export function discoverSkills(opts: { cwd: string; home: string; fs?: SkillFs }): SkillCatalog {
  const fs = opts.fs ?? nodeFs;
  const found: FoundSkill[] = [];
  for (const root of skillRoots(opts.cwd, opts.home)) {
    let names: string[];
    try {
      names = fs.readdirSync(root.dir).map(String).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = path.join(root.dir, name);
      const file = path.join(dir, 'SKILL.md');
      try {
        if (!fs.statSync(dir).isDirectory() || !fs.statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      try {
        found.push({ ...root, dir, file, text: String(fs.readFileSync(file, 'utf8')) });
      } catch (err) {
        found.push({ ...root, dir, file, readError: (err as NodeJS.ErrnoException).code });
      }
    }
  }
  return resolveCatalog(found);
}

/** Session catalogue: discovered only when skills and tools are enabled (FR-004, research R8). */
export function sessionSkills(
  settings: { tools: { enabled: boolean }; skills: { enabled: boolean } },
  where: { cwd: string; home: string },
  discover: typeof discoverSkills = discoverSkills,
): { state: SkillsState; catalog: SkillCatalog } {
  if (!settings.tools.enabled) return { state: 'no-tools', catalog: EMPTY_CATALOG };
  if (!settings.skills.enabled) return { state: 'disabled', catalog: EMPTY_CATALOG };
  return { state: 'on', catalog: discover(where) };
}

/** Exact name first, then case-insensitive. */
export function findSkill(catalog: SkillCatalog, name: string): SkillEntry | undefined {
  const wanted = name.trim();
  return (
    catalog.skills.find((s) => s.name === wanted) ??
    catalog.skills.find((s) => s.name.toLowerCase() === wanted.toLowerCase())
  );
}

export const cut = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

const SECTION_HEADER = [
  '# Skills',
  '',
  'Skills are instructions written by the user or the project for specific kinds of tasks.',
  '- Before starting a task that one of the skills below covers, call load_skill with its name and follow its instructions.',
  '- A skill may point to reference files in its folder; read them with load_skill(name, file), not with read_file.',
  '- Do not load skills that are unrelated to the current task.',
  '',
];

/** System prompt section (contract § 2); '' without skills. Deterministic. */
export function skillsSection(skills: SkillEntry[]): string {
  if (skills.length === 0) return '';
  const items: string[] = [];
  let chars = 0;
  for (const s of skills) {
    const item = `- ${s.name}: ${cut(collapse(s.description), DESCRIPTION_MAX)}`;
    if (items.length >= LIST_MAX_ITEMS || chars + item.length > LIST_MAX_CHARS) break;
    items.push(item);
    chars += item.length;
  }
  const left = skills.length - items.length;
  if (left > 0)
    items.push(
      `- … mais ${left} skills (use /skills para ver todas; load_skill aceita qualquer nome válido)`,
    );
  return [...SECTION_HEADER, ...items].join('\n');
}

export type SkillsState = 'on' | 'disabled' | 'no-tools';

/** `/skills` text (contract § 3). */
export function skillsReport(
  catalog: SkillCatalog,
  state: SkillsState,
  where: { cwd: string; home: string },
): string {
  if (state === 'disabled') return 'Skills desligadas (skills.enabled: false).';
  if (state === 'no-tools') return 'Skills indisponíveis sem ferramentas (--no-tools).';
  const { skills, shadowed, ignored } = catalog;
  if (skills.length + shadowed.length + ignored.length === 0)
    return 'Nenhuma skill encontrada em .claude/skills, .agents/skills ou ~/.claude/skills.';

  const shown = (p: string): string => {
    const userRoot = path.join(where.home, '.claude', 'skills');
    const rel = (from: string) => path.relative(from, p).split(path.sep).join('/');
    if (p.startsWith(userRoot + path.sep)) return `~/.claude/skills/${rel(userRoot)}`;
    return rel(where.cwd);
  };
  const pad = (s: string, n: number) => s.padEnd(n);
  const nameW = Math.max(0, ...[...skills, ...shadowed].map((s) => s.name.length)) + 2;
  const srcW = Math.max(...Object.values(LABELS).map((l) => l.length)) + 2;

  const out: string[] = [`Skills disponíveis (${skills.length}):`];
  for (const s of skills)
    out.push(
      `  ${pad(s.name, nameW)}${pad(sourceLabel(s.source), srcW)}${cut(s.description, 100)}`,
    );
  if (shadowed.length) {
    out.push('', `Sombreadas (${shadowed.length}):`);
    for (const s of shadowed)
      out.push(
        `  ${pad(s.name, nameW)}${pad(sourceLabel(s.source), srcW)}→ vale ${sourceLabel(s.by)}`,
      );
  }
  if (ignored.length) {
    out.push('', `Ignoradas (${ignored.length}):`);
    const paths = ignored.map((i) => shown(i.path));
    const w = Math.max(...paths.map((p) => p.length)) + 2;
    ignored.forEach((i, k) => out.push(`  ${pad(paths[k]!, w)}${i.reason}`));
  }
  return out.join('\n');
}
