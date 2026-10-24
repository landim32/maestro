import { describe, expect, it, vi } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { runTurn } from '../../../src/session/turn.js';
import { MaestroError } from '../../../src/utils/errors.js';
import { createFakeProvider, textProvider } from '../../helpers/fakeProvider.js';
import { makeSettings } from '../../helpers/context.js';

const toolSettings = makeSettings().tools;
const opts = { system: 'sys', tools: [], toolSettings };

describe('runTurn — text turns', () => {
  it('streams deltas, records the assistant message and returns to idle', async () => {
    const s = new Session({ cwd: '/w', activeProviderId: 'claude' });
    const p = textProvider(['Hello world']);
    s.pushUser('hi');
    const deltas: string[] = [];
    const r = await runTurn(s, p, opts, { onDelta: (t) => deltas.push(t) });
    expect(deltas.join('')).toBe('Hello world');
    expect(r.stopReason).toBe('end_turn');
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(s.state).toBe('idle');
    expect(s.history.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(s.history[1]).toMatchObject({
      providerId: 'claude',
      content: [{ type: 'text', text: 'Hello world' }],
    });
  });

  it('sends the full history (context) and the system prompt on the second turn', async () => {
    const s = new Session({ cwd: '/w', activeProviderId: 'claude', modelOverride: 'm-x' });
    const p = textProvider(['A', 'B']);
    s.pushUser('one');
    await runTurn(s, p, opts);
    s.pushUser('two');
    await runTurn(s, p, opts);
    expect(p.requests).toHaveLength(2);
    expect(p.requests[1]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(p.requests[1]?.system).toBe('sys');
    expect(p.requests[1]?.model).toBe('m-x');
    expect(s.history[3]?.model).toBe('m-x');
  });

  it('keeps partial text when cancelled and reports cancelled', async () => {
    const s = new Session({ cwd: '/w', activeProviderId: 'claude' });
    const p = createFakeProvider(
      [
        [
          { type: 'text_delta', text: 'part' },
          { type: 'text_delta', text: 'ial' },
          { type: 'text_delta', text: ' never' },
          { type: 'done', stopReason: 'end_turn' },
        ],
      ],
      { delayMs: 20 },
    );
    s.pushUser('go');
    const run = runTurn(s, p, opts, {
      onDelta: (t) => {
        if (t === 'ial') s.cancel();
      },
    });
    const r = await run;
    expect(r.stopReason).toBe('cancelled');
    expect(s.history[1]?.content).toEqual([{ type: 'text', text: 'partial' }]);
    expect(s.state).toBe('idle');
  });

  it('does not record an empty assistant message on error and surfaces the error', async () => {
    const s = new Session({ cwd: '/w', activeProviderId: 'claude' });
    const err = new MaestroError({ category: 'auth', message: 'bad key', providerId: 'claude' });
    const p = createFakeProvider([[{ type: 'error', error: err }]]);
    s.pushUser('hi');
    const onError = vi.fn();
    const r = await runTurn(s, p, opts, { onError });
    expect(r.stopReason).toBe('error');
    expect(r.error).toBe(err);
    expect(onError).toHaveBeenCalledWith(err);
    expect(s.history).toHaveLength(1);
    expect(s.state).toBe('idle');
  });

  it('warns on max_tokens and refusal but keeps the text', async () => {
    const s = new Session({ cwd: '/w', activeProviderId: 'claude' });
    const p = createFakeProvider([
      [
        { type: 'text_delta', text: 'cut' },
        { type: 'done', stopReason: 'max_tokens' },
      ],
      [{ type: 'done', stopReason: 'refusal', detail: 'policy' }],
    ]);
    const notices: string[] = [];
    s.pushUser('a');
    await runTurn(s, p, opts, { onNotice: (t) => notices.push(t) });
    s.pushUser('b');
    await runTurn(s, p, opts, { onNotice: (t) => notices.push(t) });
    expect(notices[0]).toMatch(/max_tokens/);
    expect(notices[1]).toMatch(/declined.*policy/);
    expect(s.history[1]?.content).toEqual([{ type: 'text', text: 'cut' }]);
  });

  it('handles a provider that throws synchronously inside the iterator', async () => {
    const s = new Session({ cwd: '/w', activeProviderId: 'claude' });
    const p = {
      id: 'claude' as const,
      displayName: 'x',
      status: () => ({}) as never,
      async *stream() {
        throw new Error('kaboom');
      },
    };
    s.pushUser('hi');
    const r = await runTurn(s, p, opts);
    expect(r.stopReason).toBe('error');
    expect(r.error?.message).toBe('kaboom');
    expect(s.state).toBe('idle');
  });

  it('notices when the model asks for a tool but none are available', async () => {
    const s = new Session({ cwd: '/w', activeProviderId: 'claude' });
    const p = createFakeProvider([
      [
        { type: 'tool_call', callId: 'c', name: 'read_file', input: {} },
        { type: 'done', stopReason: 'tool_use' },
      ],
    ]);
    const notices: string[] = [];
    s.pushUser('read');
    const r = await runTurn(s, p, opts, { onNotice: (t) => notices.push(t) });
    // unknown tool → one iteration with an error result, then the fake provider ends the next call
    expect(r.toolIterations).toBe(1);
    expect(s.history[2]?.content[0]).toMatchObject({ type: 'tool_result', isError: true });
    void notices;
  });
});
