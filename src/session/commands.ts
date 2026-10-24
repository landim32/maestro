import type { ProviderId } from '../providers/types.js';
import type { SessionController } from './controller.js';

export interface SlashCommand {
  name: string;
  aliases?: string[];
  usage?: string;
  description: string;
  run: (ctl: SessionController, args: string[]) => Promise<void> | void;
}

export function parseSlash(input: string): { name: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [head = '', ...rest] = trimmed.slice(1).split(/\s+/);
  return { name: head.toLowerCase(), args: rest.filter(Boolean) };
}

const help: SlashCommand = {
  name: 'help',
  description: 'List available commands and shortcuts.',
  run(ctl) {
    const lines = ['Commands:'];
    for (const c of ctl.commands) {
      const names = [c.name, ...(c.aliases ?? [])].map((n) => `/${n}`).join(', ');
      lines.push(`  ${(c.usage ?? names).padEnd(26)} ${c.description}`);
    }
    lines.push(
      '',
      'Shortcuts:',
      '  Esc / Ctrl+C   cancel the current response',
      '  Ctrl+C twice   exit',
      '  y / n          approve / decline a tool action',
      '  ↑ / ↓          previous messages',
    );
    ctl.notice(lines.join('\n'), 'info');
  },
};

const clear: SlashCommand = {
  name: 'clear',
  description: 'Start a new conversation (keeps the active provider).',
  run(ctl) {
    ctl.clearConversation();
  },
};

const exit: SlashCommand = {
  name: 'exit',
  aliases: ['quit'],
  description: 'Exit maestro.',
  run(ctl) {
    ctl.requestExit();
  },
};

const model: SlashCommand = {
  name: 'model',
  usage: '/model [id] [model]',
  description: 'Show providers, or switch the active provider (and optionally the model).',
  run(ctl, args) {
    if (args.length === 0) {
      ctl.notice(ctl.describeProviders(), 'info');
      return;
    }
    const [id, modelName] = args;
    ctl.switchProvider(id as ProviderId, modelName);
  },
};

export const DEFAULT_COMMANDS: SlashCommand[] = [help, clear, model, exit];

/** Executes a slash command. Returns false when `input` is not a slash command. */
export async function executeSlash(input: string, ctl: SessionController): Promise<boolean> {
  const parsed = parseSlash(input);
  if (!parsed) return false;
  const cmd = ctl.commands.find((c) => c.name === parsed.name || c.aliases?.includes(parsed.name));
  if (!cmd) {
    ctl.notice(`Unknown command: /${parsed.name}. Type /help.`, 'warn');
    return true;
  }
  await cmd.run(ctl, parsed.args);
  return true;
}
