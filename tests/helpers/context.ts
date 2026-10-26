import { settingsSchema } from '../../src/config/schema.js';
import type { Settings, SettingsInput } from '../../src/config/schema.js';
import type { CredentialSource } from '../../src/config/loader.js';
import type { ProviderContext, ProviderId } from '../../src/providers/types.js';

export function makeSettings(input: SettingsInput = {}): Settings {
  return settingsSchema.parse(input);
}

export function makeCtx(
  input: SettingsInput = {},
  opts: {
    activeId?: ProviderId;
    credentials?: Partial<Record<ProviderId, CredentialSource>>;
    env?: NodeJS.ProcessEnv;
  } = {},
): ProviderContext {
  return {
    settings: makeSettings(input),
    activeId: opts.activeId ?? 'claude',
    credentialSources: {
      claude: 'env',
      qwen: 'none',
      'claude-code': 'none',
      codex: 'none',
      ...opts.credentials,
    },
    env: opts.env ?? {},
  };
}
