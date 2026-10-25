import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPatch,
  projectOverrides,
  readRawSettings,
  writeSettings,
} from '../../../src/config/writer.js';
import { loadSettings } from '../../../src/config/loader.js';
import { MaestroError } from '../../../src/utils/errors.js';
import { withTempHome } from '../../helpers/tempHome.js';
import type { TempHome } from '../../helpers/tempHome.js';

let home: TempHome;
beforeEach(() => {
  home = withTempHome({
    _comment: 'top',
    activeProvider: 'claude',
    providers: {
      claude: { _comment: 'c', enabled: true, model: 'claude-opus-5-5' },
      qwen: { _comment: 'q', enabled: false, apiKey: '' },
    },
    tools: { enabled: true },
  });
});
afterEach(() => home.cleanup());

describe('applyPatch', () => {
  it('creates intermediate objects, normalizes values and removes undefined', () => {
    const out = applyPatch({}, [
      { path: 'providers.qwen.apiKey', value: ' sk-\nabc 123 ' },
      { path: 'providers.qwen.baseUrl', value: 'https://x.example/v1///' },
      { path: 'providers.qwen.model', value: '  qwen-max ' },
      { path: 'providers.qwen.enabled', value: true },
      { path: 'activeProvider', value: 'qwen' },
      { path: 'providers.claude.baseUrl', value: undefined },
    ]);
    expect(out).toEqual({
      providers: {
        qwen: {
          apiKey: 'sk-abc123',
          baseUrl: 'https://x.example/v1',
          model: 'qwen-max',
          enabled: true,
        },
      },
      activeProvider: 'qwen',
    });
  });
  it('explicit segments keep a dotted key whole (route names, specs/008)', () => {
    const out = applyPatch({ routes: { _comment: 'c' } }, [
      {
        path: 'routes.speckit.plan',
        segments: ['routes', 'speckit.plan'],
        value: { provider: 'qwen', model: 'q' },
      },
    ]);
    expect(out).toEqual({
      routes: { _comment: 'c', 'speckit.plan': { provider: 'qwen', model: 'q' } },
    });
    const removed = applyPatch(out, [
      { path: 'routes.speckit.plan', segments: ['routes', 'speckit.plan'], value: undefined },
    ]);
    expect(removed).toEqual({ routes: { _comment: 'c' } });
  });

  it('removes keys set to empty strings and does not mutate the input', () => {
    const raw = { providers: { qwen: { apiKey: 'old' } } };
    const out = applyPatch(raw, [{ path: 'providers.qwen.apiKey', value: '' }]);
    expect(out).toEqual({ providers: { qwen: {} } });
    expect(raw.providers.qwen.apiKey).toBe('old');
  });
});

describe('writeSettings', () => {
  it('preserves _comment everywhere and untouched keys; the result reloads cleanly', () => {
    const r = writeSettings(
      [
        { path: 'providers.qwen.enabled', value: true },
        { path: 'providers.qwen.apiKey', value: 'sk-test-9999' },
        { path: 'providers.qwen.model', value: 'qwen3-coder-plus' },
      ],
      { globalPath: home.globalPath },
    );
    expect(r.path).toBe(home.globalPath);
    const json = home.readSettings() as Record<string, Record<string, Record<string, unknown>>>;
    expect(json['_comment']).toBe('top');
    expect(json['providers']!['claude']!['_comment']).toBe('c');
    expect(json['providers']!['qwen']).toMatchObject({
      _comment: 'q',
      enabled: true,
      apiKey: 'sk-test-9999',
    });
    expect(json['tools']).toEqual({ enabled: true });
    const loaded = loadSettings({ cwd: home.home, env: home.env, platform: 'linux' });
    expect(loaded.settings.providers.qwen.enabled).toBe(true);
    expect(loaded.settings.providers.qwen.apiKey).toBe('sk-test-9999');
    expect(fs.readFileSync(home.globalPath, 'utf8').endsWith('}\n')).toBe(true);
  });

  it('starts from the first-run template when the file does not exist', () => {
    const p = path.join(home.home, 'fresh', 'settings.json');
    writeSettings([{ path: 'activeProvider', value: 'qwen' }], { globalPath: p });
    const json = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    expect(json['activeProvider']).toBe('qwen');
    expect(json['providers']).toBeDefined();
  });

  it('refuses to write an invalid result and leaves the file untouched', () => {
    const before = fs.readFileSync(home.globalPath, 'utf8');
    expect(() =>
      writeSettings([{ path: 'providers.qwen.baseUrl', value: 'dashscope.aliyuncs.com/v1' }], {
        globalPath: home.globalPath,
      }),
    ).toThrow(MaestroError);
    try {
      writeSettings([{ path: 'activeProvider', value: 'gemini' }], { globalPath: home.globalPath });
    } catch (err) {
      expect((err as MaestroError).category).toBe('invalid_config');
      expect((err as MaestroError).message).toMatch(/^activeProvider: /);
    }
    expect(fs.readFileSync(home.globalPath, 'utf8')).toBe(before);
    expect(fs.existsSync(home.globalPath + '.tmp')).toBe(false);
  });

  it('keeps the original file when the atomic rename fails', () => {
    const before = fs.readFileSync(home.globalPath, 'utf8');
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      const e = new Error('EACCES') as NodeJS.ErrnoException;
      e.code = 'EACCES';
      throw e;
    });
    try {
      expect(() =>
        writeSettings([{ path: 'activeProvider', value: 'qwen' }], { globalPath: home.globalPath }),
      ).toThrow(/could not write .*EACCES/);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(home.globalPath, 'utf8')).toBe(before);
    expect(fs.existsSync(home.globalPath + '.tmp')).toBe(false);
  });

  it('reports keys overridden by the project settings file without touching it', () => {
    const cwd = path.join(home.home, 'proj');
    fs.mkdirSync(path.join(cwd, '.maestro'), { recursive: true });
    const projectFile = path.join(cwd, '.maestro', 'settings.json');
    fs.writeFileSync(projectFile, JSON.stringify({ providers: { qwen: { apiKey: 'proj' } } }));
    const r = writeSettings(
      [
        { path: 'providers.qwen.apiKey', value: 'sk-global-1234' },
        { path: 'providers.qwen.model', value: 'm' },
      ],
      { globalPath: home.globalPath, cwd },
    );
    expect(r.overriddenByProject).toEqual(['providers.qwen.apiKey']);
    expect(JSON.parse(fs.readFileSync(projectFile, 'utf8'))).toEqual({
      providers: { qwen: { apiKey: 'proj' } },
    });
    expect(projectOverrides(['activeProvider'], cwd)).toEqual([]);
  });

  it('readRawSettings rejects non-object JSON', () => {
    fs.writeFileSync(home.globalPath, '[1,2]');
    expect(() => readRawSettings(home.globalPath)).toThrow(MaestroError);
  });
});
