import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { childEnv, createClaudeCodeProvider } from '../../../src/providers/claudeCode.js';
import type { ClaudeCodeDeps } from '../../../src/providers/claudeCode.js';
import type { ProviderEvent, ProviderRequest } from '../../../src/providers/types.js';
import { getTool } from '../../../src/tools/registry.js';

const READ = getTool('read_file')!;
import { createFakeClaudeCode } from '../../helpers/fakeClaudeCode.js';
import type { FakeScript } from '../../helpers/fakeClaudeCode.js';
import { makeCtx } from '../../helpers/context.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
  tmpDirs.push(d);
  return d;
}

const ctx = () =>
  makeCtx(
    { providers: { 'claude-code': { enabled: true, model: 'claude-sonnet-5-5', effort: 'low' } } },
    {
      credentials: { 'claude-code': 'cli' },
      env: { ANTHROPIC_API_KEY: 'sk-ant-secret-1234', PATH: '' },
    },
  );

function provider(script: FakeScript, extra: Partial<ClaudeCodeDeps> = {}) {
  const fake = createFakeClaudeCode(script);
  const root = tmpRoot();
  const p = createClaudeCodeProvider(ctx(), {
    spawn: fake.spawn,
    locate: () => '/usr/bin/claude',
    platform: 'linux', // never spawn taskkill against a fake pid
    tmpDir: () => root,
    ...extra,
  });
  return { p, fake, root };
}

function req(partial: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    messages: [
      { id: '1', role: 'user', content: [{ type: 'text', text: 'oi' }], createdAt: new Date() },
    ],
    system: 'SYS',
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

describe('claude-code provider (specs/010 US1)', () => {
  it('declares images and provider-driven tools', () => {
    const { p } = provider(() => {});
    expect(p.id).toBe('claude-code');
    expect(p.capabilities).toEqual({ images: true, executesTools: true });
  });

  it('streams text, reports usage and ends the turn', async () => {
    const { p, fake } = provider((run) => {
      run.text('Olá, ');
      run.text('mundo');
      run.result({ usage: { input_tokens: 3, cache_read_input_tokens: 7, output_tokens: 2 } });
    });
    const events = await drain(p.stream(req()));
    expect(events).toEqual([
      { type: 'text_delta', text: 'Olá, ' },
      { type: 'text_delta', text: 'mundo' },
      { type: 'usage', inputTokens: 10, outputTokens: 2 },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    const run = fake.runs[0]!;
    expect(run.args[run.args.indexOf('--model') + 1]).toBe('claude-sonnet-5-5');
    expect(run.args[run.args.indexOf('--effort') + 1]).toBe('low');
    expect(run.systemPrompt).toBe('SYS');
    expect(run.stdin).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'oi' }] },
    });
  });

  it('the route model and effort override the settings', async () => {
    const { p, fake } = provider((run) => run.result());
    await drain(p.stream(req({ model: 'claude-haiku-5-5', overrides: { effort: 'max' } })));
    const args = fake.runs[0]!.args;
    expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-5-5');
    expect(args[args.indexOf('--effort') + 1]).toBe('max');
  });

  it('never passes API keys to Claude Code, so it uses its own login (FR-002)', async () => {
    const { p, fake } = provider((run) => run.result());
    await drain(p.stream(req()));
    expect(fake.runs[0]!.env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(fake.runs[0]!.env['MCP_TOOL_TIMEOUT']).toBeDefined();
    expect(childEnv({ ANTHROPIC_AUTH_TOKEN: 'x', HOME: '/h' })).toMatchObject({ HOME: '/h' });
    expect(childEnv({ ANTHROPIC_AUTH_TOKEN: 'x' })['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
  });

  it('removes its temporary files after the run', async () => {
    const { p, root } = provider((run) => run.result());
    await drain(p.stream(req()));
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('an error result becomes a MaestroError of the provider', async () => {
    const { p } = provider((run) =>
      run.result({
        is_error: true,
        api_error_status: 401,
        result: 'Not logged in · Please run /login',
      }),
    );
    const events = await drain(p.stream(req()));
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error.category).toBe('auth');
    expect(err?.type === 'error' && err.error.providerId).toBe('claude-code');
  });

  it('a process that exits without a result reports the last stderr line', async () => {
    const { p } = provider((run) => {
      run.stderr('warming up\nfatal: something broke\n');
      return 3;
    });
    const events = await drain(p.stream(req()));
    const err = events.at(-1);
    expect(err?.type).toBe('error');
    expect(err?.type === 'error' && err.error.message).toContain('código 3');
    expect(err?.type === 'error' && err.error.message).toContain('fatal: something broke');
  });

  it('a missing executable is an invalid_config error', async () => {
    const { p } = provider(() => {}, { locate: () => undefined });
    const [ev] = await drain(p.stream(req()));
    expect(ev?.type === 'error' && ev.error.category).toBe('invalid_config');
  });

  it('abort kills the process and ends as cancelled', async () => {
    const ac = new AbortController();
    const { p, fake } = provider(
      (run) =>
        new Promise<void>(() => {
          run.text('começando');
        }),
    );
    const events: ProviderEvent[] = [];
    for await (const e of p.stream(req({ signal: ac.signal }))) {
      events.push(e);
      if (e.type === 'text_delta') ac.abort();
    }
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'cancelled' });
    expect(fake.runs[0]!.aborted).toBe(true);
  });
});

describe('claude-code provider — tools through the MCP bridge (specs/010 US2)', () => {
  it('without tools there is no bridge', async () => {
    const { p, fake } = provider((run) => run.result());
    await drain(p.stream(req({ runTool: async () => ({ output: '', isError: false }) })));
    expect(fake.runs[0]!.args).not.toContain('--mcp-config');
  });

  it('exposes the turn tools and routes calls to runTool', async () => {
    const calls: unknown[] = [];
    let listed: string[] = [];
    let got: { text: string; isError: boolean } | undefined;
    const { p, fake } = provider(async (run) => {
      listed = await run.listTools();
      got = await run.callTool('read_file', { path: 'a.txt' }, 'toolu_9');
      run.text('li');
      run.result();
    });
    const events = await drain(
      p.stream(
        req({
          tools: [READ],
          runTool: async (c) => {
            calls.push(c);
            return { output: 'conteúdo de a', isError: false };
          },
        }),
      ),
    );
    expect(listed).toEqual(['read_file']);
    expect(calls).toEqual([{ callId: 'toolu_9', name: 'read_file', input: { path: 'a.txt' } }]);
    expect(got).toEqual({ text: 'conteúdo de a', isError: false });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
    const args = fake.runs[0]!.args;
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__maestro__*');
    expect(fake.runs[0]!.systemPrompt).toContain('read_file → mcp__maestro__read_file');
  });

  it('the bridge is closed when the run ends', async () => {
    let url = '';
    const { p } = provider(async (run) => {
      const file = run.args[run.args.indexOf('--mcp-config') + 1]!;
      url = (
        JSON.parse(fs.readFileSync(file, 'utf8')) as { mcpServers: { maestro: { url: string } } }
      ).mcpServers.maestro.url;
      run.result();
    });
    await drain(
      p.stream(req({ tools: [READ], runTool: async () => ({ output: '', isError: false }) })),
    );
    await expect(fetch(url, { method: 'POST', body: '{}' })).rejects.toThrow();
  });
});
