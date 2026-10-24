import type { ProviderContext, ProviderId, ProviderStatus } from './types.js';
import { mask } from '../utils/mask.js';

export const DISPLAY_NAMES: Record<ProviderId, string> = {
  claude: 'Claude (Anthropic)',
  qwen: 'Qwen (Alibaba Cloud)',
};

export const CREDENTIAL_HINTS: Record<ProviderId, string> = {
  claude: "No Claude credentials found. Run 'ant auth login' or export ANTHROPIC_API_KEY.",
  qwen: 'Qwen API key missing. Set DASHSCOPE_API_KEY or providers.qwen.apiKey in settings.json.',
};

/** Computes a provider's status from settings + environment; never touches the network. */
export function describeProvider(id: ProviderId, ctx: ProviderContext): ProviderStatus {
  const env = ctx.env ?? process.env;
  const settings = ctx.settings.providers[id];
  const credentialSource = ctx.credentialSources[id];
  const missing: string[] = [];

  let maskedKey: string | undefined;
  if (id === 'claude') {
    if (credentialSource === 'none') missing.push('credentials');
    const key =
      ctx.settings.providers.claude.apiKey ??
      env['ANTHROPIC_API_KEY'] ??
      env['ANTHROPIC_AUTH_TOKEN'];
    if (key && credentialSource !== 'profile') maskedKey = mask(key);
  } else {
    const key = env['DASHSCOPE_API_KEY'] || ctx.settings.providers.qwen.apiKey;
    if (!key) missing.push('apiKey');
    else maskedKey = mask(key);
  }

  const configured = settings.enabled && missing.length === 0;
  return {
    id,
    displayName: DISPLAY_NAMES[id],
    enabled: settings.enabled,
    configured,
    active: ctx.activeId === id,
    model: settings.model,
    credentialSource,
    maskedKey,
    missing,
    hint: missing.length ? CREDENTIAL_HINTS[id] : undefined,
  };
}

export type StatusLabel = 'active' | 'ready' | 'not configured' | 'disabled';

export function statusLabel(s: ProviderStatus): StatusLabel {
  if (!s.enabled) return 'disabled';
  if (!s.configured) return 'not configured';
  return s.active ? 'active' : 'ready';
}
