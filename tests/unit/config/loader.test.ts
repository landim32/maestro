import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadSettings, mergeSettings } from '../../../src/config/loader.js';
import { INITIAL_SETTINGS } from '../../../src/config/defaults.js';

let home: string;
let cwd: string;
const baseEnv: NodeJS.ProcessEnv = { PATH: process.env['PATH'] };

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...baseEnv, MAESTRO_HOME: home, ...extra };
}

function writeGlobal(obj: unknown): string {
  const p = path.join(home, '.maestro', 'settings.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  return p;
}

function writeProject(obj: unknown): string {
  const p = path.join(cwd, '.maestro', 'settings.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-home-'));
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-cwd-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('loadSettings', () => {
  it('creates the global settings file on first run and reports created=true', () => {
    const loaded = loadSettings({ cwd, env: env(), platform: 'linux' });
    expect(loaded.created).toBe(true);
    expect(fs.existsSync(loaded.globalPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(loaded.globalPath, 'utf8'))).toEqual(INITIAL_SETTINGS);
    expect(loaded.settings.activeProvider).toBe('claude');
    expect(loaded.settings.providers.qwen.enabled).toBe(false);
    expect(loaded.settings.providers.qwen.apiKey).toBeUndefined();
    expect(loaded.credentialSources).toEqual({
      claude: 'none',
      qwen: 'none',
      'claude-code': 'none',
    });
  });

  it('applies defaults for missing fields', () => {
    writeGlobal({ activeProvider: 'claude' });
    const { settings } = loadSettings({ cwd, env: env(), platform: 'linux' });
    expect(settings.providers.claude.model).toBe('claude-opus-5-5');
    expect(settings.providers.claude.effort).toBe('medium');
    expect(settings.providers.claude.fallbacks).toBe(true);
    expect(settings.providers.qwen.protocol).toBe('openai');
    expect(settings.providers.qwen.baseUrl).toBeUndefined();
    expect(settings.tools).toEqual({
      enabled: true,
      commandTimeoutMs: 60000,
      maxOutputChars: 20000,
      approvalMode: 'default',
    });
  });

  it('project file overrides global; a provider block is replaced whole', () => {
    writeGlobal({
      activeProvider: 'claude',
      providers: { qwen: { enabled: true, apiKey: 'global-key-1111', model: 'qwen-max' } },
    });
    writeProject({
      activeProvider: 'qwen',
      providers: { qwen: { enabled: true, apiKey: 'proj-key-2222' } },
    });
    const loaded = loadSettings({ cwd, env: env(), platform: 'linux' });
    expect(loaded.projectPath).toBeDefined();
    expect(loaded.settings.activeProvider).toBe('qwen');
    expect(loaded.settings.providers.qwen.apiKey).toBe('proj-key-2222');
    expect(loaded.settings.providers.qwen.model).toBe('qwen3-coder-plus'); // not inherited from global
    expect(loaded.credentialSources.qwen).toBe('config');
  });

  it('environment variables override files', () => {
    writeGlobal({
      providers: {
        qwen: { enabled: true, apiKey: 'file-key-1111', baseUrl: 'https://file.example/v1' },
      },
    });
    const loaded = loadSettings({
      cwd,
      env: env({
        DASHSCOPE_API_KEY: 'env-key-2222',
        DASHSCOPE_BASE_URL: 'https://env.example/v1/',
        MAESTRO_PROVIDER: 'qwen',
      }),
      platform: 'linux',
    });
    expect(loaded.settings.providers.qwen.apiKey).toBe('env-key-2222');
    expect(loaded.settings.providers.qwen.baseUrl).toBe('https://env.example/v1');
    expect(loaded.settings.activeProvider).toBe('qwen');
    expect(loaded.credentialSources.qwen).toBe('env');
  });

  it('argument overrides win over env and files', () => {
    writeGlobal({ activeProvider: 'claude' });
    const loaded = loadSettings({
      cwd,
      env: env({ MAESTRO_PROVIDER: 'claude', DASHSCOPE_API_KEY: 'k-9999' }),
      platform: 'linux',
      overrides: { provider: 'qwen', model: 'qwen-plus', noTools: true, approvalMode: 'auto' },
    });
    expect(loaded.settings.activeProvider).toBe('qwen');
    expect(loaded.settings.providers.qwen.model).toBe('qwen-plus');
    expect(loaded.settings.tools.enabled).toBe(false);
    expect(loaded.settings.tools.approvalMode).toBe('auto');
  });

  /** contracts/approval-modes.md § 5 — precedence of tools.approvalMode */
  it('tools.approvalMode: argument > project file > global file > default', () => {
    writeGlobal({ tools: { approvalMode: 'auto-edit' } });
    expect(loadSettings({ cwd, env: env(), platform: 'linux' }).settings.tools.approvalMode).toBe(
      'auto-edit',
    );
    fs.mkdirSync(path.join(cwd, '.maestro'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.maestro', 'settings.json'),
      JSON.stringify({ tools: { approvalMode: 'auto' } }),
    );
    expect(loadSettings({ cwd, env: env(), platform: 'linux' }).settings.tools.approvalMode).toBe(
      'auto',
    );
    expect(
      loadSettings({ cwd, env: env(), platform: 'linux', overrides: { approvalMode: 'yolo' } })
        .settings.tools.approvalMode,
    ).toBe('yolo');
    writeGlobal({});
    fs.rmSync(path.join(cwd, '.maestro'), { recursive: true, force: true });
    expect(loadSettings({ cwd, env: env(), platform: 'linux' }).settings.tools.approvalMode).toBe(
      'default',
    );
  });

  it('reports claude credential source from config, env, profile or none', () => {
    writeGlobal({ providers: { claude: { apiKey: 'cfg-key-1234' } } });
    expect(loadSettings({ cwd, env: env(), platform: 'linux' }).credentialSources.claude).toBe(
      'config',
    );

    writeGlobal({});
    expect(
      loadSettings({ cwd, env: env({ ANTHROPIC_API_KEY: 'x' }), platform: 'linux' })
        .credentialSources.claude,
    ).toBe('env');
    expect(
      loadSettings({ cwd, env: env({ ANTHROPIC_AUTH_TOKEN: 'x' }), platform: 'linux' })
        .credentialSources.claude,
    ).toBe('env');

    const profileDir = path.join(home, 'anthropic-cfg', 'credentials');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'default.json'), '{}');
    expect(
      loadSettings({
        cwd,
        env: env({ ANTHROPIC_CONFIG_DIR: path.join(home, 'anthropic-cfg') }),
        platform: 'linux',
      }).credentialSources.claude,
    ).toBe('profile');

    expect(loadSettings({ cwd, env: env(), platform: 'linux' }).credentialSources.claude).toBe(
      'none',
    );
  });

  it('reports invalid JSON with line and column', () => {
    const p = writeGlobal('{\n  "activeProvider": "claude",\n  "providers": {,}\n}');
    expect(() => loadSettings({ cwd, env: env(), platform: 'linux' })).toThrowError(ConfigError);
    try {
      loadSettings({ cwd, env: env(), platform: 'linux' });
    } catch (err) {
      const e = err as ConfigError;
      expect(e.message).toContain(p);
      expect(e.issues[0]).toMatch(/invalid JSON at line 3, column \d+/);
    }
  });

  it('reports schema problems as field: reason and refuses to start', () => {
    writeGlobal({
      activeProvider: 'gemini',
      providers: {
        qwen: { apiKeyy: 'x', baseUrl: 'dashscope.aliyuncs.com/compatible-mode/v1', maxTokens: 0 },
      },
    });
    try {
      loadSettings({ cwd, env: env(), platform: 'linux' });
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as ConfigError;
      expect(e).toBeInstanceOf(ConfigError);
      expect(e.issues).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^activeProvider: /),
          'providers.qwen.apiKeyy: unknown key',
          'providers.qwen.baseUrl: must start with http:// or https://',
          expect.stringMatching(/^providers\.qwen\.maxTokens: /),
        ]),
      );
    }
  });

  it('normalizes trailing slashes in baseUrl and empty apiKey to undefined', () => {
    writeGlobal({ providers: { qwen: { baseUrl: 'https://x.example/v1///', apiKey: '' } } });
    const { settings } = loadSettings({ cwd, env: env(), platform: 'linux' });
    expect(settings.providers.qwen.baseUrl).toBe('https://x.example/v1');
    expect(settings.providers.qwen.apiKey).toBeUndefined();
  });

  it('honours an explicit configPath', () => {
    const custom = path.join(home, 'custom.json');
    const loaded = loadSettings({ cwd, env: env(), platform: 'linux', configPath: custom });
    expect(loaded.globalPath).toBe(custom);
    expect(fs.existsSync(custom)).toBe(true);
  });
});

describe('mergeSettings', () => {
  it('merges providers one level deep and replaces other keys', () => {
    const merged = mergeSettings(
      {
        activeProvider: 'claude',
        providers: { claude: { model: 'a' }, qwen: { model: 'b' } },
        tools: { enabled: true },
      },
      { providers: { qwen: { model: 'c' } }, tools: { enabled: false } },
    );
    expect(merged).toEqual({
      activeProvider: 'claude',
      providers: { claude: { model: 'a' }, qwen: { model: 'c' } },
      tools: { enabled: false },
    });
  });
});
