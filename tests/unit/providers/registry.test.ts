import { describe, expect, it } from 'vitest';
import {
  createProvider,
  findAlternative,
  listStatuses,
  registeredProviders,
} from '../../../src/providers/index.js';
import { statusLabel } from '../../../src/providers/status.js';
import { makeCtx } from '../../helpers/context.js';

describe('provider registry', () => {
  it('registers claude, qwen and claude-code', () => {
    expect(registeredProviders()).toEqual(['claude', 'qwen', 'claude-code']);
    expect(createProvider('claude', makeCtx()).id).toBe('claude');
    expect(createProvider('qwen', makeCtx()).id).toBe('qwen');
  });

  it('lists statuses with labels active / ready / not configured / disabled', () => {
    const ctx = makeCtx(
      { activeProvider: 'claude', providers: { qwen: { enabled: true, apiKey: 'sk-q-4321' } } },
      { credentials: { claude: 'env', qwen: 'config' } },
    );
    const [claude, qwen] = listStatuses(ctx);
    expect(statusLabel(claude!)).toBe('active');
    expect(statusLabel(qwen!)).toBe('ready');
    expect(qwen).toMatchObject({
      displayName: 'Qwen (Alibaba Cloud)',
      credentialSource: 'config',
      maskedKey: '****4321',
      model: 'qwen3-coder-plus',
    });
    expect(claude).toMatchObject({
      displayName: 'Claude (Anthropic API · consome créditos de API)',
      credentialSource: 'env',
      missing: [],
    });

    const noCreds = listStatuses(makeCtx({}, { credentials: { claude: 'none' } }));
    expect(statusLabel(noCreds[0]!)).toBe('not configured');
    expect(noCreds[0]?.missing).toEqual(['credentials']);
    expect(statusLabel(noCreds[1]!)).toBe('disabled');
  });

  it('prefers the env key for qwen when both are present', () => {
    const ctx = makeCtx(
      { providers: { qwen: { enabled: true, apiKey: 'cfg-key-0000' } } },
      { env: { DASHSCOPE_API_KEY: 'env-key-9999' }, credentials: { qwen: 'env' } },
    );
    const qwen = listStatuses(ctx)[1]!;
    expect(qwen.maskedKey).toBe('****9999');
    expect(qwen.credentialSource).toBe('env');
  });

  it('does not expose a profile-based claude key', () => {
    const ctx = makeCtx({}, { credentials: { claude: 'profile' } });
    expect(listStatuses(ctx)[0]?.maskedKey).toBeUndefined();
  });

  it('findAlternative returns the first ready provider other than the active one', () => {
    const ctx = makeCtx(
      { providers: { qwen: { enabled: true, apiKey: 'k-1234' } } },
      { credentials: { claude: 'none', qwen: 'config' } },
    );
    const statuses = listStatuses(ctx);
    expect(findAlternative(statuses, 'claude')?.id).toBe('qwen');
    expect(findAlternative(statuses, 'qwen')).toBeUndefined();
  });
});
