import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
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

function make(provider: ModelProvider, tools = allTools()) {
  const session = new Session({ cwd: process.cwd(), activeProviderId: 'claude' });
  const controller = new SessionController({
    session,
    ctx: makeCtx(),
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
