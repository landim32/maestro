import { describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { initialModelFlow } from '../../../src/setup/modelFlow.js';
import { makeCtx, makeSettings } from '../../helpers/context.js';
import { textProvider } from '../../helpers/fakeProvider.js';

function make() {
  const session = new Session({ cwd: '/w', activeProviderId: 'claude' });
  const provider = textProvider(['ok']);
  const ctl = new SessionController({
    session,
    ctx: makeCtx(),
    tools: [],
    system: 's',
    providerOverride: () => provider,
  });
  return { ctl, session, provider };
}

describe('SessionController dialogs', () => {
  it('opens one dialog at a time and only when idle', () => {
    const { ctl, session } = make();
    const dialog = {
      type: 'model' as const,
      flow: initialModelFlow({
        statuses: ctl.statuses(),
        settings: ctl.settings,
        activeModel: ctl.activeModel,
      }),
    };
    session.beginGeneration();
    expect(ctl.openDialog(dialog)).toBe(false);
    expect(ctl.notices.at(-1)?.text).toMatch(/Aguarde/);
    session.endGeneration();
    expect(ctl.openDialog(dialog)).toBe(true);
    expect(ctl.openDialog(dialog)).toBe(false);
    ctl.closeDialog();
    expect(ctl.dialog).toBeUndefined();
  });

  it('ignores chat input while a dialog is open', async () => {
    const { ctl, provider } = make();
    ctl.openDialog({
      type: 'model',
      flow: initialModelFlow({
        statuses: ctl.statuses(),
        settings: ctl.settings,
        activeModel: ctl.activeModel,
      }),
    });
    const r = await ctl.submit('hello');
    expect(r).toBeUndefined();
    expect(provider.requests).toHaveLength(0);
    expect(ctl.notices.at(-1)?.text).toMatch(/Feche o diálogo/);
  });

  it('applySettings swaps settings/credentials and invalidates the cached provider', () => {
    const session = new Session({ cwd: '/w', activeProviderId: 'claude' });
    const factory = vi.fn(() => textProvider(['ok']));
    const ctl = new SessionController({
      session,
      ctx: makeCtx(),
      tools: [],
      system: 's',
      providerOverride: factory,
    });
    void ctl.activeProvider;
    void ctl.activeProvider; // cached: factory called once
    expect(factory).toHaveBeenCalledTimes(1);
    ctl.applySettings({
      settings: makeSettings({ providers: { qwen: { enabled: true, apiKey: 'k-1111' } } }),
      credentialSources: { claude: 'profile', qwen: 'config' },
    });
    expect(ctl.settings.providers.qwen.enabled).toBe(true);
    expect(ctl.statuses()[1]).toMatchObject({ configured: true, maskedKey: '****1111' });
    expect(ctl.statuses()[0]?.credentialSource).toBe('profile');
    void ctl.activeProvider; // rebuilt after applySettings
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('markUnverified is reflected in statuses and cleared after a successful turn', async () => {
    const { ctl } = make();
    ctl.markUnverified('claude');
    expect(ctl.statuses()[0]?.verified).toBe(false);
    await ctl.submit('hi');
    expect(ctl.statuses()[0]?.verified).toBeUndefined();
  });

  it('writeSettings without paths is an in-memory no-op', () => {
    const { ctl } = make();
    expect(ctl.writeSettings([{ path: 'activeProvider', value: 'qwen' }])).toEqual({
      path: '(memory)',
      overriddenByProject: [],
    });
  });
});
