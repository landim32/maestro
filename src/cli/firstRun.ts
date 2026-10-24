import type { ProviderStatus } from '../providers/types.js';
import { statusLabel } from '../providers/status.js';

/** Message shown once, right after the global settings file is created (contracts/cli.md § 4). */
export function firstRunMessage(globalPath: string, statuses: ProviderStatus[]): string {
  const lines = [
    `Welcome to maestro! Created ${globalPath}`,
    '',
    'Providers:',
    ...statuses.map((s) => {
      const base = `  ${s.id.padEnd(7)} ${statusLabel(s).padEnd(15)} ${s.model}`;
      return s.hint ? `${base}\n          ${s.hint}` : base;
    }),
    '',
    'Credentials:',
    "  claude  reuses what is already on this machine: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an 'ant auth login' profile.",
    '  qwen    set DASHSCOPE_API_KEY (or providers.qwen.apiKey) and providers.qwen.enabled = true.',
    '',
    'Edit the file above, or pass --provider <id> to pick a provider for one run.',
  ];
  return lines.join('\n');
}
