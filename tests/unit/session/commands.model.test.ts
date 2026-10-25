import { describe, expect, it } from 'vitest';
import { executeSlash } from '../../../src/session/commands.js';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { makeCtx } from '../../helpers/context.js';
import { textProvider } from '../../helpers/fakeProvider.js';
import type { ProviderId } from '../../../src/providers/types.js';

function make(
  opts: { qwenEnabled?: boolean; qwenKey?: string } = {
    qwenEnabled: true,
    qwenKey: 'sk-qwen-7777',
  },
) {
  const session = new Session({ cwd: '/w', activeProviderId: 'claude' });
  const providers: Record<ProviderId, ReturnType<typeof textProvider>> = {
    claude: textProvider(['from claude', 'from claude 2'], { id: 'claude' }),
    qwen: textProvider(['from qwen'], { id: 'qwen' }),
  };
  const ctl = new SessionController({
    session,
    ctx: makeCtx(
      { providers: { qwen: { enabled: opts.qwenEnabled ?? true, apiKey: opts.qwenKey } } },
      { credentials: { claude: 'env', qwen: opts.qwenKey ? 'config' : 'none' } },
    ),
    tools: [],
    system: 'sys',
    providerOverride: (id) => providers[id],
  });
  return { session, ctl, providers };
}

describe('/model', () => {
  it('without args opens the model selector (interactive) with the active item marked', async () => {
    const { ctl } = make();
    await executeSlash('/model', ctl);
    expect(ctl.dialog?.type).toBe('model');
    const flow = ctl.dialog?.type === 'model' ? ctl.dialog.flow : undefined;
    expect(flow?.step).toBe('list');
    if (flow?.step === 'list') {
      // one row per catalogue model, grouped by provider (contracts/model-catalog.md § 2)
      expect([...new Set(flow.items.map((i) => i.providerId))]).toEqual(['claude', 'qwen']);
      expect(flow.items[flow.selected]).toMatchObject({
        providerId: 'claude',
        model: 'claude-opus-5-5',
        active: true,
      });
      expect(flow.items.find((i) => i.providerId === 'qwen')?.maskedKey).toBe('****7777');
    }
  });

  it('the textual provider table masks keys and marks the active provider', () => {
    const { ctl } = make();
    const text = ctl.describeProviders();
    expect(text).toContain('Active: claude / claude-opus-5-5');
    expect(text).toMatch(/claude\s+active/);
    expect(text).toMatch(/qwen\s+ready/);
    expect(text).toContain('****7777');
    expect(text).not.toContain('sk-qwen-7777');
    // catalogues per provider with the active model starred (contracts/model-catalog.md § 3)
    expect(text).toContain('Models:');
    expect(text).toMatch(/claude:\s+\* claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5/);
    expect(text).toMatch(/qwen:\s+qwen3-coder-plus, qwen3-coder-flash, qwen3-max/);
  });

  it('switches provider preserving history; following turns go to the new provider', async () => {
    const { ctl, session, providers } = make();
    await ctl.submit('hello');
    expect(providers.claude.requests).toHaveLength(1);
    await executeSlash('/model qwen', ctl);
    expect(session.activeProviderId).toBe('qwen');
    expect(session.history).toHaveLength(2);
    expect(ctl.notices.at(-1)?.text).toMatch(/Switched to qwen \/ qwen3-coder-plus/);
    await ctl.submit('again');
    expect(providers.qwen.requests).toHaveLength(1);
    expect(providers.qwen.requests[0]?.messages).toHaveLength(3);
    expect(session.history.at(-1)?.providerId).toBe('qwen');
  });

  it('switches provider and model together', async () => {
    const { ctl, session } = make();
    await executeSlash('/model qwen qwen-max', ctl);
    expect(session.modelOverride).toBe('qwen-max');
    expect(ctl.activeModel).toBe('qwen-max');
    expect(ctl.notices.at(-1)?.text).toContain('qwen / qwen-max');
  });

  it('rejects unknown, disabled and unconfigured providers with clear messages', async () => {
    const unknown = make();
    await executeSlash('/model gemini', unknown.ctl);
    expect(unknown.ctl.notices.at(-1)).toMatchObject({ level: 'warn' });
    expect(unknown.ctl.notices.at(-1)?.text).toMatch(/Unknown provider 'gemini'/);
    expect(unknown.session.activeProviderId).toBe('claude');

    const disabled = make({ qwenEnabled: false, qwenKey: 'k-1' });
    await executeSlash('/model qwen', disabled.ctl);
    expect(disabled.ctl.notices.at(-1)?.text).toMatch(/disabled/);

    const unconfigured = make({ qwenEnabled: true });
    await executeSlash('/model qwen', unconfigured.ctl);
    expect(unconfigured.ctl.notices.at(-1)?.text).toMatch(/not configured \(missing: apiKey\)/);
    expect(unconfigured.ctl.notices.at(-1)?.text).toMatch(/DASHSCOPE_API_KEY/);
  });

  it('is rejected while a response is in progress', async () => {
    const { ctl, session } = make();
    session.beginGeneration();
    await executeSlash('/model qwen', ctl);
    expect(session.activeProviderId).toBe('claude');
    expect(ctl.notices.at(-1)?.text).toMatch(/in progress/);
  });
});
