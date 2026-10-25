import type { ApprovalMode } from '../tools/approval.js';

export type QwenProtocol = 'openai' | 'anthropic';

/** Qwen Cloud (token plan) endpoints — one per wire protocol. */
export const QWENCLOUD_OPENAI_BASE_URL =
  'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1';
export const QWENCLOUD_ANTHROPIC_BASE_URL =
  'https://token-plan.maas.qwencloudapi.com/apps/anthropic';
/** Alibaba Cloud Model Studio (DashScope) endpoints — alternatives for pay-as-you-go accounts. */
export const DEFAULT_DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DASHSCOPE_INTL_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

export const QWEN_DEFAULT_BASE_URLS: Record<QwenProtocol, string> = {
  openai: QWENCLOUD_OPENAI_BASE_URL,
  anthropic: QWENCLOUD_ANTHROPIC_BASE_URL,
};

/** Every endpoint the UI proposes as a default; used to decide whether a URL was user-edited. */
export const KNOWN_QWEN_BASE_URLS: readonly string[] = [
  QWENCLOUD_OPENAI_BASE_URL,
  QWENCLOUD_ANTHROPIC_BASE_URL,
  DEFAULT_DASHSCOPE_BASE_URL,
  DASHSCOPE_INTL_BASE_URL,
];

export const DEFAULTS = {
  activeProvider: 'claude',
  claude: {
    model: 'claude-opus-5-5',
    /** Initial catalogue shown by /model (contracts/model-catalog.md § 1). */
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    maxTokens: 16_000,
    effort: 'medium',
    fallbacks: true,
  },
  qwen: {
    model: 'qwen3-coder-plus',
    models: ['qwen3-coder-plus', 'qwen3-coder-flash', 'qwen3-max'],
    maxTokens: 16_000,
    protocol: 'openai' as QwenProtocol,
  },
  tools: {
    enabled: true,
    commandTimeoutMs: 60_000,
    maxOutputChars: 20_000,
    approvalMode: 'default' as ApprovalMode,
  },
} as const;

/** Effective Qwen endpoint: the configured URL or the protocol's default. */
export function resolveQwenBaseUrl(cfg: { protocol: QwenProtocol; baseUrl?: string }): string {
  return cfg.baseUrl ?? QWEN_DEFAULT_BASE_URLS[cfg.protocol];
}

/** Content written to `~/.maestro/settings.json` on first run (contracts/config-schema.md § 4). */
export const INITIAL_SETTINGS = {
  _comment:
    "Maestro settings. Edit providers below, or run /auth inside maestro. Secrets may also come from env vars: ANTHROPIC_API_KEY (or 'ant auth login') for claude, DASHSCOPE_API_KEY for qwen.",
  activeProvider: 'claude',
  providers: {
    claude: {
      _comment:
        "Uses credentials already on this machine: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an 'ant auth login' profile. Set apiKey here only if you must.",
      enabled: true,
      model: DEFAULTS.claude.model,
      models: [...DEFAULTS.claude.models],
      maxTokens: DEFAULTS.claude.maxTokens,
      effort: DEFAULTS.claude.effort,
      fallbacks: DEFAULTS.claude.fallbacks,
    },
    qwen: {
      _comment: `Qwen Cloud. protocol: 'openai' (default ${QWENCLOUD_OPENAI_BASE_URL}) or 'anthropic' (default ${QWENCLOUD_ANTHROPIC_BASE_URL}). Set baseUrl to override, e.g. DashScope ${DEFAULT_DASHSCOPE_BASE_URL} or ${DASHSCOPE_INTL_BASE_URL}. Set apiKey (or DASHSCOPE_API_KEY) and enabled: true.`,
      enabled: false,
      protocol: DEFAULTS.qwen.protocol,
      model: DEFAULTS.qwen.model,
      models: [...DEFAULTS.qwen.models],
      maxTokens: DEFAULTS.qwen.maxTokens,
      apiKey: '',
    },
  },
  tools: {
    _comment:
      "approvalMode: 'default' (ask before every edit and command), 'auto-edit' (edits run, commands ask), 'auto' (only destructive commands ask), 'yolo' (never ask). Tab cycles it for the session.",
    enabled: DEFAULTS.tools.enabled,
    commandTimeoutMs: DEFAULTS.tools.commandTimeoutMs,
    maxOutputChars: DEFAULTS.tools.maxOutputChars,
    approvalMode: DEFAULTS.tools.approvalMode,
  },
  ui: {
    _comment:
      'altScreen: draw on the alternate screen and restore the console on exit. mouse: wheel scrolling.',
    altScreen: true,
    mouse: true,
  },
};

export function initialSettingsJson(): string {
  return JSON.stringify(INITIAL_SETTINGS, null, 2) + '\n';
}
