export const DEFAULT_DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DASHSCOPE_INTL_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

export const DEFAULTS = {
  activeProvider: 'claude',
  claude: {
    model: 'claude-opus-5-5',
    maxTokens: 16_000,
    effort: 'medium',
    fallbacks: true,
  },
  qwen: {
    model: 'qwen3-coder-plus',
    maxTokens: 16_000,
    baseUrl: DEFAULT_DASHSCOPE_BASE_URL,
  },
  tools: {
    enabled: true,
    commandTimeoutMs: 60_000,
    maxOutputChars: 20_000,
  },
} as const;

/** Content written to `~/.maestro/settings.json` on first run (contracts/config-schema.md § 4). */
export const INITIAL_SETTINGS = {
  _comment:
    "Maestro settings. Edit providers below. Secrets may also come from env vars: ANTHROPIC_API_KEY (or 'ant auth login') for claude, DASHSCOPE_API_KEY for qwen.",
  activeProvider: 'claude',
  providers: {
    claude: {
      _comment:
        "Uses credentials already on this machine: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an 'ant auth login' profile. Set apiKey here only if you must.",
      enabled: true,
      model: DEFAULTS.claude.model,
      maxTokens: DEFAULTS.claude.maxTokens,
      effort: DEFAULTS.claude.effort,
      fallbacks: DEFAULTS.claude.fallbacks,
    },
    qwen: {
      _comment: `Alibaba Cloud DashScope (OpenAI-compatible). Set apiKey (or DASHSCOPE_API_KEY) and set enabled to true. International endpoint: ${DASHSCOPE_INTL_BASE_URL}`,
      enabled: false,
      model: DEFAULTS.qwen.model,
      maxTokens: DEFAULTS.qwen.maxTokens,
      baseUrl: DEFAULTS.qwen.baseUrl,
      apiKey: '',
    },
  },
  tools: {
    enabled: DEFAULTS.tools.enabled,
    commandTimeoutMs: DEFAULTS.tools.commandTimeoutMs,
    maxOutputChars: DEFAULTS.tools.maxOutputChars,
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
