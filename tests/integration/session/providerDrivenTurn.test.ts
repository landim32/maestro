/**
 * Turns for providers that drive the tool loop themselves (specs/010 research R4, US2): every
 * call goes through the same validation, interception and approval policy as the built-in loop.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { CALLS_PER_ITERATION, runTurn } from '../../../src/session/turn.js';
import { allTools } from '../../../src/tools/registry.js';
import type { ApprovalMode } from '../../../src/tools/approval.js';
import type {
  ModelProvider,
  ProviderEvent,
  ProviderRequest,
  ToolCallRequest,
} from '../../../src/providers/types.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
const toolSettings = { ...makeSettings().tools, commandTimeoutMs: 2000 };

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-driven-'));
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'hello notes');
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

type Step =
  | { text: string }
  | { call: ToolCallRequest; expect?: (r: { output: string; isError: boolean }) => void }
  | { parallel: ToolCallRequest[] };

/** Provider that runs `steps`, calling tools through `req.runTool` like Claude Code does. */
function drivenProvider(
  steps: Step[],
  end: ProviderEvent = { type: 'done', stopReason: 'end_turn' },
) {
  const requests: ProviderRequest[] = [];
  const results: Array<{ output: string; isError: boolean }> = [];
  const p: ModelProvider & { requests: typeof requests; results: typeof results } = {
    id: 'claude-code',
    displayName: 'driven',
    capabilities: { executesTools: true },
    requests,
    results,
    status: () => ({
      id: 'claude-code',
      displayName: 'driven',
      enabled: true,
      configured: true,
      active: true,
      model: 'm',
      credentialSource: 'cli',
      missing: [],
    }),
    async *stream(req) {
      requests.push({ ...req, messages: [...req.messages] });
      for (const s of steps) {
        if ('text' in s) yield { type: 'text_delta', text: s.text };
        else if ('call' in s) {
          const r = await req.runTool!(s.call);
          results.push(r);
          s.expect?.(r);
        } else {
          results.push(...(await Promise.all(s.parallel.map((c) => req.runTool!(c)))));
        }
      }
      yield { type: 'usage', inputTokens: 5, outputTokens: 3 };
      yield end;
    },
  };
  return p;
}

const opts = (mode: ApprovalMode = 'default') => ({
  system: 'sys',
  tools: allTools(),
  toolSettings,
  approvalMode: () => mode,
});

