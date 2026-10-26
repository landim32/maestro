import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  describeRouteResult,
  initialRoutesFlow,
  routesEffectsFor,
  routesFlowReducer,
  validateRouteName,
} from '../../../src/setup/routesFlow.js';
import type {
  RoutesFlowContext,
  RoutesFlowEvent,
  RoutesFlowState,
} from '../../../src/setup/routesFlow.js';
import { routeEntries } from '../../../src/routes/catalog.js';
import type { ProviderStatus } from '../../../src/providers/types.js';
import { makeSettings } from '../../helpers/context.js';

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
const commands = [{ name: 'help' }, { name: 'speckit.plan', kind: 'prompt' as const }];

function ctxWith(
  routes: Record<string, { provider: 'claude' | 'qwen'; model: string }> = {},
  statuses = [status('claude'), status('qwen')],
): RoutesFlowContext {
  const settings = makeSettings({ routes });
  return {
    entries: routeEntries({
      routes,
      commands,
      statuses,
      active: { provider: 'claude', model: 'claude-opus-5-5' },
    }),
    statuses,
    settings,
    commandNames: commands.map((c) => c.name),
  };
}

function run(
  ctx: RoutesFlowContext,
  events: RoutesFlowEvent[],
  start: RoutesFlowState = initialRoutesFlow(ctx),
) {
  return events.reduce((s, e) => routesFlowReducer(s, e, ctx), start);
}
const up: RoutesFlowEvent = { type: 'up' };
const down: RoutesFlowEvent = { type: 'down' };
const enter: RoutesFlowEvent = { type: 'enter' };
const back: RoutesFlowEvent = { type: 'back' };

