import type { ProjectContext } from '../config/projectContext.js';
import { skillsSection } from '../skills/catalog.js';
import type { SkillEntry } from '../skills/catalog.js';
import { APP_NAME } from '../version.js';

/**
 * Fixed system prompt for a session. Deliberately free of timestamps or random data so the
 * prefix stays stable across turns (prompt caching friendly).
 */
export function buildSystemPrompt(opts: {
  cwd: string;
  /** Workspace tools (read/list/write/run) are available. */
  toolsEnabled: boolean;
  /** The `ask_user` tool is available (default true). */
  askUser?: boolean;
  /** MAESTRO.md / CLAUDE.md of the project, appended as guidelines (specs/006). */
  projectContext?: ProjectContext;
  platform?: NodeJS.Platform;
  /** `settings.language`: every reply in this language (absent = the user's language). */
  language?: string;
  /** Skills found at startup (specs/013): listed by name and description, loaded on demand. */
  skills?: SkillEntry[];
}): string {
  const platform = opts.platform ?? process.platform;
  const language = opts.language ? languageName(opts.language) : undefined;
  const lines = [
    `You are ${APP_NAME}, an AI assistant running inside the user's terminal.`,
    `Working directory: ${opts.cwd}`,
    `Operating system: ${platform}`,
    '',
    'Guidelines:',
    language
      ? `- Always answer in ${language}, even when the request, templates, tool output or files are in another language. Documents, specs, plans, task lists, commit messages and code comments you write are also in ${language}. Keep code identifiers, file names, commands and technical terms in their original form.`
      : '- Answer in the language the user writes in.',
    '- Be concise. Prefer short paragraphs and bullet lists; use fenced code blocks for code and commands.',
    '- When the user refers to files or code, ground your answer in the actual project content.',
  ];
  if (opts.toolsEnabled) {
    lines.push(
      '- You have tools to read files, list directories, edit and write files and run shell commands inside the working directory only.',
      '- Read before you write. Never guess file contents.',
      '- Prefer the dedicated tools over shell commands: read_file to read files (not cat, type, Get-Content or scripts), edit_file to change part of a file (not sed, PowerShell -replace or a patch script), write_file to create a file or rewrite it whole (not echo or heredoc redirection), list_directory to list folders (not dir or ls). Reserve run_command for builds, tests, git and other programs.',
      '- Never create helper scripts, patch scripts, staging copies or temporary folders in the project to read, edit or move files: apply the change directly to the real file with edit_file or write_file.',
      '- Writing files and running commands may require explicit user confirmation, depending on the approval mode the user chose; if the user declines, respect it and do not retry the same action.',
      '- Keep tool calls focused: avoid reading large trees or running long commands without need.',
    );
  } else {
    lines.push(
      '- You have no workspace tools in this session; if the user asks about files, ask them to paste the relevant content.',
    );
  }
  if (opts.askUser ?? true) {
    lines.push(
      '- When you need a decision from the user to continue, call ask_user with concrete options instead of ending your turn with a question; the user can always answer "Other" in free text.',
    );
  }
  if (opts.toolsEnabled && opts.skills?.length) lines.push('', skillsSection(opts.skills));
  if (opts.projectContext) {
    lines.push(
      '',
      `# Project guidelines (${opts.projectContext.file})`,
      '',
      opts.projectContext.text.trim(),
    );
  }
  // Repeated last: smaller models follow the end of the prompt more reliably than its top.
  if (language) lines.push('', `Language: reply in ${language}.`);
  return lines.join('\n');
}

const LANGUAGE_NAMES: Record<string, string> = {
  'pt-br': 'Brazilian Portuguese (pt-BR)',
  'pt-pt': 'European Portuguese (pt-PT)',
  pt: 'Portuguese',
  en: 'English',
  'en-us': 'American English',
  'en-gb': 'British English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
};

/** `pt-BR` → "Brazilian Portuguese (pt-BR)"; any other text is used as written. */
export function languageName(value: string): string {
  return LANGUAGE_NAMES[value.trim().toLowerCase().replace('_', '-')] ?? value.trim();
}
