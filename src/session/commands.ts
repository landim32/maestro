import type { ProviderId } from '../providers/types.js';
import type { MethodId } from '../setup/methods.js';
import type { PromptTurn } from '../speckit/prompt.js';
import { APPROVAL_MODES, approvalModeInfo, parseApprovalMode } from '../tools/approval.js';
import { routeNamesText } from '../routes/catalog.js';
import type { RouteEntry } from '../routes/catalog.js';
import type { SessionController } from './controller.js';
import { statusText } from '../autopilot/report.js';
import { readRunState } from '../autopilot/state.js';
import { findSpecifyRoot } from '../speckit/feature.js';
import { skillsReport } from '../skills/catalog.js';

function autopilotStatusText(cwd: string): string {
  return statusText(readRunState(findSpecifyRoot(cwd)));
}

export type { PromptTurn };

export interface SlashCommand {
  name: string;
  aliases?: string[];
  usage?: string;
  description: string;
  /** Where the command comes from (`/help` shows it); undefined for built-ins. */
  origin?: string;
  /**
   * `'prompt'`: sends a prompt to the model and therefore has its own route;
   * `'route'`: forces a route itself (`/ask`, purpose shortcuts) and is not listed as a route (specs/008).
   */
  kind?: 'prompt' | 'route';
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
    const aliases = ctl.commands.filter((c) => c.origin === 'rota');
    const speckit = ctl.commands.filter((c) => c.origin && c.origin !== 'rota');
    for (const c of builtin) {
      const names = [c.name, ...(c.aliases ?? [])].map((n) => `/${n}`).join(', ');
      lines.push(`  ${(c.usage ?? names).padEnd(26)} ${c.description}`);
    }
    for (const c of aliases) {
      lines.push(`  ${(c.usage ?? `/${c.name}`).padEnd(26)} (atalho da rota ${c.name})`);
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
      '  Shift+Tab      next approval mode',
      '  Tab / →        accept the highlighted command suggestion',
      '  ↑ / ↓          previous messages',
      '  PgUp / PgDn    scroll the conversation',
      '  Ctrl+O         show the content behind a [Pasted text] / [Arquivo] marker',
      '',
      'Paste & copy: a paste longer than ui.pasteCollapseLines becomes a [Pasted text #N +L lines]',
      'marker (the model receives the full text); pasted file paths become [Arquivo: …] attachments;',
      'with the mouse on, drag over the conversation to select and copy (double click = word,',
      "triple = line). /mouse off restores the terminal's own selection.",
      '',
      `Approval modes (current: ${approvalModeInfo(ctl.approvalMode).label}):`,
      ...APPROVAL_MODES.map((m) => {
        const info = approvalModeInfo(m);
        return `  ${m.padEnd(10)} ${info.label.padEnd(16)} ${info.description}`;
      }),
      '',
      'Tools: read_file, list_directory, edit_file, write_file, run_command and ask_user (the model asks you a',
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

/** specs/008 contracts/routes-dialog.md § 6 — send one request through a named route. */
const ask: SlashCommand = {
  name: 'ask',
  usage: '/ask <rota> <pedido>',
  description: 'Envia o pedido por uma rota (chat, github, infra, um comando ou uma rota sua).',
  kind: 'route',
  run(ctl, args, rest) {
    const route = args[0]?.toLowerCase();
    const text = (rest ?? '').replace(/^\S+\s*/, '').trim();
    const entries = ctl.routeEntries();
    const known = entries.some((e) => e.name === route && !e.missingCommand);
    if (!route || !known || text === '') {
      ctl.notice(`Uso: /ask <rota> <pedido>. Rotas: ${routeNamesText(entries)}`, 'warn');
      return;
    }
    return { display: `/ask ${route} ${text}`, prompt: text, route };
  },
};

/** specs/008 contracts/routes-dialog.md § 1 — the routes dialog (or a text table in -p). */
const routes: SlashCommand = {
  name: 'routes',
  description: 'Configurar as rotas por modelo (chat, github, infra e cada comando).',
  run(ctl) {
    if (!ctl.interactive) {
      ctl.notice(routesTableText(ctl.routeEntries()), 'info');
      return;
    }
    ctl.setup.openRoutes();
  },
};

/** `nome  provedor / modelo  origem  disponibilidade` for every known route. */
export function routesTableText(entries: readonly RouteEntry[]): string {
  const lines = ['Rotas por modelo:'];
  const w = Math.max(10, ...entries.map((e) => e.name.length));
  for (const e of entries) {
    const target = `${e.resolved.provider} / ${e.resolved.model}${e.resolved.effort ? ` · ${e.resolved.effort}` : ''}`;
    const origin =
      e.origin === 'default'
        ? `padrão (segue ${e.follows === 'active' ? 'o ativo' : 'chat'})`
        : e.origin;
    const flags = [
      e.available ? '' : 'indisponível',
      e.missingCommand ? 'comando ausente' : '',
      e.alias === 'collides' ? 'atalho em colisão' : '',
    ].filter(Boolean);
    lines.push(
      `  ${e.name.padEnd(w)}  ${target.padEnd(36)}  ${origin}${flags.length ? `  · ${flags.join(' · ')}` : ''}`,
    );
  }
  return lines.join('\n');
}

/** specs/007 contracts/mouse-selection.md § 5 — mouse tracking (wheel + selection) for this session. */
const mouse: SlashCommand = {
  name: 'mouse',
  usage: '/mouse [on|off]',
  description: 'Ligar/desligar o mouse (rolagem e seleção com cópia); sem argumento alterna.',
  run(ctl, args) {
    const arg = args[0]?.toLowerCase();
    if (arg !== undefined && arg !== 'on' && arg !== 'off') {
      ctl.notice(`Uso: /mouse [on|off] (recebido '${args[0]}').`, 'warn');
      return;
    }
    if (!ctl.interactive) {
      ctl.notice(
        'No modo -p não há mouse; a opção vale para a sessão interativa (ui.mouse).',
        'info',
      );
      return;
    }
    const on = arg === undefined ? !ctl.mouseEnabled : arg === 'on';
    ctl.setMouse(on);
    ctl.notice(
      on
        ? 'Mouse ligado: a roda rola a conversa e arrastar seleciona e copia.'
        : 'Mouse desligado: use PgUp/PgDn para rolar; a seleção nativa do terminal volta a funcionar.',
      'info',
    );
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

const METHOD_IDS: readonly MethodId[] = [
  'claude-api',
  'claude-login',
  'claude-code',
  'codex',
  'qwen',
];

const auth: SlashCommand = {
  name: 'auth',
  aliases: ['connect', 'login'],
  usage: '/auth [claude-api|claude-login|claude-code|codex|qwen]',
  description:
    'Conectar um provedor de IA (Claude API e Claude Auth Login consomem créditos de API; Claude Code usa a assinatura; Qwen).',
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

/** `/autopilot` (specs/011 contracts/autopilot-cli.md § 1): a local command, the turns are the steps'. */
const autopilot: SlashCommand = {
  name: 'autopilot',
  usage: '/autopilot <arquivo | prompt> [--resume] | --continue [feature] | --status',
  description:
    'Executa as histórias do arquivo (ou o prompt, como uma história) por todo o Spec Kit, sem interação.',
  async run(ctl, args, rest) {
    if (ctl.session.state !== 'idle' || ctl.autopilotStatus) {
      ctl.notice('Aguarde a resposta (ou a execução do autopiloto) terminar.', 'warn');
      return;
    }
    if (args.includes('--status')) {
      ctl.notice(autopilotStatusText(ctl.session.cwd), 'info');
      return;
    }
    const resume = args.includes('--resume');
    // A feature started outside the autopilot (by hand, in Claude Code…) continues from its artifacts.
    const cont = args.includes('--continue');
    // The raw text keeps a prompt's line breaks; only the flags are taken out.
    const input = (rest ?? '').replace(/(^|\s)--(resume|continue)(?=\s|$)/g, '$1').trim();
    if (!input && !resume && !cont) {
      ctl.notice(
        'Uso: /autopilot <arquivo de histórias | prompt> [--resume] · /autopilot --continue [feature] · /autopilot --status',
        'warn',
      );
      return;
    }
    const result = await ctl
      .createAutopilot()
      .start(input || undefined, { resume, continue: cont });
    ctl.notice(result.report, result.code === 0 ? 'info' : 'warn');
  },
};

const skills: SlashCommand = {
  name: 'skills',
  description: 'List the skills found (.claude/skills, .agents/skills, ~/.claude/skills).',
  run(ctl) {
    const s = ctl.skills;
    ctl.notice(skillsReport(s.catalog, s.state, { cwd: ctl.session.cwd, home: s.home }), 'info');
  },
};

export const DEFAULT_COMMANDS: SlashCommand[] = [
  help,
  auth,
  model,
  routes,
  ask,
  approvalMode,
  mouse,
  autopilot,
  skills,
  clear,
  exit,
];

export interface SlashOutcome {
  /** False when `input` is not a slash command. */
  handled: boolean;
  /** Set when the command asks for a model turn (Spec Kit prompt commands). */
  turn?: PromptTurn;
  /** The command refused to run (missing prerequisites); `-p` exits with the usage code. */
  blocked?: boolean;
  /** The command that ran (name and kind), for route resolution (specs/008). */
  command?: Pick<SlashCommand, 'name' | 'kind'>;
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
  const command = { name: cmd.name, kind: cmd.kind };
  try {
    const turn = await cmd.run(ctl, parsed.args, parsed.rest);
    return turn ? { handled: true, turn, command } : { handled: true, command };
  } catch (err) {
    if (err instanceof CommandBlocked) {
      ctl.notice(err.message, 'warn');
      return { handled: true, blocked: true };
    }
    throw err;
  }
}
