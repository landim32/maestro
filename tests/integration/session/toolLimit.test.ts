/** `tools.maxToolIterations` (default 50) reaches both tool loops through the controller. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS } from '../../../src/config/defaults.js';
import type { SettingsInput } from '../../../src/config/schema.js';
import type { ModelProvider, ProviderEvent } from '../../../src/providers/types.js';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { CALLS_PER_ITERATION, MAX_TOOL_ITERATIONS } from '../../../src/session/turn.js';
import { allTools } from '../../../src/tools/registry.js';
import { makeCtx } from '../../helpers/context.js';
import { createFakeProvider } from '../../helpers/fakeProvider.js';

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-limit-'));
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'a\n');
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

const readCall = (i: number): ProviderEvent[] => [
  { type: 'tool_call', callId: `c${i}`, name: 'read_file', input: { path: 'a.txt' } },
  { type: 'done', stopReason: 'tool_use' },
];

function controller(provider: ModelProvider, settings: SettingsInput = {}) {
  return new SessionController({
    session: new Session({ cwd, activeProviderId: 'claude' }),
    ctx: makeCtx(settings),
    tools: allTools(),
    system: 'sys',
    interactive: false,
    providerOverride: () => provider,
  });
}

describe('tool iteration limit', () => {
  it('defaults to 50 rounds (250 Claude Code calls)', () => {
    expect(DEFAULTS.tools.maxToolIterations).toBe(50);
    expect(MAX_TOOL_ITERATIONS).toBe(50);
    expect(DEFAULTS.tools.maxToolIterations * CALLS_PER_ITERATION).toBe(250);
  });

  it('the built-in loop stops at tools.maxToolIterations from settings.json', async () => {
    const provider = createFakeProvider((_req, i) => readCall(i));
    const ctl = controller(provider, { tools: { maxToolIterations: 3 } });
    const r = await ctl.submit('leia sem parar');
    expect(r?.toolIterations).toBe(3);
    expect(provider.requests).toHaveLength(3);
    expect(ctl.notices.map((n) => n.text)).toContain('stopped after 3 tool iterations in one turn');
  });

  it('without configuration a long agentic turn is not cut at 10 rounds', async () => {
    const provider = createFakeProvider((_req, i) =>
      i < 15
        ? readCall(i)
        : [
            { type: 'text_delta', text: 'pronto' },
            { type: 'done', stopReason: 'end_turn' },
          ],
    );
    const ctl = controller(provider);
    const r = await ctl.submit('implemente');
    expect(r?.stopReason).toBe('end_turn');
    expect(r?.toolIterations).toBe(15);
    expect(ctl.notices.some((n) => n.text.includes('tool iterations'))).toBe(false);
  });

  it('a provider-driven turn (Claude Code) gets 5 calls per configured round', async () => {
    const results: boolean[] = [];
    const provider: ModelProvider = {
      id: 'claude',
      displayName: 'driven',
      capabilities: { executesTools: true },
      status: () => createFakeProvider([]).status(),
      async *stream(req) {
        for (let i = 0; i < 12; i++) {
          const r = await req.runTool!({
            callId: `d${i}`,
            name: 'read_file',
            input: { path: 'a.txt' },
          });
          results.push(r.isError);
        }
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const ctl = controller(provider, { tools: { maxToolIterations: 2 } });
    await ctl.submit('x');
    expect(results.slice(0, 10).every((e) => !e)).toBe(true); // 2 × 5 calls run
    expect(results.slice(10).every((e) => e)).toBe(true);
    expect(ctl.notices.map((n) => n.text)).toContain('stopped after 10 tool calls in one turn');
  });
});
