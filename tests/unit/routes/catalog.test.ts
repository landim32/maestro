import { describe, expect, it, vi } from 'vitest';
import {
  aliasCommands,
  guidanceFor,
  isPurposeRoute,
  routeEntries,
  routeNamesText,
  unavailableReason,
} from '../../../src/routes/catalog.js';
import type { ProviderStatus } from '../../../src/providers/types.js';

const status = (id: 'claude' | 'qwen', o: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id,
  displayName: id,
  enabled: true,
  configured: true,
  active: id === 'claude',
  model: id === 'claude' ? 'claude-opus-5-5' : 'qwen3-coder-plus',
  credentialSource: 'env',
  missing: [],
  ...o,
});
const statuses = [status('claude'), status('qwen')];
const commands = [
  { name: 'help' },
  { name: 'model' },
  { name: 'speckit.specify', kind: 'prompt' as const },
  { name: 'speckit.plan', kind: 'prompt' as const },
  { name: 'speckit.init' },
];
const active = { provider: 'claude' as const, model: 'claude-opus-5-5' };

describe('routeEntries (contracts/routes-config.md § 2)', () => {
  it('without configuration: chat follows the active model and commands follow chat', () => {
    const entries = routeEntries({ routes: {}, commands, statuses, active });
    expect(entries.map((e) => e.name)).toEqual([
      'chat',
      'github',
      'infra',
      'speckit.specify',
      'speckit.plan',
    ]);
    const chat = entries[0]!;
    expect(chat).toMatchObject({
      kind: 'purpose',
      builtin: true,
      follows: 'active',
      origin: 'default',
      available: true,
      resolved: active,
    });
    expect(entries[3]).toMatchObject({ kind: 'command', follows: 'chat', resolved: active });
    expect(entries[1]!.alias).toBe('ok');
    expect(entries.some((e) => e.name === 'speckit.init' || e.name === 'help')).toBe(false);
  });

  it('configured routes resolve to their target; chat changes what the followers resolve to', () => {
    const routes = {
      chat: { provider: 'qwen' as const, model: 'qwen3-max' },
      'speckit.plan': {
        provider: 'claude' as const,
        model: 'claude-opus-5-5',
        effort: 'high' as const,
      },
    };
    const entries = routeEntries({ routes, commands, statuses, active });
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName['chat']).toMatchObject({
      origin: 'global',
      follows: undefined,
      resolved: { provider: 'qwen', model: 'qwen3-max' },
    });
    expect(byName['github']).toMatchObject({
      follows: 'chat',
      resolved: { provider: 'qwen', model: 'qwen3-max' },
    });
    expect(byName['speckit.plan']).toMatchObject({
      origin: 'global',
      resolved: { provider: 'claude', model: 'claude-opus-5-5', effort: 'high' },
    });
  });

  it('tells global from project values and lists user routes and stale command routes', () => {
    const routes = {
      review: { provider: 'claude' as const, model: 'claude-sonnet-5-5' },
      infra: { provider: 'qwen' as const, model: 'qwen3-coder-plus' },
      model: { provider: 'qwen' as const, model: 'x' }, // a command that is not a prompt command
      'speckit.old': { provider: 'qwen' as const, model: 'x' },
    };
    const entries = routeEntries({
      routes,
      commands,
      statuses,
      active,
      rawGlobal: { review: routes.review },
      projectKeys: ['routes.infra'],
    });
    const names = entries.map((e) => e.name);
    expect(names).toEqual([
      'chat',
      'github',
      'infra',
      'review',
      'speckit.old',
      'speckit.specify',
      'speckit.plan',
      'model',
    ]);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName['review']).toMatchObject({
      kind: 'purpose',
      builtin: false,
      origin: 'global',
      alias: 'ok',
    });
    expect(byName['infra']).toMatchObject({ origin: 'project' });
    expect(byName['model']).toMatchObject({ kind: 'command', missingCommand: true });
    expect(isPurposeRoute('review', entries)).toBe(true);
    expect(isPurposeRoute('speckit.plan', entries)).toBe(false);
    expect(routeNamesText(entries)).not.toContain('model');
  });

  it('availability follows the provider status; unavailableReason distinguishes disabled from unconfigured', () => {
    const off = [status('claude'), status('qwen', { enabled: false })];
    const none = [status('claude'), status('qwen', { configured: false })];
    const routes = { github: { provider: 'qwen' as const, model: 'q' } };
    expect(routeEntries({ routes, commands, statuses: off, active })[1]!.available).toBe(false);
    expect(unavailableReason(off, 'qwen')).toBe('disabled');
    expect(unavailableReason(none, 'qwen')).toBe('unconfigured');
    expect(unavailableReason(statuses, 'qwen')).toBeUndefined();
  });

  it('a route named like an existing command has no shortcut and is marked as colliding', () => {
    const routes = {
      help: { provider: 'claude' as const, model: 'c' },
      review: { provider: 'claude' as const, model: 'c' },
    };
    const entries = routeEntries({ routes, commands, statuses, active });
    const onEmpty = vi.fn();
    const aliases = aliasCommands(
      entries,
      commands.map((c) => c.name),
      onEmpty,
    );
    expect(aliases.map((a) => a.name)).toEqual(['github', 'infra', 'review']);
    const review = aliases[2]!;
    expect(review.kind).toBe('route');
    // shortcuts and /ask never become command routes nor collisions
    const withAliases = routeEntries({
      routes,
      commands: [...commands, ...aliases, { name: 'ask', kind: 'route' }],
      statuses,
      active,
    });
    expect(withAliases.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    expect(withAliases.find((e) => e.name === 'review')!.alias).toBe('ok');
    expect(review.run({}, ['x'], 'revise isto')).toEqual({
      display: '/review revise isto',
      prompt: 'revise isto',
      route: 'review',
    });
    expect(review.run({}, [], '')).toBeUndefined();
    expect(onEmpty).toHaveBeenCalledWith({}, 'review');
    expect(entries.find((e) => e.name === 'help')).toMatchObject({
      kind: 'command',
      missingCommand: true,
    });
  });

  it('guidance exists for github and infra only', () => {
    expect(guidanceFor('github')).toMatch(/^# Route: github/);
    expect(guidanceFor('infra')).toMatch(/^# Route: infra/);
    expect(guidanceFor('chat')).toBe('');
    expect(guidanceFor('review')).toBe('');
    expect(guidanceFor(undefined)).toBe('');
  });
});
