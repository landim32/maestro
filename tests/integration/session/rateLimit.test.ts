/**
 * A provider rate/usage limit never ends the turn: the Maestro waits (Retry-After, else an
 * exponential backoff capped at 5 min) and sends the same request again, in both tool loops.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { backoffMs, MAX_BACKOFF_MS, runTurn } from '../../../src/session/turn.js';
import { allTools } from '../../../src/tools/registry.js';
import type {
  ModelProvider,
  ProviderEvent,
  ProviderRequest,
} from '../../../src/providers/types.js';
import { MaestroError, retryAfterFrom } from '../../../src/utils/errors.js';
import { createFakeProvider } from '../../helpers/fakeProvider.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-rate-'));
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'a\n');
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

const limited = (retryAfterMs?: number): ProviderEvent[] => [
  { type: 'text_delta', text: 'parcial que será descartado' },
  {
    type: 'error',
    error: new MaestroError({ category: 'rate_limit', message: 'too many requests', retryAfterMs }),
  },
];

function opts(waits: number[]) {
  return {
    system: 's',
    tools: allTools(),
    toolSettings: makeSettings().tools,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe('rate limit: wait and retry, never stop', () => {
  it('built-in loop: retries the same request, drops the partial text, uses Retry-After', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude' });
    const p = createFakeProvider([
      limited(),
      limited(30_000),
      [
        { type: 'tool_call', callId: 'r', name: 'read_file', input: { path: 'a.txt' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      limited(),
      [
        { type: 'text_delta', text: 'pronto' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const waits: number[] = [];
    const notices: string[] = [];
    s.pushUser('leia');
    const r = await runTurn(s, p, opts(waits), { onNotice: (t) => notices.push(t) });
    expect(r).toMatchObject({ stopReason: 'end_turn', text: 'pronto', toolIterations: 1 });
    // attempt 1 → backoff 5 s; attempt 2 → Retry-After 30 s; after a success the counter resets
    expect(waits).toEqual([5_000, 30_000, 5_000]);
    expect(notices[0]).toMatch(
      /limite de taxa do provedor .*aguardando 5s e tentando de novo \(tentativa 1\)/,
    );
    expect(s.history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(JSON.stringify(s.history)).not.toContain('parcial que será descartado');
    // every retry repeated the same history
    expect(p.requests[1]!.messages).toHaveLength(1);
    expect(p.requests[4]!.messages).toHaveLength(3);
  });

  it('provider-driven loop (Claude Code): tool calls kept, request retried with the history', async () => {
    let call = 0;
    const requests: ProviderRequest[] = [];
    const p: ModelProvider = {
      id: 'claude-code',
      displayName: 'driven',
      capabilities: { executesTools: true },
      status: () => createFakeProvider([]).status(),
      async *stream(req) {
        requests.push({ ...req, messages: [...req.messages] });
        call++;
        if (call === 1) {
          await req.runTool!({ callId: 'd1', name: 'read_file', input: { path: 'a.txt' } });
          yield { type: 'text_delta', text: 'meio' };
          yield {
            type: 'error',
            error: new MaestroError({
              category: 'rate_limit',
              message: 'limite de uso',
              retryAfterMs: 60_000,
            }),
          };
          return;
        }
        yield { type: 'text_delta', text: 'final' };
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const waits: number[] = [];
    s.pushUser('x');
    const r = await runTurn(s, p, opts(waits));
    expect(r).toMatchObject({ stopReason: 'end_turn', text: 'final' });
    expect(waits).toEqual([60_000]);
    expect(requests[1]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(s.history.at(-1)?.content).toEqual([{ type: 'text', text: 'final' }]);
  });

  it('a cancellation during the wait ends the turn as cancelled', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude' });
    const p = createFakeProvider([limited(), limited()]);
    s.pushUser('x');
    const r = await runTurn(s, p, {
      ...opts([]),
      sleep: async () => {
        s.cancel();
      },
    });
    expect(r.stopReason).toBe('cancelled');
  });

  it('backoff doubles from 5 s and is capped at 5 min; Retry-After parsing', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([
      5_000,
      10_000,
      20_000,
      40_000,
      80_000,
      160_000,
      MAX_BACKOFF_MS,
      MAX_BACKOFF_MS,
    ]);
    expect(retryAfterFrom({ headers: { 'retry-after': '12' } })).toBe(12_000);
    expect(retryAfterFrom({ headers: new Headers({ 'retry-after': '3' }) })).toBe(3_000);
    const now = Date.parse('2026-10-25T20:00:00Z');
    expect(
      retryAfterFrom({ headers: { 'retry-after': 'Sun, 25 Oct 2026 20:00:30 GMT' } }, now),
    ).toBe(30_000);
    expect(retryAfterFrom({ headers: {} })).toBeUndefined();
    expect(retryAfterFrom(new Error('x'))).toBeUndefined();
  });
});
