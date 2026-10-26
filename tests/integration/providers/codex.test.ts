/**
 * Codex provider (specs/012) end to end with the fake `codex exec` and the real MCP bridge:
 * conversation (US1), Maestro's tools under the approval policy (US2), usage limits (US3).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCodexProvider } from '../../../src/providers/codex.js';
import type { CodexDeps } from '../../../src/providers/codex.js';
import { MCP_TOKEN_ENV } from '../../../src/providers/codexStream.js';
import type { ProviderEvent, ProviderRequest } from '../../../src/providers/types.js';
import { Session } from '../../../src/session/session.js';
import { runTurn } from '../../../src/session/turn.js';
import { allTools, getTool } from '../../../src/tools/registry.js';
import type { ApprovalMode } from '../../../src/tools/approval.js';
import { createFakeCodex } from '../../helpers/fakeCodex.js';
import type { FakeCodexScript } from '../../helpers/fakeCodex.js';
import { makeCtx, makeSettings } from '../../helpers/context.js';

let cwd: string;
let root: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-codex-cwd-'));
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-codex-tmp-'));
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'hello notes');
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

const ctx = () =>
  makeCtx(
    { providers: { codex: { enabled: true, model: 'gpt-5.6-terra', effort: 'low' } } },
    {
      activeId: 'codex',
      credentials: { codex: 'cli' },
      env: { OPENAI_API_KEY: 'sk-openai-secret-9999', PATH: '' },
    },
  );

function provider(script: FakeCodexScript, extra: Partial<CodexDeps> = {}) {
  const fake = createFakeCodex(script);
  const logs: Array<[string, Record<string, unknown>]> = [];
  const p = createCodexProvider(ctx(), {
    spawn: fake.spawn,
    locate: () => '/usr/bin/codex',
    readVersion: async () => '0.161.0',
    platform: 'linux', // never spawn taskkill against a fake pid
    tmpDir: () => root,
    log: (e, d) => logs.push([e, d]),
    ...extra,
  });
  return { p, fake, logs };
}

function req(partial: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    messages: [
      { id: '1', role: 'user', content: [{ type: 'text', text: 'oi' }], createdAt: new Date() },
    ],
    system: 'SYS DO MAESTRO',
    tools: [],
    signal: new AbortController().signal,
    ...partial,
  };
}

async function drain(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

const turnOpts = (mode: ApprovalMode = 'default') => ({
  system: 'sys',
  tools: allTools(),
  toolSettings: { ...makeSettings().tools, commandTimeoutMs: 2000 },
  approvalMode: () => mode,
});

describe('codex provider — conversation (specs/012 US1)', () => {
  it('declares images and provider-driven tools', () => {
    const { p } = provider(() => {});
    expect(p.id).toBe('codex');
    expect(p.capabilities).toEqual({ images: true, executesTools: true });
  });

  it('agent messages stream as text, usage is reported and the turn ends', async () => {
    const { p, fake } = provider((run) => {
      run.message('Olá');
      run.message('mundo');
      run.completed({ input_tokens: 12, output_tokens: 4, reasoning_output_tokens: 1 });
    });
    const events = await drain(p.stream(req()));
    expect(events).toEqual([
      { type: 'text_delta', text: 'Olá' },
      { type: 'text_delta', text: '\n\nmundo' },
      { type: 'usage', inputTokens: 12, outputTokens: 5 },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    const run = fake.runs[0]!;
    expect(run.stdin).toBe('oi\n');
    expect(run.instructions).toBe('SYS DO MAESTRO');
    expect(run.args[run.args.indexOf('-m') + 1]).toBe('gpt-5.6-terra');
    expect(run.config['model_reasoning_effort']).toBe('low');
  });

  it('route model and effort override the settings', async () => {
    const { p, fake } = provider((run) => run.completed());
    await drain(p.stream(req({ model: 'gpt-6-luna', overrides: { effort: 'max' } })));
    const run = fake.runs[0]!;
    expect(run.args[run.args.indexOf('-m') + 1]).toBe('gpt-6-luna');
    expect(run.config['model_reasoning_effort']).toBe('max');
  });

  it('the history of other providers goes on stdin; images of the last message by -i', async () => {
    const { p, fake } = provider((run) => run.completed());
    await drain(
      p.stream(
        req({
          messages: [
            {
              id: '1',
              role: 'user',
              content: [{ type: 'text', text: 'antes' }],
              createdAt: new Date(),
            },
            {
              id: '2',
              role: 'assistant',
              content: [{ type: 'text', text: 'resposta claude' }],
              providerId: 'claude-code',
              createdAt: new Date(),
            },
            {
              id: '3',
              role: 'user',
              content: [
                { type: 'text', text: 'e agora?' },
                {
                  type: 'image',
                  mediaType: 'image/png',
                  data: Buffer.from('PNGDATA').toString('base64'),
                },
              ],
              createdAt: new Date(),
            },
          ],
        }),
      ),
    );
    const run = fake.runs[0]!;
    expect(run.stdin).toContain('<conversation_history>');
    expect(run.stdin).toContain('### assistente (claude-code)\nresposta claude');
    expect(run.stdin.trimEnd().endsWith('e agora?')).toBe(true);
    expect(run.images.map((b) => b.toString())).toEqual(['PNGDATA']);
  });

  it('never passes the OpenAI key to Codex and removes its temporary files (FR-002)', async () => {
    const { p, fake } = provider((run) => run.completed());
    await drain(p.stream(req()));
    expect(fake.runs[0]!.env['OPENAI_API_KEY']).toBeUndefined();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('abort kills the process and ends as cancelled', async () => {
    const ac = new AbortController();
    const { p, fake } = provider(async (run) => {
      run.message('começando');
      await run.untilKilled();
    });
    const events: ProviderEvent[] = [];
    for await (const e of p.stream(req({ signal: ac.signal }))) {
      events.push(e);
      if (e.type === 'text_delta') ac.abort();
    }
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'cancelled' });
    expect(fake.runs[0]!.aborted).toBe(true);
  });

  it('a failed turn becomes a MaestroError without raw JSON', async () => {
    const { p } = provider((run) => {
      run.failed(
        JSON.stringify({
          type: 'error',
          status: 400,
          error: { message: "The 'gpt-x' model is not supported.", code: 'model_not_found' },
        }),
      );
      return 1;
    });
    const events = await drain(p.stream(req()));
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error).toMatchObject({
      category: 'provider',
      message: "The 'gpt-x' model is not supported.",
    });
  });

  it('a process that exits without turn.completed reports the last stderr line', async () => {
    const { p } = provider((run) => {
      run.stderr('linha 1\nfalhou feio\n');
      return 2;
    });
    const [ev] = await drain(p.stream(req()));
    expect(ev?.type === 'error' && ev.error.message).toBe(
      'o Codex terminou sem resposta (código 2): falhou feio',
    );
  });

  it('missing executable / old version are invalid_config and never run codex exec', async () => {
    const a = provider(() => {}, { locate: () => undefined });
    const [ea] = await drain(a.p.stream(req()));
    expect(ea?.type === 'error' && ea.error.category).toBe('invalid_config');
    const b = provider(() => {}, { readVersion: async () => '0.150.0' });
    const [eb] = await drain(b.p.stream(req()));
    expect(eb?.type === 'error' && eb.error).toMatchObject({ category: 'invalid_config' });
    expect(eb?.type === 'error' && eb.error.hint).toMatch(/npm install -g @openai\/codex/);
    expect(a.fake.runs).toHaveLength(0);
    expect(b.fake.runs).toHaveLength(0);
  });

  it('logs only events and counts', async () => {
    const { p, logs } = provider((run) => {
      run.message('segredo da resposta');
      run.completed();
    });
    await drain(p.stream(req()));
    expect(logs.map(([e]) => e)).toEqual(['codex.version', 'codex.start', 'codex.exit']);
    expect(JSON.stringify(logs)).not.toMatch(/segredo|SYS DO MAESTRO|oi/);
  });
});

describe('codex provider — Maestro tools through the bridge (specs/012 US2)', () => {
  it('without tools (or without runTool) there is no bridge and no token', async () => {
    const { p, fake } = provider((run) => run.completed());
    await drain(p.stream(req({ runTool: async () => ({ output: '', isError: false }) })));
    await drain(p.stream(req({ tools: [getTool('read_file')!] })));
    for (const run of fake.runs) {
      expect(Object.keys(run.config).some((k) => k.startsWith('mcp_servers.'))).toBe(false);
      expect(run.env[MCP_TOKEN_ENV]).toBeUndefined();
    }
  });

  it('runTurn: reads run automatically, writes ask and a decline goes back to the model', async () => {
    let listed: string[] = [];
    const results: Array<{ text: string; isError: boolean }> = [];
    const { p } = provider(async (run) => {
      listed = await run.listTools();
      results.push(await run.callTool('read_file', { path: 'notes.txt' }));
      results.push(await run.callTool('write_file', { path: 'out.txt', content: 'x' }));
      results.push(await run.callTool('read_file', { path: '../fora.txt' }));
      run.message('pronto');
      run.completed();
    });
    const s = new Session({ cwd, activeProviderId: 'codex' });
    s.pushUser('trabalhe');
    const asked: string[] = [];
    const r = await runTurn(s, p, turnOpts('default'), {
      confirm: async (a) => {
        asked.push(a.tool.name);
        return false;
      },
    });
    expect(listed).toEqual(
      expect.arrayContaining(['read_file', 'write_file', 'run_command', 'ask_user']),
    );
    expect(results[0]).toMatchObject({
      isError: false,
      text: expect.stringContaining('hello notes'),
    });
    expect(results[1]).toEqual({ text: 'user declined', isError: true });
    expect(results[2]?.isError).toBe(true);
    expect(asked).toEqual(['write_file']);
    expect(fs.existsSync(path.join(cwd, 'out.txt'))).toBe(false);
    expect(r).toMatchObject({ stopReason: 'end_turn', text: 'pronto' });
    const calls = s.history.flatMap((m) => m.content).filter((c) => c.type === 'tool_call');
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.type === 'tool_call' && c.callId.startsWith('mcp_'))).toBe(true);
    expect(s.history.at(-1)?.providerId).toBe('codex');
  });

  it('Spec Kit scripts are intercepted and ask_user reaches the user', async () => {
    const results: Array<{ text: string; isError: boolean }> = [];
    const { p } = provider(async (run) => {
      results.push(
        await run.callTool('run_command', {
          command: '.specify/scripts/bash/check-prerequisites.sh --json',
        }),
      );
      results.push(
        await run.callTool('ask_user', {
          questions: [
            {
              question: 'Qual?',
              header: 'Escolha',
              options: [
                { label: 'A', description: 'a' },
                { label: 'B', description: 'b' },
              ],
            },
          ],
        }),
      );
      run.completed();
    });
    const s = new Session({ cwd, activeProviderId: 'codex' });
    s.pushUser('/speckit.tasks');
    await runTurn(
      s,
      p,
      {
        ...turnOpts('default'),
        intercept: async (tool) =>
          tool.name === 'run_command'
            ? { output: '{"FEATURE_DIR":"x"}', isError: false }
            : undefined,
      },
      {
        confirm: async () => {
          throw new Error('nada deveria pedir confirmação');
        },
        ask: async () => ({ answered: true, answers: [{ kind: 'options', labels: ['B'] }] }),
      },
    );
    expect(results[0]).toEqual({ text: '{"FEATURE_DIR":"x"}', isError: false });
    expect(results[1]?.isError).toBe(false);
    expect(results[1]?.text).toContain('B');
  });

  it('with tools the instructions say they are the way to act (Codex would claim read-only)', async () => {
    const { p, fake } = provider((run) => run.completed());
    await drain(
      p.stream(
        req({
          tools: [getTool('write_file')!],
          runTool: async () => ({ output: '', isError: false }),
        }),
      ),
    );
    await drain(p.stream(req()));
    expect(fake.runs[0]!.instructions).toMatch(
      /^SYS DO MAESTRO\n\nAs ferramentas disponíveis \(write_file\) são do Maestro/,
    );
    expect(fake.runs[1]!.instructions).toBe('SYS DO MAESTRO');
  });

  it('--no-tools: only ask_user is exposed', async () => {
    let listed: string[] = [];
    const { p } = provider(async (run) => {
      listed = await run.listTools();
      run.completed();
    });
    const s = new Session({ cwd, activeProviderId: 'codex' });
    s.pushUser('oi');
    await runTurn(s, p, { ...turnOpts(), tools: [getTool('ask_user')!] });
    expect(listed).toEqual(['ask_user']);
  });
});

describe('codex provider — usage limits (specs/012 US3)', () => {
  it('a usage limit waits the time Codex gives and resends the same request', async () => {
    let n = 0;
    const { p, fake } = provider((run) => {
      n++;
      if (n === 1) {
        run.failed(
          JSON.stringify({
            type: 'error',
            status: 429,
            error: {
              message: 'Rate limit reached. Please try again in 30s.',
              code: 'rate_limit_exceeded',
            },
          }),
        );
        return 1;
      }
      run.message('depois da espera');
      run.completed();
    });
    const s = new Session({ cwd, activeProviderId: 'codex' });
    s.pushUser('oi');
    const waits: number[] = [];
    const notices: string[] = [];
    const r = await runTurn(
      s,
      p,
      {
        ...turnOpts(),
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
      { onNotice: (t) => notices.push(t) },
    );
    expect(waits).toEqual([30_000]);
    expect(notices[0]).toMatch(/limite de taxa do provedor/);
    expect(r).toMatchObject({ stopReason: 'end_turn', text: 'depois da espera' });
    expect(fake.runs.map((x) => x.stdin)).toEqual(['oi\n', 'oi\n']);
  });
});
