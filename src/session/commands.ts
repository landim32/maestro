import type { ProviderId } from '../providers/types.js';
import type { MethodId } from '../setup/methods.js';
import type { PromptTurn } from '../speckit/prompt.js';
import { APPROVAL_MODES, approvalModeInfo, parseApprovalMode } from '../tools/approval.js';
import type { SessionController } from './controller.js';

export type { PromptTurn };

export interface SlashCommand {
  name: string;
  aliases?: string[];
  usage?: string;
  description: string;
  /** Where the command comes from (`/help` shows it); undefined for built-ins. */
  origin?: string;
  /**
   * Runs the command. `args` are whitespace-split, `rest` is the raw text after the name.
   * Returning a `PromptTurn` runs a model turn with that prompt (Spec Kit commands).
   */
  run: (
    ctl: SessionController,
    args: string[],
    rest?: string,
  ) => Promise<void | PromptTurn> | void | PromptTurn;
}

export function parseSlash(input: string): { name: string; args: string[]; rest: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const body = trimmed.slice(1);
  const m = /^(\S*)\s*([\s\S]*)$/.exec(body)!;
  const rest = m[2] ?? '';
  return { name: (m[1] ?? '').toLowerCase(), args: rest.split(/\s+/).filter(Boolean), rest };
}

export const NON_INTERACTIVE_AUTH_HINT =
  'Configuração interativa indisponível no modo -p. Edite ~/.maestro/settings.json ou use ANTHROPIC_API_KEY / DASHSCOPE_API_KEY.';

const help: SlashCommand = {
  name: 'help',
  description: 'List available commands and shortcuts.',
  run(ctl) {
    const lines = ['Commands:'];
    const builtin = ctl.commands.filter((c) => !c.origin);
    const speckit = ctl.commands.filter((c) => c.origin);
    for (const c of builtin) {
      const names = [c.name, ...(c.aliases ?? [])].map((n) => `/${n}`).join(', ');
      lines.push(`  ${(c.usage ?? names).padEnd(26)} ${c.description}`);
    }
    if (speckit.length > 0) {
      lines.push('', `Spec Kit (${ctl.specKit?.summary() ?? 'comandos do projeto'}):`);
      for (const c of speckit) {
        const label = c.usage ?? `/${c.name}`;
        lines.push(`  ${label.padEnd(30)} ${c.description} (${c.origin})`);
      }
    }
    lines.push(
      '',
      'Shortcuts:',
      '  Esc / Ctrl+C   cancel the current response',
      '  Ctrl+C twice   exit',
      '  y / n          approve / decline a tool action',
      '  Tab / Shift+Tab  next / previous approval mode',
      '  ↑ / ↓          previous messages',
      '  PgUp / PgDn    scroll the conversation',
      '',
      `Approval modes (current: ${approvalModeInfo(ctl.approvalMode).label}):`,
      ...APPROVAL_MODES.map((m) => {
        const info = approvalModeInfo(m);
        return `  ${m.padEnd(10)} ${info.label.padEnd(16)} ${info.description}`;
      }),
      '',
      'Tools: read_file, list_directory, write_file, run_command and ask_user (the model asks you a',
      'multiple-choice question; ↑↓ / 1-9 choose, Space marks, Enter confirms, Esc declines).',
    );
    ctl.notice(lines.join('\n'), 'info');
  },
};

/** contracts/approval-modes.md § 7 — show or change the approval mode for this session. */
const approvalMode: SlashCommand = {
  name: 'approval-mode',
  aliases: ['approval'],
  usage: '/approval-mode [default|auto-edit|auto|yolo]',
  description: 'Mostrar/trocar o modo de aprovação da sessão (Tab também troca).',
  run(ctl, args) {
    const wanted = args[0];
    if (wanted === undefined) {
      const current = approvalModeInfo(ctl.approvalMode);
      const lines = [`Modo de aprovação: ${current.label} (${current.id})`, ''];
      for (const m of APPROVAL_MODES) {
        const info = approvalModeInfo(m);
        lines.push(
          `  ${m === ctl.approvalMode ? '●' : '○'} ${m.padEnd(10)} ${info.label.padEnd(16)} ${info.description}`,
        );
      }
      lines.push('', 'Tab avança, Shift+Tab volta; a troca vale só para esta sessão.');
      ctl.notice(lines.join('\n'), 'info');
      return;
    }
    const mode = parseApprovalMode(wanted);
    if (!mode) {
      ctl.notice(`Modo desconhecido '${wanted}'. Opções: ${APPROVAL_MODES.join(', ')}.`, 'warn');
      return;
    }
    if (!ctl.interactive) {
      ctl.notice('No modo -p o modo de aprovação vem de --approval-mode / --yolo.', 'info');
      return;
    }
    ctl.setApprovalMode(mode);
    ctl.notice(`Modo de aprovação: ${approvalModeInfo(mode).label} (${mode}).`, 'info');
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

export const DEFAULT_COMMANDS: SlashCommand[] = [help, auth, model, approvalMode, clear, exit];

export interface SlashOutcome {
  /** False when `input` is not a slash command. */
  handled: boolean;
  /** Set when the command asks for a model turn (Spec Kit prompt commands). */
  turn?: PromptTurn;
  /** The command refused to run (missing prerequisites); `-p` exits with the usage code. */
  blocked?: boolean;
}

/** Thrown by a command that cannot run yet; the message is shown as a warning. */
export class CommandBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandBlocked';
  }
}

/** Executes a slash command (contracts/speckit-commands.md § 2 for prompt commands). */
export async function executeSlash(input: string, ctl: SessionController): Promise<SlashOutcome> {
  const parsed = parseSlash(input);
  if (!parsed) return { handled: false };
  const cmd = ctl.commands.find((c) => c.name === parsed.name || c.aliases?.includes(parsed.name));
  if (!cmd) {
    ctl.notice(`Unknown command: /${parsed.name}. Type /help.`, 'warn');
    return { handled: true, blocked: true };
  }
  try {
    const turn = await cmd.run(ctl, parsed.args, parsed.rest);
    return turn ? { handled: true, turn } : { handled: true };
  } catch (err) {
    if (err instanceof CommandBlocked) {
      ctl.notice(err.message, 'warn');
      return { handled: true, blocked: true };
    }
    throw err;
  }
}