describe('routesFlow (contracts/routes-dialog.md § 2–4)', () => {
  it('starts on chat; ↑/↓ wrap around through the entries and "Nova rota…"', () => {
    const ctx = ctxWith();
    expect(initialRoutesFlow(ctx)).toEqual({ step: 'list', selected: 0 });
    expect(run(ctx, [up])).toEqual({ step: 'list', selected: ctx.entries.length }); // Nova rota…
    expect(run(ctx, [up, down])).toEqual({ step: 'list', selected: 0 });
    expect(run(ctx, [back])).toEqual({ step: 'closed' });
    expect(run(ctx, [{ type: 'cancel' }])).toEqual({ step: 'closed' });
  });

  it('actions depend on the route kind and on having a configured value', () => {
    const ctx = ctxWith({
      github: { provider: 'qwen', model: 'q' },
      review: { provider: 'claude', model: 'c' },
      model: { provider: 'claude', model: 'c' },
    });
    const byName = Object.fromEntries(ctx.entries.map((e) => [e.name, e]));
    expect(actionsFor(byName['chat']!)).toEqual(['set', 'back']); // builtin without value
    expect(actionsFor(byName['github']!)).toEqual(['set', 'reset', 'back']); // builtin with value
    expect(actionsFor(byName['review']!)).toEqual(['set', 'remove', 'back']); // user route
    expect(actionsFor(byName['speckit.plan']!)).toEqual(['set', 'back']);
    // Enter on github opens the action menu; "Voltar ao padrão" → applying reset
    const s = run(ctx, [down, enter, down, enter]);
    expect(s).toEqual({ step: 'applying', route: 'github', action: 'reset' });
    expect(routesEffectsFor(s)).toEqual({ kind: 'apply' });
    // back from the action menu returns to the same row
    expect(run(ctx, [down, enter, back])).toEqual({ step: 'list', selected: 1 });
  });

  it('set: provider → model → applying with the chosen target; "Digitar outro modelo…" → custom', () => {
    const ctx = ctxWith();
    const prov = run(ctx, [enter, enter]); // chat → set
    expect(prov.step).toBe('provider');
    if (prov.step !== 'provider') return;
    expect(prov.providers.map((p) => p.id)).toEqual(['claude', 'qwen', 'claude-code', 'codex']);
    expect(prov.selected).toBe(0); // chat resolves to claude today
    const model = run(ctx, [down, enter], prov);
    expect(model).toMatchObject({ step: 'model', route: 'chat', providerId: 'qwen' });
    if (model.step !== 'model') return;
    expect(model.models).toEqual(['qwen3-coder-plus', 'qwen3-coder-flash', 'qwen3-max']);
    const applying = run(ctx, [down, enter], model);
    expect(applying).toEqual({
      step: 'applying',
      route: 'chat',
      action: 'set',
      target: { provider: 'qwen', model: 'qwen3-coder-flash' },
      learn: false,
    });
    const custom = run(ctx, [up, enter], model); // last entry = custom
    expect(custom).toMatchObject({ step: 'custom', providerId: 'qwen', value: '' });
    expect(run(ctx, [enter], custom)).toMatchObject({ step: 'custom', error: 'informe o modelo' });
    expect(run(ctx, [{ type: 'input', value: 'a b' }, enter], custom)).toMatchObject({
      error: 'o modelo não pode conter espaços',
    });
    expect(run(ctx, [{ type: 'input', value: 'qwen-new' }, enter], custom)).toEqual({
      step: 'applying',
      route: 'chat',
      action: 'set',
      target: { provider: 'qwen', model: 'qwen-new' },
      learn: true,
    });
    expect(run(ctx, [back], custom)).toMatchObject({ step: 'model' });
    expect(run(ctx, [back], model)).toMatchObject({ step: 'provider' });
    expect(run(ctx, [back], prov)).toMatchObject({ step: 'action', route: 'chat' });
  });

  it('an unconfigured provider cannot be selected', () => {
    const ctx = ctxWith({}, [status('claude'), status('qwen', { configured: false })]);
    const prov = run(ctx, [enter, enter]);
    expect(run(ctx, [down], prov)).toEqual(prov); // stays on claude
  });

  it('new route: validates the name, then goes to the provider step; back returns to the list', () => {
    const ctx = ctxWith();
    const nr = run(ctx, [up, enter]);
    expect(nr).toEqual({ step: 'newRoute', value: '' });
    expect(validateRouteName('', ctx)).toBe('informe o nome da rota');
    expect(validateRouteName('Review', ctx)).toMatch(/minúsculas/);
    expect(validateRouteName('github', ctx)).toBe('a rota github já existe');
    expect(validateRouteName('help', ctx)).toBe('já existe um comando /help');
    expect(validateRouteName('review', ctx)).toBeUndefined();
    expect(run(ctx, [{ type: 'input', value: 'Review' }, enter], nr)).toMatchObject({
      step: 'newRoute',
      error: expect.stringMatching(/minúsculas/),
    });
    const prov = run(ctx, [{ type: 'input', value: 'review' }, enter], nr);
    expect(prov).toMatchObject({ step: 'provider', route: 'review' });
    expect(run(ctx, [back], prov)).toEqual({ step: 'newRoute', value: 'review' });
    expect(run(ctx, [back], nr)).toEqual({ step: 'list', selected: ctx.entries.length });
  });

  it('applying → done/failed → closed; messages describe the result', () => {
    const ctx = ctxWith({ review: { provider: 'claude', model: 'c' } });
    const applying: RoutesFlowState = {
      step: 'applying',
      route: 'review',
      action: 'set',
      target: { provider: 'qwen', model: 'q' },
    };
    expect(run(ctx, [{ type: 'applied', message: 'ok' }], applying)).toEqual({
      step: 'done',
      message: 'ok',
    });
    expect(run(ctx, [{ type: 'applied', message: 'ok' }, enter], applying)).toEqual({
      step: 'closed',
    });
    expect(run(ctx, [{ type: 'applyError', error: 'disco cheio' }], applying)).toEqual({
      step: 'failed',
      error: 'disco cheio',
    });
    expect(run(ctx, [{ type: 'applyError', error: 'x' }, back], applying)).toEqual({
      step: 'closed',
    });
    expect(routesEffectsFor({ step: 'closed' })).toEqual({ kind: 'close' });
    const review = ctx.entries.find((e) => e.name === 'review');
    expect(describeRouteResult(applying, review, false)).toBe(
      'Rota review → qwen / q. Use /ask review … ou /review ….',
    );
    expect(describeRouteResult({ ...applying, route: 'nova' }, undefined, true)).toBe(
      'Rota nova criada → qwen / q. (sobrescrita por ./.maestro/settings.json neste projeto) Use /ask nova … ou /nova ….',
    );
    expect(
      describeRouteResult(
        { step: 'applying', route: 'speckit.plan', action: 'reset' },
        undefined,
        false,
      ),
    ).toBe('Rota speckit.plan voltou ao padrão.');
    expect(
      describeRouteResult({ step: 'applying', route: 'review', action: 'remove' }, review, false),
    ).toBe('Rota review removida.');
  });
});
