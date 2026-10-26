import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { fileDiff } from '../../../src/tools/diff.js';
import { DECLINED_TEXT } from '../../../src/tools/askUser.js';
import {
  COMMAND_LINES,
  ERROR_LINES,
  commandLabel,
  describeCall,
  describeResult,
  fitArg,
  toolLabel,
} from '../../../src/ui/toolDisplay.js';

const ok = (output: string, display = {}) => ({ output, isError: false, display });

describe('describeCall (specs/009 research R9)', () => {
  it('labels and main argument per tool', () => {
    expect(describeCall('read_file', { path: 'src/index.ts' })).toMatchObject({
      label: 'Read',
      arg: 'src/index.ts',
      cut: 'middle',
    });
    expect(describeCall('list_directory', {})).toMatchObject({ label: 'List', arg: '.' });
    expect(describeCall('write_file', { path: 'a.txt', content: 'x' }).label).toBe('Write');
    expect(
      describeCall('run_command', { command: 'npm test' }, { platform: 'linux' }),
    ).toMatchObject({
      label: 'Bash',
      arg: 'npm test',
      cut: 'end',
    });
    expect(describeCall('run_command', { command: 'dir' }, { platform: 'win32' }).label).toBe(
      commandLabel('win32'),
    );
    expect(commandLabel('win32')).toBe('Cmd');
    expect(
      describeCall('ask_user', { questions: [{ header: 'Banco', question: 'Qual banco?' }] }),
    ).toMatchObject({ label: 'Pergunta', arg: 'Banco' });
    expect(describeCall('mystery', { a: 1, b: 'segundo' })).toMatchObject({
      label: 'mystery',
      arg: 'segundo',
    });
  });

  it('a Spec Kit step replaces the command label', () => {
    expect(
      describeCall(
        'run_command',
        { command: '.specify/scripts/bash/setup-plan.sh --json' },
        { display: { speckitStep: 'setup-plan' } },
      ),
    ).toMatchObject({ label: 'Speckit', arg: 'setup-plan' });
    expect(toolLabel('read_file', {})).toBe('Read');
  });
});

describe('describeResult (contracts/transcript.md § 2)', () => {
  it('read and list use the counts from the output header', () => {
    expect(describeResult('read_file', ok('a.txt (120 lines)\n1\tx'))).toEqual({
      tone: 'ok',
      lines: ['Leu 120 linhas'],
      more: 0,
    });
    expect(describeResult('read_file', ok('a.txt (1 lines)\n1\tx')).lines).toEqual(['Leu 1 linha']);
    expect(describeResult('list_directory', ok('src/ui (14 entries)\na\nb')).lines).toEqual([
      '14 itens',
    ]);
  });

  it('command output: first lines without the exit code, then the hidden count', () => {
    const out = ['exit code 0', ...Array.from({ length: 40 }, (_, i) => `l${i + 1}`)].join('\n');
    const r = describeResult('run_command', ok(out));
    expect(r.lines).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(r.lines).toHaveLength(COMMAND_LINES);
    expect(r.more).toBe(35);
    expect(describeResult('run_command', ok('exit code 0')).lines).toEqual(['(sem saída)']);
  });

  it('errors show the full text up to the limit', () => {
    const err = Array.from({ length: 30 }, (_, i) => `e${i}`).join('\n');
    const r = describeResult('run_command', { output: err, isError: true });
    expect(r.tone).toBe('error');
    expect(r.lines).toHaveLength(ERROR_LINES);
    expect(r.more).toBe(10);
    expect(
      describeResult('read_file', { output: 'file not found: x', isError: true }).lines,
    ).toEqual(['file not found: x']);
  });

  it('declined, cancelled, auto mode and Spec Kit', () => {
    expect(
      describeResult('write_file', {
        output: 'user declined',
        isError: true,
        display: { declined: true },
      }),
    ).toEqual({ tone: 'muted', lines: ['recusado pelo usuário'], more: 0 });
    expect(
      describeResult('run_command', { output: 'cancelled by user\nx', isError: true }).lines,
    ).toEqual(['cancelado']);
    const diff = fileDiff(null, 'x\n', 'a.txt');
    const w = describeResult(
      'write_file',
      ok('wrote 2 bytes to a.txt', { diff, autoMode: 'auto-edit' }),
    );
    expect(w.lines).toEqual(['arquivo novo · 1 linha · auto (Aceitar edições)']);
    expect(w.diff).toBe(diff);
    expect(
      describeResult(
        'run_command',
        ok('{"a":1}', { speckitStep: 'setup-plan', summary: 'plano criado' }),
      ).lines,
    ).toEqual(['plano criado']);
  });

  it('ask_user shows the answers or the lack of one', () => {
    expect(
      describeResult('ask_user', ok('User answered:\n\n**Banco**: Postgres\n**Cache**: Redis'))
        .lines,
    ).toEqual(['Banco: Postgres', 'Cache: Redis']);
    expect(describeResult('ask_user', ok(DECLINED_TEXT))).toMatchObject({
      tone: 'muted',
      lines: ['sem resposta'],
    });
  });
});

describe('fitArg', () => {
  it('keeps short text, cuts paths in the middle and commands at the end', () => {
    expect(fitArg('a.txt', 20, 'middle', stringWidth)).toBe('a.txt');
    const p = fitArg('src/very/long/path/to/some/file.ts', 15, 'middle', stringWidth);
    expect(stringWidth(p)).toBe(15);
    expect(p.startsWith('src/')).toBe(true);
    expect(p.endsWith('file.ts')).toBe(true);
    const c = fitArg('npm run build && npm test -- --reporter verbose', 12, 'end', stringWidth);
    expect(c).toBe('npm run bui…');
    expect(fitArg('a\nb', 10, 'end', stringWidth)).toBe('a b');
  });
});

describe('load_skill display (specs/013 contracts/load-skill-tool.md § 5)', () => {
  it('Skill(name[/file]) and the summary line', () => {
    expect(describeCall('load_skill', { name: 'revisao-pr' })).toEqual({
      label: 'Skill',
      arg: 'revisao-pr',
      cut: 'middle',
    });
    expect(describeCall('load_skill', { name: 'revisao-pr', file: 'references/x.md' }).arg).toBe(
      'revisao-pr/references/x.md',
    );
    const skill = (s: object) => ({
      skill: { name: 'revisao-pr', source: 'project-claude', ok: true, ...s },
    });
    expect(
      describeResult('load_skill', ok('# Skill', skill({ lines: 120, files: 3 }))).lines,
    ).toEqual(['120 linhas · 3 arquivos de referência']);
    expect(
      describeResult('load_skill', ok('# Skill', skill({ lines: 1, files: 1 }))).lines,
    ).toEqual(['1 linha · 1 arquivo de referência']);
    expect(
      describeResult('load_skill', ok('# Skill file', skill({ file: 'x.md', lines: 12 }))).lines,
    ).toEqual(['Leu 12 linhas']);
    const err = describeResult('load_skill', {
      output: 'unknown skill "x". Available: a',
      isError: true,
      display: { skill: { name: 'x', ok: false } },
    });
    expect(err.tone).toBe('error');
  });
});
