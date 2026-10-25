import { describe, expect, it } from 'vitest';
import { INITIAL_SETTINGS, initialSettingsJson } from '../../src/config/defaults.js';
import { formatZodIssues, settingsSchema } from '../../src/config/schema.js';

function issuesOf(input: unknown): string[] {
  const r = settingsSchema.safeParse(input);
  return r.success ? [] : formatZodIssues(r.error);
}

describe('contract: settings.json schema (contracts/config-schema.md)', () => {
  it('the generated first-run file validates without errors', () => {
    expect(issuesOf(INITIAL_SETTINGS)).toEqual([]);
    expect(issuesOf(JSON.parse(initialSettingsJson()))).toEqual([]);
  });

  it('an empty object validates and yields all defaults', () => {
    const r = settingsSchema.parse({});
    expect(r.activeProvider).toBe('claude');
    expect(r.providers.claude).toMatchObject({
      enabled: true,
      model: 'claude-opus-5-5',
      maxTokens: 16000,
      effort: 'medium',
      fallbacks: true,
    });
    expect(r.providers.qwen).toMatchObject({
      enabled: false,
      protocol: 'openai',
      model: 'qwen3-coder-plus',
      maxTokens: 16000,
    });
    // no baseUrl stored: the provider resolves the protocol's Qwen Cloud endpoint
    expect(r.providers.qwen.baseUrl).toBeUndefined();
    expect(r.tools).toEqual({
      enabled: true,
      commandTimeoutMs: 60000,
      maxOutputChars: 20000,
      approvalMode: 'default',
    });
    expect(r.ui).toEqual({ altScreen: true, mouse: true });
  });

  it('ui.altScreen and ui.mouse are booleans with defaults', () => {
    expect(settingsSchema.parse({ ui: { altScreen: false } }).ui).toEqual({
      altScreen: false,
      mouse: true,
    });
    expect(settingsSchema.parse({ ui: { mouse: false } }).ui.mouse).toBe(false);
    expect(issuesOf({ ui: { altScreen: 'yes' } })[0]).toMatch(/^ui\.altScreen: /);
    expect(issuesOf({ ui: { mouse: 1 } })[0]).toMatch(/^ui\.mouse: /);
  });

  it('rejects unknown keys at any level with the full path', () => {
    expect(issuesOf({ foo: 1 })).toContain('foo: unknown key');
    expect(issuesOf({ providers: { qwen: { apiKeyy: 'x' } } })).toContain(
      'providers.qwen.apiKeyy: unknown key',
    );
    expect(issuesOf({ providers: { gemini: {} } })).toContain('providers.gemini: unknown key');
  });

  it('rejects an unknown activeProvider', () => {
    expect(issuesOf({ activeProvider: 'gemini' })[0]).toMatch(/^activeProvider: /);
  });

  it('providers.<id>.models: defaults, empty → defaults, tokens and duplicates (contracts/model-catalog.md § 1)', () => {
    const r = settingsSchema.parse({});
    expect(r.providers.claude.models).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]);
    expect(r.providers.qwen.models).toEqual(['qwen3-coder-plus', 'qwen3-coder-flash', 'qwen3-max']);
    expect(settingsSchema.parse(INITIAL_SETTINGS).providers.qwen.models).toEqual(
      r.providers.qwen.models,
    );
    expect(
      settingsSchema.parse({ providers: { qwen: { models: [] } } }).providers.qwen.models,
    ).toEqual(r.providers.qwen.models);
    expect(
      settingsSchema.parse({ providers: { qwen: { models: ['a', 'b'] } } }).providers.qwen.models,
    ).toEqual(['a', 'b']);
    expect(issuesOf({ providers: { qwen: { models: ['ok', 'a b'] } } })).toContain(
      'providers.qwen.models.1: must be a single non-empty token',
    );
    expect(issuesOf({ providers: { qwen: { models: [''] } } })).toContain(
      'providers.qwen.models.0: must be a single non-empty token',
    );
    expect(issuesOf({ providers: { qwen: { models: ['x', 'y', 'x'] } } })).toContain(
      "providers.qwen.models: duplicate model 'x'",
    );
    expect(issuesOf({ providers: { qwen: { models: 'x' } } })[0]).toMatch(
      /^providers\.qwen\.models: /,
    );
  });

  it('requires http(s) scheme on baseUrl and strips the trailing slash', () => {
    expect(issuesOf({ providers: { qwen: { baseUrl: 'dashscope.aliyuncs.com/v1' } } })).toContain(
      'providers.qwen.baseUrl: must start with http:// or https://',
    );
    const r = settingsSchema.parse({
      providers: { claude: { baseUrl: 'https://proxy.example/anthropic/' } },
    });
    expect(r.providers.claude.baseUrl).toBe('https://proxy.example/anthropic');
  });

  it('validates model, maxTokens, effort, tools bounds', () => {
    expect(issuesOf({ providers: { claude: { model: '' } } })).toContain(
      'providers.claude.model: must not be empty',
    );
    expect(issuesOf({ providers: { claude: { maxTokens: 0 } } })[0]).toMatch(
      /^providers\.claude\.maxTokens: /,
    );
    expect(issuesOf({ providers: { claude: { maxTokens: 300000 } } })[0]).toMatch(
      /^providers\.claude\.maxTokens: /,
    );
    expect(issuesOf({ providers: { claude: { effort: 'ultra' } } })[0]).toMatch(
      /^providers\.claude\.effort: /,
    );
    expect(issuesOf({ tools: { commandTimeoutMs: 10 } })[0]).toMatch(/^tools\.commandTimeoutMs: /);
    expect(issuesOf({ tools: { maxOutputChars: 10 } })[0]).toMatch(/^tools\.maxOutputChars: /);
  });

  /** contracts/approval-modes.md § 1, § 5 */
  it('tools.approvalMode accepts the four modes and rejects anything else', () => {
    for (const mode of ['default', 'auto-edit', 'auto', 'yolo'] as const) {
      expect(settingsSchema.parse({ tools: { approvalMode: mode } }).tools.approvalMode).toBe(mode);
    }
    expect(issuesOf({ tools: { approvalMode: 'plan' } })[0]).toMatch(/^tools\.approvalMode: /);
    expect(issuesOf({ tools: { approvalMode: 'foo' } })[0]).toMatch(/^tools\.approvalMode: /);
  });

  it('allows _comment at every level and treats apiKey "" as unset', () => {
    const r = settingsSchema.parse({
      _comment: 'a',
      providers: { claude: { _comment: 'b', apiKey: '' }, qwen: { _comment: 'c' } },
      tools: { _comment: 'd' },
      ui: { _comment: 'e', color: false },
    });
    expect(r.providers.claude.apiKey).toBeUndefined();
    expect(r.ui.color).toBe(false);
  });

  it('rejects an explicitly empty apiKey only when it is a non-string', () => {
    expect(issuesOf({ providers: { qwen: { apiKey: 123 } } })[0]).toMatch(
      /^providers\.qwen\.apiKey: /,
    );
  });
});
