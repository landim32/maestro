import { describe, expect, it } from 'vitest';
import { preflight } from '../../../src/cli/preflight.js';
import { listStatuses } from '../../../src/providers/index.js';
import { makeCtx } from '../../helpers/context.js';

function out() {
  const chunks: string[] = [];
  return { write: (s: string) => chunks.push(s), text: () => chunks.join('') };
}

describe('preflight', () => {
  it('passes when the active provider is configured', async () => {
    const statuses = listStatuses(makeCtx({}, { credentials: { claude: 'env' } }));
    const r = await preflight({ statuses, activeId: 'claude', interactive: true, stderr: out() });
    expect(r).toEqual({ ok: true, providerId: 'claude', switched: false });
  });

  it('exits with 3 when nothing is usable, printing what is missing and the hint', async () => {
    const stderr = out();
    const statuses = listStatuses(makeCtx({}, { credentials: { claude: 'none' } }));
    const r = await preflight({ statuses, activeId: 'claude', interactive: false, stderr });
    expect(r).toEqual({ ok: false, code: 3 });
    expect(stderr.text()).toMatch(/provider 'claude' is not configured \(missing: credentials\)/);
    expect(stderr.text()).toMatch(/ant auth login/);
  });

  it('uses the alternative automatically in non-interactive mode, with a warning', async () => {
    const stderr = out();
    const statuses = listStatuses(
      makeCtx(
        { providers: { qwen: { enabled: true, apiKey: 'k-1' } } },
        { credentials: { claude: 'none', qwen: 'config' } },
      ),
    );
    const r = await preflight({ statuses, activeId: 'claude', interactive: false, stderr });
    expect(r).toEqual({ ok: true, providerId: 'qwen', switched: true });
    expect(stderr.text()).toMatch(/Using 'qwen' instead/);
  });

  it('asks in interactive mode and respects yes / no', async () => {
    const statuses = listStatuses(
      makeCtx(
        { providers: { qwen: { enabled: true, apiKey: 'k-1' } } },
        { credentials: { claude: 'none', qwen: 'config' } },
      ),
    );
    const yes = await preflight({
      statuses,
      activeId: 'claude',
      interactive: true,
      stderr: out(),
      ask: async (q) => /qwen/.test(q),
    });
    expect(yes).toEqual({ ok: true, providerId: 'qwen', switched: true });
    const no = await preflight({
      statuses,
      activeId: 'claude',
      interactive: true,
      stderr: out(),
      ask: async () => false,
    });
    expect(no).toEqual({ ok: false, code: 3 });
  });

  it('treats a disabled active provider as unusable', async () => {
    const stderr = out();
    const statuses = listStatuses(
      makeCtx(
        { providers: { qwen: { enabled: false, apiKey: 'k-1' } } },
        { activeId: 'qwen', credentials: { claude: 'env', qwen: 'config' } },
      ),
    );
    const r = await preflight({ statuses, activeId: 'qwen', interactive: false, stderr });
    expect(r).toEqual({ ok: true, providerId: 'claude', switched: true });
    expect(stderr.text()).toMatch(/provider 'qwen' is disabled/);
  });
});
