import { afterEach, describe, expect, it } from 'vitest';
import { allTools, toolsFor } from '../../../src/tools/registry.js';
import { DECLINED_TEXT } from '../../../src/tools/askUser.js';
import { makeSettings } from '../../helpers/context.js';
import { cleanupSized, tick, waitForFrame } from '../../helpers/renderSized.js';
import { answer, KEYS, mountApp, toolCall } from '../../helpers/appHarness.js';
import type { HarnessOptions } from '../../helpers/appHarness.js';
import type { ProviderEvent } from '../../../src/providers/types.js';

afterEach(() => cleanupSized());

const banco = {
  question: 'Qual banco de dados devo usar?',
  header: 'Banco',
  options: [
    { label: 'Postgres (Recommended)', description: 'relacional, robusto' },
    { label: 'SQLite', description: 'arquivo local' },
  ],
};
const extras = {
  question: 'Quais extras?',
  header: 'Extras',
  options: [
    { label: 'Logs', description: 'registro' },
    { label: 'Métricas', description: 'medições' },
    { label: 'Tracing', description: 'rastreio' },
  ],
  multiSelect: true,
};
const nome = {
  question: 'Como se chama o projeto?',
  header: 'Nome',
  options: [
    { label: 'maestro', description: 'o atual' },
    { label: 'orquestra', description: 'alternativa' },
  ],
};

function mount(events: ProviderEvent[][], extra: Partial<HarnessOptions> = {}) {
  return mountApp({
    columns: 110,
    rows: 34,
    events,
    controller: { tools: allTools() },
    ...extra,
  });
}

async function send(ui: ReturnType<typeof mount>, text: string) {
  ui.stdin.write(text);
  await tick();
  ui.stdin.write(KEYS.enter);
  await tick();
}

/** The tool_result the provider received in request #1 (after the ask_user call). */
function toolResult(ui: ReturnType<typeof mount>) {
  const msg = ui.provider.requests[1]?.messages.at(-1);
  const part = msg?.content[0];
  return part?.type === 'tool_result' ? part : undefined;
}

/** contracts/ask-user.md § 3–6 */
describe('ask_user dialog (US2)', () => {
  it('shows one question, ↓+Enter answers, the model receives the formatted answer and the transcript echoes it', async () => {
    const ui = mount([
      toolCall('q1', 'ask_user', { questions: [banco] }),
      answer('Usarei SQLite.'),
    ]);
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'escolha o banco');
    await waitForFrame(ui, 'Pergunta 1 de 1 · [Banco]');
    const frame = ui.lastFrame() ?? '';
    expect(frame).toContain('Qual banco de dados devo usar?');
    expect(frame).toContain('1. Postgres (Recommended)');
    expect(frame).toContain('2. SQLite');
    expect(frame).toContain('3. Outro…');
    expect(frame).toContain('responda à pergunta acima');
    expect(frame).toContain('waiting for your answer');

    ui.stdin.write(KEYS.down);
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Usarei SQLite.');
    expect(toolResult(ui)).toMatchObject({
      isError: false,
      output: 'User has provided the following answers:\n\n**Banco**: SQLite',
    });
    expect(ui.lastFrame()).toContain('› [Banco] SQLite');
    expect(ui.controller.session.state).toBe('idle');
  });

  it('digits pick directly; multi-select needs Space; "Outro…" takes free text; several questions run in sequence', async () => {
    const ui = mount([
      toolCall('q1', 'ask_user', { questions: [banco, extras, nome] }),
      answer('anotado'),
    ]);
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'pergunte');
    await waitForFrame(ui, 'Pergunta 1 de 3 · [Banco]');
    ui.stdin.write(KEYS.digit(1));
    await waitForFrame(ui, 'Pergunta 2 de 3 · [Extras]');
    expect(ui.lastFrame()).toContain('[ ] 1. Logs');
    expect(ui.lastFrame()).toContain('Espaço marcar');

    ui.stdin.write(KEYS.enter); // nothing marked yet
    await waitForFrame(ui, 'Marque ao menos uma opção');
    ui.stdin.write(KEYS.space); // marks Logs
    await waitForFrame(ui, '[x] 1. Logs');
    ui.stdin.write(KEYS.digit(3)); // toggles Tracing
    await waitForFrame(ui, '[x] 3. Tracing');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Pergunta 3 de 3 · [Nome]');

    ui.stdin.write(KEYS.up); // → Outro…
    await waitForFrame(ui, 'Digite sua resposta');
    ui.stdin.write(KEYS.enter); // empty
    await waitForFrame(ui, 'Digite uma resposta ou volte com Esc');
    ui.stdin.write('sinfonia 2');
    await tick();
    expect(ui.lastFrame()).toContain('› sinfonia 2');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'anotado');

    expect(toolResult(ui)?.output).toBe(
      'User has provided the following answers:\n\n**Banco**: Postgres (Recommended)\n**Extras**: Logs, Tracing\n**Nome**: sinfonia 2',
    );
    const frame = ui.lastFrame() ?? '';
    expect(frame).toContain('› [Banco] Postgres (Recommended)');
    expect(frame).toContain('› [Extras] Logs, Tracing');
    expect(frame).toContain('› [Nome] sinfonia 2');
  });

  it('Esc declines: the model gets the declined text without an error and the turn continues', async () => {
    const ui = mount([toolCall('q1', 'ask_user', { questions: [banco] }), answer('tudo bem')]);
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'pergunte');
    await waitForFrame(ui, 'Pergunta 1 de 1');
    ui.stdin.write(KEYS.esc);
    await waitForFrame(ui, 'tudo bem');
    expect(toolResult(ui)).toEqual({
      type: 'tool_result',
      callId: 'q1',
      isError: false,
      output: DECLINED_TEXT,
    });
    expect(ui.lastFrame()).not.toContain('› [Banco]');
  });

  it('is asked in YOLO too, and Shift+Tab during the question only changes the mode', async () => {
    const ui = mount([toolCall('q1', 'ask_user', { questions: [banco] }), answer('ok')], {
      settings: { tools: { approvalMode: 'yolo' } },
    });
    await waitForFrame(ui, 'YOLO');
    await send(ui, 'pergunte');
    await waitForFrame(ui, 'Pergunta 1 de 1 · [Banco]');
    ui.stdin.write(KEYS.shiftTab);
    await waitForFrame(ui, 'Pedir permissão');
    expect(ui.controller.session.state).toBe('awaiting_answer');
    expect(ui.lastFrame()).toContain('Pergunta 1 de 1');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'ok');
    expect(toolResult(ui)?.output).toContain('**Banco**: Postgres (Recommended)');
  });

  it('invalid input never opens a dialog: the model gets a validation error', async () => {
    const ui = mount([
      toolCall('q1', 'ask_user', { questions: [{ ...banco, options: [banco.options[0]] }] }),
      answer('entendi'),
    ]);
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'pergunte');
    await waitForFrame(ui, 'entendi');
    expect(toolResult(ui)?.isError).toBe(true);
    expect(toolResult(ui)?.output).toMatch(/invalid input for ask_user: .*between 2 and 4 options/);
    expect(ui.stdout.frames.join('\n')).not.toContain('Pergunta 1 de 1');
  });

  it('stays available with --no-tools: toolsFor(disabled) offers only ask_user', () => {
    expect(toolsFor(makeSettings({ tools: { enabled: false } }).tools).map((t) => t.name)).toEqual([
      'ask_user',
    ]);
    expect(toolsFor(makeSettings().tools).map((t) => t.name)).toEqual([
      'read_file',
      'list_directory',
      'write_file',
      'run_command',
      'ask_user',
    ]);
  });
});
