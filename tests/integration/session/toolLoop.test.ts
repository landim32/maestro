import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { runTurn } from '../../../src/session/turn.js';
import { allTools } from '../../../src/tools/registry.js';
import type { ProviderEvent } from '../../../src/providers/types.js';
import { createFakeProvider } from '../../helpers/fakeProvider.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
const toolSettings = { ...makeSettings().tools, commandTimeoutMs: 2000 };

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-loop-'));
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'hello notes');
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

const toolCall = (callId: string, name: string, input: unknown): ProviderEvent[] => [
  { type: 'tool_call', callId, name, input },
  { type: 'done', stopReason: 'tool_use' },
];
const answer = (text: string): ProviderEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];

function opts() {
  return { system: 'sys', tools: allTools(), toolSettings };
}

describe('tool loop', () => {
  it('runs read_file without confirmation, feeds the result back and answers', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude' });
    const p = createFakeProvider([
      toolCall('c1', 'read_file', { path: 'notes.txt' }),
      answer('It says hello notes'),
    ]);
    s.pushUser('what is in notes.txt?');
    const r = await runTurn(s, p, opts());
    expect(r.stopReason).toBe('end_turn');
    expect(r.toolIterations).toBe(1);
    expect(s.history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    const result = s.history[2]?.content[0];
    expect(result?.type === 'tool_result' && result.output).toContain('hello notes');
    // second request carried the tool result
    expect(p.requests[1]?.messages).toHaveLength(3);
  });

  it('asks for confirmation on write_file; approval writes, decline reports "user declined"', async () => {
    for (const approve of [true, false]) {
      const s = new Session({ cwd, activeProviderId: 'claude' });
      const p = createFakeProvider([
        toolCall('w1', 'write_file', { path: `out-${approve}.txt`, content: 'data' }),
        answer('done'),
      ]);
      s.pushUser('write it');
      const seen: string[] = [];
      let stateDuringConfirm = '';
      const r = await runTurn(s, p, opts(), {
        confirm: async (a) => {
          seen.push(a.previewText);
          stateDuringConfirm = s.state;
          return approve;
        },
      });
      expect(r.stopReason).toBe('end_turn');
      expect(stateDuringConfirm).toBe('awaiting_confirmation');
      expect(seen[0]).toContain('new file: out-' + approve + '.txt');
      expect(fs.existsSync(path.join(cwd, `out-${approve}.txt`))).toBe(approve);
      const result = s.history[2]?.content[0];
      expect(result?.type === 'tool_result' && result.isError).toBe(!approve);
      if (!approve) expect(result?.type === 'tool_result' && result.output).toBe('user declined');
      expect(s.state).toBe('idle');
    }
  });

  it('resolves confirmation through session.pendingConfirmation (UI path)', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude' });
    const p = createFakeProvider([
      toolCall('w1', 'write_file', { path: 'ui.txt', content: 'x' }),
      answer('ok'),
    ]);
    s.pushUser('write');
    const never = () => new Promise<boolean>(() => {});
    const run = runTurn(s, p, opts(), { confirm: never });
    await new Promise((r) => setTimeout(r, 30));
    expect(s.state).toBe('awaiting_confirmation');
    expect(s.pendingConfirmation?.tool.name).toBe('write_file');
    s.pendingConfirmation!.resolve(true);
    const r = await run;
    expect(r.stopReason).toBe('end_turn');
    expect(fs.existsSync(path.join(cwd, 'ui.txt'))).toBe(true);
  });

  it('auto-declines confirmations when no confirm callback is provided (non-interactive)', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude' });
    const p = createFakeProvider([
      toolCall('r1', 'run_command', { command: 'node -v' }),
      answer('ok'),
    ]);
    s.pushUser('run');
    await runTurn(s, p, opts());
    const result = s.history[2]?.content[0];
    expect(result?.type === 'tool_result' && result.output).toMatch(
      /not available in non-interactive mode/,
    );
  });

  it('turns invalid tool input and sandbox violations into error results instead of crashing', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude' });
    const p = createFakeProvider([
      toolCall('b1', 'read_file', { nope: 1 }),
      toolCall('b2', 'read_file', { path: '../../etc/passwd' }),
      answer('fine'),
    ]);
    s.pushUser('go');
    const r = await runTurn(s, p, opts());
    expect(r.stopReason).toBe('end_turn');
    const first = s.history[2]?.content[0];
    const second = s.history[4]?.content[0];
    expect(first?.type === 'tool_result' && first.isError && first.output).toMatch(
      /invalid input for read_file/,
    );
    expect(second?.type === 'tool_result' && second.isError && second.output).toMatch(
      /outside workspace/,
    );
  });

  it('stops after the maximum number of tool iterations with a warning', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude' });
    const p = createFakeProvider(() => toolCall('x', 'list_directory', {}));
    s.pushUser('loop forever');
    const notices: string[] = [];
    const r = await runTurn(
      s,
      p,
      { ...opts(), maxToolIterations: 3 },
      { onNotice: (t) => notices.push(t) },
    );
    expect(r.toolIterations).toBe(3);
    expect(notices.at(-1)).toMatch(/stopped after 3 tool iterations/);
    expect(s.state).toBe('idle');
  });

  it('does not run a tool that was requested after the user cancelled', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude' });
    const p = createFakeProvider(
      [toolCall('w', 'write_file', { path: 'late.txt', content: 'x' })],
      { delayMs: 30 },
    );
    s.pushUser('go');
    setTimeout(() => s.cancel(), 10);
    const r = await runTurn(s, p, opts(), { confirm: async () => true });
    expect(r.stopReason).toBe('cancelled');
    expect(fs.existsSync(path.join(cwd, 'late.txt'))).toBe(false);
  });
});
