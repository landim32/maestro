import { describe, expect, it } from 'vitest';
import { runNonInteractive } from '../../src/cli/nonInteractive.js';
import { SessionController } from '../../src/session/controller.js';
import { DEFAULT_COMMANDS } from '../../src/session/commands.js';
import type { SlashCommand } from '../../src/session/commands.js';
import { Session } from '../../src/session/session.js';
import { makeCtx } from '../helpers/context.js';
import { createFakeProvider } from '../helpers/fakeProvider.js';
import type { FakeProvider } from '../helpers/fakeProvider.js';

const BOTH = { credentials: { claude: 'env' as const, qwen: 'config' as const } };
const qwenOn = { providers: { qwen: { enabled: true, apiKey: 'sk-qwen-test-0000' } } };

/** A prompt command standing in for a Spec Kit command. */
const planCmd: SlashCommand = {
  name: 'speckit.plan',
  kind: 'prompt',
  description: 'plan',
  origin: 'test',
  run: (_ctl, _args, rest) => ({
    display: `/speckit.plan ${rest ?? ''}`.trim(),
    prompt: `PLAN: ${rest ?? ''}`,
  }),
};

function make(settings: Record<string, unknown> = {}, opts: { interactive?: boolean } = {}) {
  const providers: Record<'claude' | 'qwen', FakeProvider> = {
    claude: createFakeProvider(
      () => [
        { type: 'text_delta', text: 'from claude' },
        { type: 'done', stopReason: 'end_turn' },
      ],
      { id: 'claude' },
    ),
    qwen: createFakeProvider(
      () => [
        { type: 'text_delta', text: 'from qwen' },
        { type: 'done', stopReason: 'end_turn' },
      ],
      { id: 'qwen' },
    ),
  };
  const session = new Session({ cwd: '/w', activeProviderId: 'claude' });
  const ctl = new SessionController({
    session,
    ctx: makeCtx({ ...qwenOn, ...settings }, BOTH),
    tools: [],
    system: 'SYS',
    interactive: opts.interactive ?? true,
    providerOverride: (id) => providers[id as 'claude' | 'qwen'],
    commands: [...DEFAULT_COMMANDS, planCmd],
  });
  return { ctl, session, providers };
}

describe('contract: route → request (contracts/route-resolution.md § 3–4)', () => {
  it('a command route picks the provider, the model and the overrides; the reply carries the route', async () => {
    const { ctl, session, providers } = make({
      routes: {
        'speckit.plan': { provider: 'qwen', model: 'qwen3-max', effort: 'high', maxTokens: 1234 },
      },
    });
    await ctl.submit('/speckit.plan tudo');
    expect(providers.claude.requests).toHaveLength(0);
    const req = providers.qwen.requests[0]!;
    expect(req.model).toBe('qwen3-max');
    expect(req.overrides).toEqual({ effort: 'high', maxTokens: 1234 });
    expect(req.system).toBe('SYS'); // no guidance for command routes
    expect(session.history[1]).toMatchObject({
      role: 'assistant',
      providerId: 'qwen',
      model: 'qwen3-max',
      route: 'speckit.plan',
    });
    expect(session.activeProviderId).toBe('claude'); // the active provider never changes
    expect(ctl.currentRoute).toBeUndefined(); // cleared after the turn
  });

  it('the next turn on another route receives the whole history, replies of both providers included', async () => {
    const { ctl, session, providers } = make({
      routes: { github: { provider: 'qwen', model: 'q' } },
    });
    await ctl.submit('o número secreto é 42');
    await ctl.submit('/ask github qual é o número secreto?');
    const req = providers.qwen.requests[0]!;
    expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(req.messages)).toContain('from claude');
    expect(req.system).toMatch(/^SYS\n\n# Route: github/);
    expect(session.history.at(-1)).toMatchObject({ providerId: 'qwen', route: 'github' });
    expect(session.history[1]).not.toHaveProperty('route'); // chat reply is unmarked
  });

  it('a default chat with no routes behaves exactly as before (no route on messages, no overrides)', async () => {
    const { ctl, session, providers } = make();
    await ctl.submit('/speckit.plan x');
    const req = providers.claude.requests[0]!;
    expect(req.model).toBeUndefined();
    expect(req.overrides).toBeUndefined();
    expect(session.history[1]).not.toHaveProperty('route');
    expect(ctl.notices.filter((n) => n.level === 'warn')).toHaveLength(0);
  });

  it('an unavailable route falls back with a warning; chat unavailable warns once per session', async () => {
    const { ctl, providers } = make({
      providers: { qwen: { enabled: false } },
      routes: { 'speckit.plan': { provider: 'qwen', model: 'q' } },
    });
    await ctl.submit('/speckit.plan x');
    expect(providers.claude.requests).toHaveLength(1);
    // the last notice is the turn summary (specs/009); the fallback warning comes before it
    expect(ctl.notices.filter((n) => n.level === 'warn').at(-1)?.text).toBe(
      'Rota speckit.plan indisponível (provedor qwen desabilitado); usando o provedor ativo.',
    );
    const chatOff = make({
      providers: { qwen: { enabled: true } },
      routes: { chat: { provider: 'qwen', model: 'q' } },
    });
    // qwen enabled but without credentials → unconfigured
    const ctx = chatOff.ctl.context;
    ctx.credentialSources.qwen = 'none';
    await chatOff.ctl.submit('a');
    await chatOff.ctl.submit('b');
    const warns = chatOff.ctl.notices.filter((n) => /Rota chat indisponível/.test(n.text));
    expect(warns).toHaveLength(1);
    expect(warns[0]!.text).toBe(
      'Rota chat indisponível (provedor qwen não configurado); usando o provedor ativo.',
    );
    expect(chatOff.providers.claude.requests).toHaveLength(2);
  });

  it('-p: `route` forces the route and /routes prints the table (§ 5)', async () => {
    const { ctl, providers } = make(
      { routes: { infra: { provider: 'qwen', model: 'q' } } },
      { interactive: false },
    );
    const out: string[] = [];
    const err: string[] = [];
    const sink = (arr: string[]) => ({ write: (s: string) => arr.push(s) });
    const code = await runNonInteractive({
      controller: ctl,
      prompt: 'escale o container',
      route: 'infra',
      stdout: sink(out),
      stderr: sink(err),
      handleSignals: false,
    });
    expect(code).toBe(0);
    expect(providers.qwen.requests).toHaveLength(1);
    expect(out.join('')).toContain('from qwen');
    await ctl.submit('/routes');
    const table = ctl.notices.at(-1)!.text;
    expect(table).toContain('Rotas por modelo:');
    expect(table).toMatch(/infra\s+qwen \/ q\s+global/);
    expect(table).toMatch(/speckit\.plan\s+claude \/ claude-opus-5-5\s+padrão \(segue chat\)/);
    expect(table).toMatch(/chat\s+claude \/ claude-opus-5-5\s+padrão \(segue o ativo\)/);
  });
});
