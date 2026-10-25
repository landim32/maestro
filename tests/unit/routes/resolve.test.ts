import { describe, expect, it } from 'vitest';
import { fallbackText, resolveRoute } from '../../../src/routes/resolve.js';
import type { ProviderStatus } from '../../../src/providers/types.js';

const status = (id: 'claude' | 'qwen', o: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id,
  displayName: id,
  enabled: true,
  configured: true,
  active: id === 'claude',
  model: 'm',
  credentialSource: 'env',
  missing: [],
  ...o,
});
const both = [status('claude'), status('qwen')];
const active = { provider: 'claude' as const, model: 'claude-opus-5-5' };
const qwen = { provider: 'qwen' as const, model: 'qwen3-coder-plus' };
const known = ['chat', 'github', 'infra', 'speckit.plan', 'speckit.specify'];

describe('resolveRoute (contracts/route-resolution.md § 1)', () => {
  it('no routes → the active provider via "active"', () => {
    expect(resolveRoute({ routes: {}, statuses: both, active, known })).toEqual({
      route: 'chat',
      target: active,
      via: 'active',
      fallbacks: [],
    });
  });

  it('a command route wins over chat; chat wins over the active model', () => {
    const routes = {
      chat: { ...qwen, maxTokens: 4000 },
      'speckit.plan': { provider: 'claude' as const, model: 'x', effort: 'high' as const },
    };
    expect(
      resolveRoute({ command: 'speckit.plan', routes, statuses: both, active, known }),
    ).toMatchObject({
      route: 'speckit.plan',
      target: { provider: 'claude', model: 'x', effort: 'high' },
      via: 'command',
    });
    expect(
      resolveRoute({ command: 'speckit.specify', routes, statuses: both, active, known }),
    ).toMatchObject({
      route: 'chat',
      target: { provider: 'qwen', model: 'qwen3-coder-plus', maxTokens: 4000 },
      via: 'chat',
    });
    expect(resolveRoute({ routes, statuses: both, active, known })).toMatchObject({
      route: 'chat',
      via: 'chat',
    });
  });

  it('a forced route wins over the command route; a known forced route without target keeps its name', () => {
    const routes = { github: qwen, 'speckit.plan': { provider: 'claude' as const, model: 'x' } };
    expect(
      resolveRoute({
        forced: 'github',
        command: 'speckit.plan',
        routes,
        statuses: both,
        active,
        known,
      }),
    ).toMatchObject({
      route: 'github',
      target: qwen,
      via: 'forced',
    });
    expect(resolveRoute({ forced: 'infra', routes, statuses: both, active, known })).toMatchObject({
      route: 'infra',
      target: active,
      via: 'forced',
      fallbacks: [],
    });
  });

  it('unknown forced route → fallback "unknown" and the request continues down the chain', () => {
    const r = resolveRoute({
      forced: 'nada',
      command: 'speckit.plan',
      routes: { 'speckit.plan': qwen },
      statuses: both,
      active,
      known,
    });
    expect(r).toMatchObject({ route: 'speckit.plan', via: 'command' });
    expect(r.fallbacks).toEqual([{ route: 'nada', reason: 'unknown' }]);
  });

  it('an unavailable provider falls back step by step, down to the active model', () => {
    const disabled = [status('claude'), status('qwen', { enabled: false })];
    const routes = { chat: qwen, 'speckit.plan': { provider: 'qwen' as const, model: 'q2' } };
    const r = resolveRoute({ command: 'speckit.plan', routes, statuses: disabled, active, known });
    expect(r).toMatchObject({ route: 'chat', target: active, via: 'active' });
    expect(r.fallbacks).toEqual([
      { route: 'speckit.plan', reason: 'disabled', provider: 'qwen' },
      { route: 'chat', reason: 'disabled', provider: 'qwen' },
    ]);
    const unconfigured = [status('claude'), status('qwen', { configured: false })];
    expect(
      resolveRoute({ command: 'speckit.plan', routes, statuses: unconfigured, active, known })
        .fallbacks[0],
    ).toMatchObject({ reason: 'unconfigured' });
  });

  it('fallbackText names the route, the reason and what was used instead', () => {
    expect(
      fallbackText({ route: 'speckit.plan', reason: 'disabled', provider: 'qwen' }, true),
    ).toBe('Rota speckit.plan indisponível (provedor qwen desabilitado); usando chat.');
    expect(
      fallbackText({ route: 'speckit.plan', reason: 'unconfigured', provider: 'qwen' }, false),
    ).toBe(
      'Rota speckit.plan indisponível (provedor qwen não configurado); usando o provedor ativo.',
    );
    expect(fallbackText({ route: 'chat', reason: 'disabled', provider: 'qwen' }, true)).toBe(
      'Rota chat indisponível (provedor qwen desabilitado); usando o provedor ativo.',
    );
    expect(fallbackText({ route: 'x', reason: 'unknown' }, true)).toBe(
      'Rota x indisponível (rota desconhecida); usando chat.',
    );
  });
});
