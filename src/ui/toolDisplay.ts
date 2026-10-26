/**
 * How each tool call and its result are shown in the transcript (specs/009 research R9,
 * contracts/transcript.md § 2). Pure: labels, main argument and the `⎿` summary lines.
 */
import { approvalModeInfo } from '../tools/approval.js';
import { DECLINED_TEXT, NO_USER_TEXT } from '../tools/askUser.js';
import { diffHeader } from '../tools/diff.js';
import type { FileDiff } from '../tools/diff.js';
import { shellFor } from '../tools/runCommand.js';
import type { ToolResultDisplay } from '../tools/types.js';

/** Lines of command output shown under the call. */
export const COMMAND_LINES = 5;
/** Lines of an error shown under the call. */
export const ERROR_LINES = 20;

export interface CallView {
  label: string;
  arg: string;
  /** How a too-long argument is shortened. */
  cut: 'middle' | 'end';
}

export interface ResultPart {
  output: string;
  isError: boolean;
  display?: ToolResultDisplay;
}

export interface ResultView {
  tone: 'ok' | 'error' | 'muted';
  lines: string[];
  /** Hidden lines (rendered as `… +N linhas`). */
  more: number;
  diff?: FileDiff;
}

const str = (o: unknown, key: string): string | undefined => {
  if (typeof o !== 'object' || o === null) return undefined;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
};

/** Label of `run_command`: the shell the tool really uses (`cmd.exe` on Windows). */
export function commandLabel(platform: NodeJS.Platform = process.platform): string {
  return /cmd(\.exe)?$/i.test(shellFor(platform).file) ? 'Cmd' : 'Bash';
}

export function describeCall(
  name: string,
  input: unknown,
  opts: { platform?: NodeJS.Platform; display?: ToolResultDisplay } = {},
): CallView {
  if (opts.display?.speckitStep)
    return { label: 'Speckit', arg: opts.display.speckitStep, cut: 'end' };
  switch (name) {
    case 'read_file':
      return { label: 'Read', arg: str(input, 'path') ?? '', cut: 'middle' };
    case 'list_directory':
      return { label: 'List', arg: str(input, 'path') ?? '.', cut: 'middle' };
    case 'write_file':
      return { label: 'Write', arg: str(input, 'path') ?? '', cut: 'middle' };
    case 'run_command':
      return { label: commandLabel(opts.platform), arg: str(input, 'command') ?? '', cut: 'end' };
    case 'load_skill': {
      const skill = str(input, 'name') ?? '';
      const file = str(input, 'file');
      return { label: 'Skill', arg: file ? `${skill}/${file}` : skill, cut: 'middle' };
    }
    case 'ask_user': {
      const qs = (input as { questions?: Array<{ header?: unknown; question?: unknown }> } | null)
        ?.questions;
      const first = Array.isArray(qs) ? qs[0] : undefined;
      const arg =
        typeof first?.header === 'string' && first.header
          ? first.header
          : typeof first?.question === 'string'
            ? first.question
            : '';
      return { label: 'Pergunta', arg, cut: 'end' };
    }
    default: {
      const firstString =
        typeof input === 'object' && input !== null
          ? Object.values(input as Record<string, unknown>).find((v) => typeof v === 'string')
          : undefined;
      return { label: name, arg: typeof firstString === 'string' ? firstString : '', cut: 'end' };
    }
  }
}

/** Short label used by the activity line while a tool runs (`Executando Bash…`). */
export function toolLabel(name: string, input: unknown): string {
  return describeCall(name, input).label;
}

function lines(text: string): string[] {
  const out = text.replace(/\r\n/g, '\n').split('\n');
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

function take(all: string[], max: number): { lines: string[]; more: number } {
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeResult(name: string, part: ResultPart): ResultView {
  const d = part.display;
  const auto = d?.autoMode ? ` · auto (${approvalModeInfo(d.autoMode).label})` : '';
  const withAuto = (v: ResultView): ResultView =>
    auto && v.lines.length > 0 ? { ...v, lines: [v.lines[0] + auto, ...v.lines.slice(1)] } : v;

  if (d?.declined || part.output === 'user declined')
    return { tone: 'muted', lines: ['recusado pelo usuário'], more: 0 };
  if (part.output.startsWith('cancelled by user'))
    return { tone: 'muted', lines: ['cancelado'], more: 0 };
  if (part.isError) return { tone: 'error', ...take(lines(part.output), ERROR_LINES) };
  if (d?.speckitStep)
    return { tone: 'ok', lines: [d.summary ?? lines(part.output)[0] ?? 'ok'], more: 0 };

  const out = lines(part.output);
  switch (name) {
    case 'read_file': {
      const m = /\((\d+) lines/.exec(out[0] ?? '');
      return withAuto({
        tone: 'ok',
        lines: [m ? `Leu ${plural(Number(m[1]), 'linha', 'linhas')}` : (out[0] ?? '')],
        more: 0,
      });
    }
    case 'list_directory': {
      const m = /\((\d+) entries\)/.exec(out[0] ?? '');
      return withAuto({
        tone: 'ok',
        lines: [m ? plural(Number(m[1]), 'item', 'itens') : (out[0] ?? '')],
        more: 0,
      });
    }
    case 'write_file':
      return withAuto({
        tone: 'ok',
        lines: [d?.diff ? diffHeader(d.diff, 'transcript') : (out[0] ?? '')],
        more: 0,
        diff: d?.diff,
      });
    case 'run_command': {
      const body = /^exit code /.test(out[0] ?? '') ? out.slice(1) : out;
      const view = body.length ? take(body, COMMAND_LINES) : { lines: ['(sem saída)'], more: 0 };
      return withAuto({ tone: 'ok', ...view });
    }
    case 'load_skill': {
      const s = d?.skill;
      if (!s?.ok) return { tone: 'ok', lines: [out[0] ?? ''], more: 0 };
      const read = plural(s.lines ?? 0, 'linha', 'linhas');
      const refs = plural(s.files ?? 0, 'arquivo de referência', 'arquivos de referência');
      return withAuto({
        tone: 'ok',
        lines: [s.file ? `Leu ${read}` : `${read} · ${refs}`],
        more: 0,
      });
    }
    case 'ask_user': {
      if (part.output === DECLINED_TEXT) return { tone: 'muted', lines: ['sem resposta'], more: 0 };
      if (part.output === NO_USER_TEXT)
        return { tone: 'muted', lines: ['sem usuário para responder'], more: 0 };
      const answers = out.filter((l) => l.startsWith('**')).map((l) => l.replace(/\*\*/g, ''));
      return { tone: 'ok', ...take(answers.length ? answers : out.slice(0, 1), 4) };
    }
    default:
      return withAuto({ tone: 'ok', lines: [out[0] ?? ''], more: 0 });
  }
}

/** Shortens `text` to `max` columns: keeps both ends (paths) or the start (commands). */
export function fitArg(
  text: string,
  max: number,
  cut: 'middle' | 'end',
  measure: (t: string) => number,
): string {
  const oneLine = text.replace(/\s*\r?\n\s*/g, ' ');
  if (max <= 1) return '…';
  if (measure(oneLine) <= max) return oneLine;
  const chars = [...oneLine];
  if (cut === 'end') {
    let out = '';
    for (const c of chars) {
      if (measure(out + c) > max - 1) break;
      out += c;
    }
    return `${out}…`;
  }
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${chars.slice(0, head).join('')}…${tail > 0 ? chars.slice(-tail).join('') : ''}`;
}
