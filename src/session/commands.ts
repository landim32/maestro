import type { ProviderId } from '../providers/types.js';
import type { MethodId } from '../setup/methods.js';
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

export const NON_INTERACTIVE_AUTH_HINT =
  'Configuração interativa indisponível no modo -p. Edite ~/.maestro/settings.json ou use ANTHROPIC_API_KEY / DASHSCOPE_API_KEY.';

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
      '  PgUp / PgDn    scroll the conversation',
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

const METHOD_IDS: readonly MethodId[] = ['claude-api', 'claude-login', 'qwen'];

const auth: SlashCommand = {
  name: 'auth',
  aliases: ['connect', 'login'],
  usage: '/auth [claude-api|claude-login|qwen]',
  description: 'Conectar um provedor de IA (Claude API, Claude Auth Login, Qwen).',
  run(ctl, args) {
    if (!ctl.interactive) {
      ctl.notice(NON_INTERACTIVE_AUTH_HINT, 'info');
      return;
    }
    if (ctl.session.state !== 'idle') {
      ctl.notice('Aguarde a resposta terminar antes de usar /auth.', 'warn');
      return;
    }
    const wanted = args[0]?.toLowerCase();
    let preselect: MethodId | undefined;
    if (wanted) {
      if ((METHOD_IDS as readonly string[]).includes(wanted)) preselect = wanted as MethodId;
      else ctl.notice(`Método desconhecido '${wanted}'. Opções: ${METHOD_IDS.join(', ')}.`, 'warn');
    }
    ctl.setup.openAuth(preselect);
  },
};

const model: SlashCommand = {
  name: 'model',
  usage: '/model [id] [model]',
  description: 'Mostrar/trocar o modelo ativo (abre um seletor sem argumentos).',
  run(ctl, args) {
    if (args.length === 0) {
      if (!ctl.interactive) {
        ctl.notice(ctl.describeProviders(), 'info');
        return;
      }
      if (ctl.session.state !== 'idle') {
        ctl.notice('Aguarde a resposta terminar antes de usar /model.', 'warn');
        return;
      }
      ctl.setup.openModel();
      return;
    }
    const [id, modelName] = args;
    if (ctl.switchProvider(id as ProviderId, modelName)) ctl.persistActive(modelName);
  },
};

export const DEFAULT_COMMANDS: SlashCommand[] = [help, auth, model, clear, exit];

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
