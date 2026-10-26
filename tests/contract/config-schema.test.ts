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
      maxToolIterations: 0,
      approvalMode: 'default',
    });
    expect(r.ui).toEqual({
      altScreen: true,
      mouse: true,
      pasteCollapseLines: 3,
      attachMaxBytes: 524288,
      attachMaxTotalBytes: 2097152,
      imageMaxBytes: 5242880,
    });
  });

  it('routes: names, targets and optional adjustments (specs/008 contracts/routes-config.md § 1)', () => {
    const ok = settingsSchema.parse({
      routes: {
        _comment: 'x',
        chat: { provider: 'claude', model: 'claude-opus-5-5' },
        github: { provider: 'claude', model: 'claude-sonnet-5-5', effort: 'low' },
        'speckit.plan': { provider: 'claude', model: 'claude-opus-5-5', effort: 'high' },
        'speckit.implement': { provider: 'qwen', model: 'qwen3-coder-plus', maxTokens: 32000 },
        review_2: { provider: 'qwen', model: 'qwen3-max' },
      },
    });
    expect(ok.routes['speckit.implement']).toEqual({
      provider: 'qwen',
      model: 'qwen3-coder-plus',
      maxTokens: 32000,
    });
    expect(ok.routes['_comment']).toBe('x');
    expect(settingsSchema.parse({}).routes).toEqual({});
    expect(issuesOf({ routes: { Rota: { provider: 'claude', model: 'x' } } })[0]).toMatch(
      /^routes\.Rota: nome de rota inválido/,
    );
    expect(issuesOf({ routes: { 'a b': { provider: 'claude', model: 'x' } } })[0]).toMatch(
      /^routes\.a b: /,
    );
    expect(issuesOf({ routes: { '/x': { provider: 'claude', model: 'x' } } })[0]).toMatch(
      /^routes\.\/x: /,
    );
    expect(issuesOf({ routes: { chat: { provider: 'gemini', model: 'x' } } })[0]).toMatch(
      /^routes\.chat\.provider: /,
    );
    expect(issuesOf({ routes: { chat: { provider: 'claude', model: 'a b' } } })[0]).toMatch(
      /^routes\.chat\.model: /,
    );
    expect(issuesOf({ routes: { chat: { provider: 'claude', model: 'x', foo: 1 } } })).toContain(
      'routes.chat.foo: unknown key',
    );
    expect(
      issuesOf({ routes: { chat: { provider: 'claude', model: 'x', maxTokens: 0 } } })[0],
    ).toMatch(/^routes\.chat\.maxTokens: /);
    expect(issuesOf({ routes: { chat: 'active' } })[0]).toMatch(/^routes\.chat: must be an object/);
  });

  it('ui paste/attachment limits: integers with minimums (specs/007 contracts/attachments.md § 4)', () => {
    expect(
      settingsSchema.parse({ ui: { pasteCollapseLines: 1, attachMaxBytes: 1024 } }).ui,
    ).toMatchObject({
      pasteCollapseLines: 1,
      attachMaxBytes: 1024,
    });
    expect(issuesOf({ ui: { pasteCollapseLines: 0 } })[0]).toMatch(/^ui\.pasteCollapseLines: /);
    expect(issuesOf({ ui: { pasteCollapseLines: 2.5 } })[0]).toMatch(/^ui\.pasteCollapseLines: /);
    expect(issuesOf({ ui: { attachMaxBytes: 100 } })[0]).toMatch(/^ui\.attachMaxBytes: /);
    expect(issuesOf({ ui: { attachMaxTotalBytes: 'big' } })[0]).toMatch(
      /^ui\.attachMaxTotalBytes: /,
    );
    expect(issuesOf({ ui: { imageMaxBytes: 1 } })[0]).toMatch(/^ui\.imageMaxBytes: /);
    expect(issuesOf({ ui: { pasteCollapse: 3 } })).toContain('ui.pasteCollapse: unknown key');
  });

  it('ui.altScreen and ui.mouse are booleans with defaults', () => {
    expect(settingsSchema.parse({ ui: { altScreen: false } }).ui).toMatchObject({
      altScreen: false,
      mouse: true,
    });
    expect(settingsSchema.parse({ ui: { mouse: false } }).ui.mouse).toBe(false);
    expect(issuesOf({ ui: { altScreen: 'yes' } })[0]).toMatch(/^ui\.altScreen: /);
    expect(issuesOf({ ui: { mouse: 1 } })[0]).toMatch(/^ui\.mouse: /);
  });

  it('providers.codex: disabled by default, strict, optional non-empty command (specs/012)', () => {
    const r = settingsSchema.parse({});
    expect(r.providers.codex).toEqual({
      enabled: false,
      model: 'gpt-6-luna',
      models: ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna'],
      effort: 'medium',
    });
    expect(
      issuesOf({ providers: { codex: { enabled: true, command: 'C:/bin/codex.exe' } } }),
    ).toEqual([]);
    expect(issuesOf({ providers: { codex: { command: '' } } })[0]).toMatch(
      /^providers.codex.command: /,
    );
    expect(issuesOf({ providers: { codex: { apiKey: 'x' } } })).toContain(
      'providers.codex.apiKey: unknown key',
    );
    expect(issuesOf({ activeProvider: 'codex' })).toEqual([]);
    expect(
      issuesOf({ routes: { chat: { provider: 'codex', model: 'gpt-5.6-terra', effort: 'high' } } }),
    ).toEqual([]);
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
    expect(issuesOf({ tools: { maxToolIterations: -1 } })[0]).toMatch(
      /^tools\.maxToolIterations: /,
    );
    expect(issuesOf({ tools: { maxToolIterations: 2.5 } })[0]).toMatch(
      /^tools\.maxToolIterations: /,
    );
  });

  /** specs/006 contracts/init-and-context.md § 4 */
  it('speckit.createBranch defaults to true and unknown speckit keys are rejected', () => {
    expect(settingsSchema.parse({}).speckit).toEqual({ createBranch: true });
    expect(settingsSchema.parse({ speckit: { createBranch: false } }).speckit.createBranch).toBe(
      false,
    );
    expect(issuesOf({ speckit: { branch: true } })[0]).toMatch(/^speckit\.branch: unknown key/);
  });

  /** specs/013 contracts/settings.md */
  it('skills.enabled defaults to true and unknown skills keys are rejected', () => {
    expect(settingsSchema.parse({}).skills).toEqual({ enabled: true });
    expect(settingsSchema.parse({ skills: { enabled: false } }).skills.enabled).toBe(false);
    expect(issuesOf({ skills: { paths: [] } })[0]).toMatch(/^skills\.paths: unknown key/);
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
