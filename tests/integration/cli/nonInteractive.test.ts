import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { SettingsInput } from '../../../src/config/schema.js';
import { runNonInteractive } from '../../../src/cli/nonInteractive.js';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { allTools } from '../../../src/tools/registry.js';
import { MaestroError } from '../../../src/utils/errors.js';
import type { ModelProvider, ProviderEvent } from '../../../src/providers/types.js';
import { makeCtx } from '../../helpers/context.js';
import { createFakeProvider, textProvider } from '../../helpers/fakeProvider.js';

function sink() {
  const parts: string[] = [];
  return { write: (s: string) => parts.push(s), text: () => parts.join('') };
}

function make(
  provider: ModelProvider,
  tools = allTools(),
  opts: { settings?: SettingsInput; cwd?: string } = {},
) {
  const session = new Session({ cwd: opts.cwd ?? process.cwd(), activeProviderId: 'claude' });
  const controller = new SessionController({
    session,
    ctx: makeCtx(opts.settings ?? {}),
    tools,
    system: 'sys',
    interactive: false,
    providerOverride: () => provider,
  });
  const stdout = sink();
  const stderr = sink();
  return { controller, stdout, stderr, session };
}

describe('non-interactive mode (-p)', () => {
  it('prints only the answer to stdout, ends with a newline and exits 0', async () => {
    const { controller, stdout, stderr } = make(textProvider(['Olá, mundo']));
    const code = await runNonInteractive({
      controller,
      prompt: 'diga olá',
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(0);
    expect(stdout.text()).toBe('Olá, mundo\n');
    expect(stderr.text()).toBe('');
    // no banner, no alternate-screen or mouse escapes in non-interactive mode (FR-014, FR-021)
    expect(stdout.text() + stderr.text()).not.toMatch(/♪|███|\x1b\[\?1049|\x1b\[\?1002/);
  });

  it('has no input history: nothing is recorded or created in -p (contracts/history.md § 2)', async () => {
    const { controller, stdout, stderr } = make(textProvider(['ok']));
    expect(controller.history).toBeUndefined();
    const code = await runNonInteractive({
      controller,
      prompt: 'remember me?',
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(0);
    expect(controller.history).toBeUndefined();
  });

  it('/auth prints guidance instead of opening a dialog, exit 0', async () => {
    const { controller, stdout, stderr } = make(textProvider(['x']));
    const code = await runNonInteractive({
      controller,
      prompt: '/auth',
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(0);
    expect(controller.dialog).toBeUndefined();
    expect(stdout.text() + stderr.text()).toMatch(
      /Configuração interativa indisponível no modo -p/,
    );
    expect(stdout.text() + stderr.text()).toMatch(/DASHSCOPE_API_KEY/);
  });

  it('/model without args prints the textual table in non-interactive mode', async () => {
    const { controller, stdout, stderr } = make(textProvider(['x']));
    const code = await runNonInteractive({
      controller,
      prompt: '/model',
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(0);
    expect(controller.dialog).toBeUndefined();
    expect(stdout.text() + stderr.text()).toContain('Active: claude');
    expect(stdout.text() + stderr.text()).toMatch(/Models:\n\s+claude:\s+\* claude-opus-5-5/);
  });

  it('writes raw markdown (no terminal formatting) in non-interactive mode', async () => {
    const md = '# Título\n\n- item **forte**\n\n```ts\nconst a = 1;\n```\n';
    const { controller, stdout, stderr } = make(textProvider([md]));
    await runNonInteractive({ controller, prompt: 'md', stdout, stderr, handleSignals: false });
    expect(stdout.text()).toBe(md);
  });

  it('reads the prompt from stdin when prompt is "-"', async () => {
    const { controller, stdout, stderr, session } = make(textProvider(['ok']));
    const stdin = Readable.from(['from ', 'stdin\n']);
    const code = await runNonInteractive({
      controller,
      prompt: '-',
      stdin,
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(0);
    expect(session.history[0]?.content[0]).toEqual({ type: 'text', text: 'from stdin' });
    expect(stdout.text()).toBe('ok\n');
  });

  it('writes errors to stderr and exits 1', async () => {
    const err = new MaestroError({
      category: 'auth',
      providerId: 'qwen',
      message: 'the API key was rejected (401)',
      hint: 'Set DASHSCOPE_API_KEY',
    });
    const { controller, stdout, stderr } = make(
      createFakeProvider([[{ type: 'error', error: err }]]),
    );
    const code = await runNonInteractive({
      controller,
      prompt: 'oi',
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toMatch(
      /\[error\] qwen: authentication failed — the API key was rejected \(401\)/,
    );
    expect(stderr.text()).toMatch(/hint: Set DASHSCOPE_API_KEY/);
  });

  it('auto-declines tool confirmations and still answers', async () => {
    const events: ProviderEvent[][] = [
      [
        {
          type: 'tool_call',
          callId: 'w',
          name: 'write_file',
          input: { path: 'never.txt', content: 'x' },
        },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text_delta', text: 'could not write' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ];
    const { controller, stdout, stderr, session } = make(createFakeProvider(events));
    const code = await runNonInteractive({
      controller,
      prompt: 'write',
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(0);
    expect(stdout.text()).toBe('could not write\n');
    const result = session.history[2]?.content[0];
    expect(result?.type === 'tool_result' && result.output).toMatch(
      /not available in non-interactive mode/,
    );
  });

  /** specs/005 contracts/approval-modes.md § 6 — the approval mode decides what runs in -p */
  it('obeys tools.approvalMode: auto writes and runs plain commands, asks (= declines) destructive ones; yolo runs all', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-p-'));
    try {
      const script = (): ProviderEvent[][] => [
        [
          {
            type: 'tool_call',
            callId: 'w',
            name: 'write_file',
            input: { path: 'a.txt', content: '1' },
          },
          { type: 'done', stopReason: 'tool_use' },
        ],
        [
          { type: 'tool_call', callId: 'r', name: 'run_command', input: { command: 'rm -rf tmp' } },
          { type: 'done', stopReason: 'tool_use' },
        ],
        [
          { type: 'text_delta', text: 'fim' },
          { type: 'done', stopReason: 'end_turn' },
        ],
      ];
      const outputs = (session: Session) =>
        session.history
          .filter((m) => m.role === 'tool')
          .map((m) => (m.content[0]?.type === 'tool_result' ? m.content[0] : undefined));

      // default: everything that needs confirmation is declined with the mode in the message
      let t = make(createFakeProvider(script()), allTools(), { cwd });
      await runNonInteractive({ ...t, prompt: 'go', handleSignals: false });
      expect(outputs(t.session).map((r) => r?.output)).toEqual([
        'confirmation required (default); not available in non-interactive mode',
        'confirmation required (default); not available in non-interactive mode',
      ]);
      expect(fs.existsSync(path.join(cwd, 'a.txt'))).toBe(false);

      // auto: the write runs and is announced on stderr; the destructive command is declined
      t = make(createFakeProvider(script()), allTools(), {
        cwd,
        settings: { tools: { approvalMode: 'auto' } },
      });
      await runNonInteractive({ ...t, prompt: 'go', handleSignals: false });
      expect(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8')).toBe('1');
      expect(t.stderr.text()).toMatch(
        /⚙ write_file a\.txt {2}· {2}new file: a\.txt \(1 lines\) {2}· {2}auto \(Automático\)/,
      );
      expect(outputs(t.session)[1]?.output).toBe(
        'confirmation required (auto); not available in non-interactive mode',
      );
      expect(t.stdout.text()).toBe('fim\n');

      // yolo: both run (rm -rf of a missing dir just reports a non-zero exit, never a decline)
      t = make(createFakeProvider(script()), allTools(), {
        cwd,
        settings: { tools: { approvalMode: 'yolo' } },
      });
      await runNonInteractive({ ...t, prompt: 'go', handleSignals: false });
      expect(outputs(t.session)[1]?.output).not.toMatch(/confirmation required/);
      expect(t.stderr.text()).toMatch(
        /⚙ run_command rm -rf tmp {2}· {2}\$ rm -rf tmp {2}· {2}auto \(YOLO\)/,
      );
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  /** specs/005 contracts/ask-user.md § 4 — no user to answer in -p */
  it('ask_user in -p tells the model no user is available (not an error) and still answers', async () => {
    const events: ProviderEvent[][] = [
      [
        {
          type: 'tool_call',
          callId: 'q',
          name: 'ask_user',
          input: {
            questions: [
              {
                question: 'Qual?',
                header: 'Q',
                options: [
                  { label: 'a', description: 'A' },
                  { label: 'b', description: 'B' },
                ],
              },
            ],
          },
        },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text_delta', text: 'assumi a' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ];
    const { controller, stdout, stderr, session } = make(createFakeProvider(events));
    const code = await runNonInteractive({
      controller,
      prompt: 'pergunte',
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(0);
    expect(stdout.text()).toBe('assumi a\n');
    const result = session.history[2]?.content[0];
    expect(result?.type === 'tool_result' && result.isError).toBe(false);
    expect(result?.type === 'tool_result' && result.output).toMatch(
      /no interactive user is available/,
    );
    expect(session.state).toBe('idle');
  });

  it('runs read-only tools and reports progress on stderr', async () => {
    const events: ProviderEvent[][] = [
      [
        { type: 'tool_call', callId: 'l', name: 'list_directory', input: {} },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text_delta', text: 'listed' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ];
    const { controller, stdout, stderr } = make(createFakeProvider(events));
    await runNonInteractive({ controller, prompt: 'ls', stdout, stderr, handleSignals: false });
    expect(stdout.text()).toBe('listed\n');
    expect(stderr.text()).toMatch(/⚙ list_directory/);
  });

  it('with --no-tools the provider receives no tools', async () => {
    const p = textProvider(['x']);
    const { controller, stdout, stderr } = make(p, []);
    await runNonInteractive({ controller, prompt: 'hi', stdout, stderr, handleSignals: false });
    expect(p.requests[0]?.tools).toEqual([]);
  });

  it('returns 130 when cancelled', async () => {
    const p = createFakeProvider(
      [
        [
          { type: 'text_delta', text: 'a' },
          { type: 'text_delta', text: 'b' },
          { type: 'done', stopReason: 'end_turn' },
        ],
      ],
      { delayMs: 40 },
    );
    const { controller, stdout, stderr } = make(p);
    setTimeout(() => controller.cancel(), 60);
    const code = await runNonInteractive({
      controller,
      prompt: 'go',
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(130);
  });

  it('rejects an empty stdin prompt with exit 2', async () => {
    const { controller, stdout, stderr } = make(textProvider(['x']));
    const code = await runNonInteractive({
      controller,
      prompt: '-',
      stdin: Readable.from(['  \n']),
      stdout,
      stderr,
      handleSignals: false,
    });
    expect(code).toBe(2);
    expect(stderr.text()).toMatch(/empty prompt/);
  });
});

describe('non-interactive mode keeps its output (specs/009 SC-007, contracts/transcript.md § 5)', () => {
  it('stdout is only the answer; ⚙ progress stays on stderr; no ✻ summary, ⏺ or ⎿', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-p-009-'));
    try {
      fs.writeFileSync(path.join(cwd, 'notes.txt'), 'olá\n');
      const provider = createFakeProvider([
        [
          { type: 'tool_call', callId: 'c1', name: 'read_file', input: { path: 'notes.txt' } },
          { type: 'done', stopReason: 'tool_use' },
        ],
        [
          { type: 'text_delta', text: 'O arquivo diz olá.' },
          { type: 'usage', inputTokens: 3, outputTokens: 5 },
          { type: 'done', stopReason: 'end_turn' },
        ],
      ]);
      const { controller, stdout, stderr } = make(provider, allTools(), { cwd });
      const code = await runNonInteractive({
        controller,
        prompt: 'o que diz notes.txt?',
        stdout,
        stderr,
        handleSignals: false,
      });
      expect(code).toBe(0);
      expect(stdout.text()).toBe('O arquivo diz olá.\n');
      expect(stderr.text()).toBe('⚙ read_file notes.txt\n');
      expect(stdout.text() + stderr.text()).not.toMatch(/✻|⏺|⎿/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
