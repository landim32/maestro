import { APP_NAME } from '../version.js';

/**
 * Fixed system prompt for a session. Deliberately free of timestamps or random data so the
 * prefix stays stable across turns (prompt caching friendly).
 */
export function buildSystemPrompt(opts: {
  cwd: string;
  toolsEnabled: boolean;
  platform?: NodeJS.Platform;
}): string {
  const platform = opts.platform ?? process.platform;
  const lines = [
    `You are ${APP_NAME}, an AI assistant running inside the user's terminal.`,
    `Working directory: ${opts.cwd}`,
    `Operating system: ${platform}`,
    '',
    'Guidelines:',
    '- Answer in the language the user writes in.',
    '- Be concise. Prefer short paragraphs and bullet lists; use fenced code blocks for code and commands.',
    '- When the user refers to files or code, ground your answer in the actual project content.',
  ];
  if (opts.toolsEnabled) {
    lines.push(
      '- You have tools to read files, list directories, write files and run shell commands inside the working directory only.',
      '- Read before you write. Never guess file contents.',
      '- Writing files and running commands require explicit user confirmation; if the user declines, respect it and do not retry the same action.',
      '- Keep tool calls focused: avoid reading large trees or running long commands without need.',
    );
  } else {
    lines.push(
      '- You have no tools in this session; if the user asks about files, ask them to paste the relevant content.',
    );
  }
  return lines.join('\n');
}