describe('provider-driven turn', () => {
  it('passes runTool, records call → result alternation and the final answer', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const p = drivenProvider([
      { text: 'vou ler. ' },
      { call: { callId: 'c1', name: 'read_file', input: { path: 'notes.txt' } } },
      { text: 'diz hello notes' },
    ]);
    s.pushUser('o que tem em notes.txt?');
    const r = await runTurn(s, p, opts());
    expect(p.requests).toHaveLength(1);
    expect(p.requests[0]?.runTool).toBeTypeOf('function');
    expect(r).toMatchObject({
      stopReason: 'end_turn',
      toolIterations: 1,
      usage: { inputTokens: 5, outputTokens: 3 },
    });
    expect(r.text).toBe('vou ler. diz hello notes');
    expect(p.results[0]?.output).toContain('hello notes');
    expect(s.history.map((m) => `${m.role}:${m.content.map((c) => c.type).join('+')}`)).toEqual([
      'user:text',
      'assistant:text+tool_call',
      'tool:tool_result',
      'assistant:text',
    ]);
    expect(s.history[1]?.providerId).toBe('claude-code');
  });

  it('applies the approval policy: default asks before write_file; decline is returned to the model', async () => {
    for (const approve of [true, false]) {
      const s = new Session({ cwd, activeProviderId: 'claude-code' });
      const file = `out-${approve}.txt`;
      const p = drivenProvider([
        { call: { callId: 'w', name: 'write_file', input: { path: file, content: 'x' } } },
      ]);
      const asked: string[] = [];
      s.pushUser('escreva');
      await runTurn(s, p, opts('default'), {
        confirm: async (a) => {
          asked.push(a.tool.name);
          return approve;
        },
      });
      expect(asked).toEqual(['write_file']);
      expect(fs.existsSync(path.join(cwd, file))).toBe(approve);
      if (!approve) expect(p.results[0]).toEqual({ output: 'user declined', isError: true });
    }
  });

  it('auto-edit runs edits without asking and reports them', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const p = drivenProvider([
      { call: { callId: 'w', name: 'write_file', input: { path: 'a.txt', content: 'x' } } },
    ]);
    const auto: string[] = [];
    s.pushUser('escreva');
    await runTurn(s, p, opts('auto-edit'), {
      confirm: async () => {
        throw new Error('should not ask');
      },
      onAutoApproved: (name) => auto.push(name),
    });
    expect(auto).toEqual(['write_file']);
    expect(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8')).toBe('x');
  });

  it('paths outside the working directory are refused in every mode', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const p = drivenProvider([
      { call: { callId: 'r', name: 'read_file', input: { path: '../../etc/passwd' } } },
    ]);
    s.pushUser('leia');
    await runTurn(s, p, opts('yolo'));
    expect(p.results[0]?.isError).toBe(true);
  });

  it('interception runs before the policy (Spec Kit native steps)', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const p = drivenProvider([
      {
        call: {
          callId: 'k',
          name: 'run_command',
          input: { command: '.specify/scripts/bash/x.sh --json' },
        },
      },
    ]);
    s.pushUser('/speckit');
    await runTurn(
      s,
      p,
      {
        ...opts('default'),
        intercept: async () => ({ output: '{"OK":true}', isError: false }),
      },
      {
        confirm: async () => {
          throw new Error('intercepted calls never ask');
        },
      },
    );
    expect(p.results[0]).toEqual({ output: '{"OK":true}', isError: false });
  });

  it('invalid input and unknown tools become errors for the model', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const p = drivenProvider([
      { call: { callId: 'a', name: 'read_file', input: { nope: 1 } } },
      { call: { callId: 'b', name: 'delete_everything', input: {} } },
    ]);
    s.pushUser('x');
    await runTurn(s, p, opts());
    expect(p.results[0]?.output).toMatch(/invalid input for read_file/);
    expect(p.results[1]).toEqual({ output: 'unknown tool: delete_everything', isError: true });
  });

  it('parallel calls are serialized so the history keeps the alternation', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const p = drivenProvider([
      {
        parallel: [
          { callId: 'p1', name: 'read_file', input: { path: 'notes.txt' } },
          { callId: 'p2', name: 'list_directory', input: { path: '.' } },
        ],
      },
    ]);
    s.pushUser('x');
    await runTurn(s, p, opts());
    expect(s.history.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
    expect(s.history[1]?.content[0]).toMatchObject({ type: 'tool_call', callId: 'p1' });
    expect(s.history[2]?.content[0]).toMatchObject({ type: 'tool_result', callId: 'p1' });
    expect(s.history[3]?.content[0]).toMatchObject({ type: 'tool_call', callId: 'p2' });
    expect(s.history[4]?.content[0]).toMatchObject({ type: 'tool_result', callId: 'p2' });
  });

  it('stops executing after the call limit', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const limit = 1 * CALLS_PER_ITERATION;
    const steps: Step[] = Array.from({ length: limit + 2 }, (_, i) => ({
      call: { callId: `c${i}`, name: 'read_file', input: { path: 'notes.txt' } },
    }));
    const p = drivenProvider(steps);
    const notices: string[] = [];
    s.pushUser('x');
    await runTurn(s, p, { ...opts(), maxToolIterations: 1 }, { onNotice: (t) => notices.push(t) });
    expect(p.results.slice(0, limit).every((r) => !r.isError)).toBe(true);
    expect(p.results.slice(limit).every((r) => r.isError && /limit/.test(r.output))).toBe(true);
    expect(notices).toEqual([`stopped after ${limit} tool calls in one turn`]);
  });

  it('a provider error keeps the partial text and reports it', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const { MaestroError } = await import('../../../src/utils/errors.js');
    const p = drivenProvider([{ text: 'parcial' }], {
      type: 'error',
      error: new MaestroError({ category: 'rate_limit', message: 'limite' }),
    });
    const errors: string[] = [];
    s.pushUser('x');
    const r = await runTurn(s, p, opts(), { onError: (e) => errors.push(e.category) });
    expect(r.stopReason).toBe('error');
    expect(errors).toEqual(['rate_limit']);
    expect(s.history.at(-1)?.content).toEqual([{ type: 'text', text: 'parcial' }]);
  });

  it('after cancel, tool calls are not executed', async () => {
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    const p = drivenProvider([
      { call: { callId: 'w', name: 'write_file', input: { path: 'z.txt', content: 'x' } } },
    ]);
    const original = p.stream.bind(p);
    p.stream = (req) => {
      s.cancel();
      return original(req);
    };
    s.pushUser('x');
    await runTurn(s, p, opts('yolo'));
    expect(p.results[0]).toEqual({ output: 'cancelled by user', isError: true });
    expect(fs.existsSync(path.join(cwd, 'z.txt'))).toBe(false);
  });
});
