import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess, spawn as NodeSpawn } from 'node:child_process';
import type * as ProcessModule from '../../../src/utils/process.js';
import {
  createAntCli,
  defaultAntDirs,
  envShadowWarning,
  LOGIN_ARGS,
  STATUS_ARGS,
} from '../../../src/setup/antCli.js';

vi.mock('../../../src/utils/process.js', async (importOriginal) => {
  const mod = await importOriginal<typeof ProcessModule>();
  return { ...mod, killTree: vi.fn() };
});
import { killTree } from '../../../src/utils/process.js';

/** Minimal fake ChildProcess: emits scripted output then closes with a code. */
function fakeChild(script: {
  stdout?: string[];
  stderr?: string[];
  code?: number;
  hang?: boolean;
}) {
  const child = new EventEmitter() as unknown as ChildProcess & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    exitCode: number | null;
  };
  (child as { stdout: EventEmitter }).stdout = new EventEmitter();
  (child as { stderr: EventEmitter }).stderr = new EventEmitter();
  (child as { pid: number }).pid = 4242;
  (child as { exitCode: number | null }).exitCode = null;
  setTimeout(() => {
    for (const l of script.stdout ?? []) child.stdout.emit('data', Buffer.from(l));
    for (const l of script.stderr ?? []) child.stderr.emit('data', Buffer.from(l));
    if (!script.hang) {
      (child as { exitCode: number | null }).exitCode = script.code ?? 0;
      child.emit('close', script.code ?? 0);
    }
  }, 5);
  return child;
}

let calls: Array<{ file: string; args: readonly string[]; opts: Record<string, unknown> }>;
let scripts: Array<Parameters<typeof fakeChild>[0]>;
const spawn = ((file: string, args: readonly string[], opts: Record<string, unknown>) => {
  calls.push({ file, args, opts });
  return fakeChild(scripts.shift() ?? {});
}) as unknown as typeof NodeSpawn;

beforeEach(() => {
  calls = [];
  scripts = [];
  vi.mocked(killTree).mockClear();
});

describe('antCli.locate', () => {
  let dir: string;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-loc-'))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('finds ant on PATH, then in the default Windows dir, else undefined', () => {
    fs.writeFileSync(path.join(dir, 'ant.exe'), '');
    const onPath = createAntCli({
      spawn,
      env: { PATH: dir, PATHEXT: '.EXE' },
      platform: 'win32',
    }).locate();
    expect(onPath).toEqual({ path: path.join(dir, 'ant.exe'), source: 'PATH' });

    const local = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-local-'));
    fs.mkdirSync(path.join(local, 'Programs', 'ant'), { recursive: true });
    fs.writeFileSync(path.join(local, 'Programs', 'ant', 'ant.exe'), '');
    const env = { PATH: path.join(dir, 'nowhere'), PATHEXT: '.EXE', LOCALAPPDATA: local };
    expect(defaultAntDirs(env, 'win32')).toEqual([path.join(local, 'Programs', 'ant')]);
    expect(createAntCli({ spawn, env, platform: 'win32' }).locate()).toEqual({
      path: path.join(local, 'Programs', 'ant', 'ant.exe'),
      source: 'default-dir',
    });
    fs.rmSync(local, { recursive: true, force: true });

    expect(
      createAntCli({ spawn, env: { PATH: path.join(dir, 'nowhere') }, platform: 'linux' }).locate(),
    ).toBeUndefined();
  });
});

describe('antCli.runLogin', () => {
  it('spawns `ant auth login --timeout 5m` without stdin, reports URLs and succeeds on exit 0', async () => {
    scripts.push({
      stdout: [
        'Opening browser…\n',
        'If it does not open, visit https://platform.claude.com/oauth?x=1\n',
        'Login complete\n',
      ],
    });
    const urls: string[] = [];
    const run = createAntCli({ spawn, env: {}, platform: 'linux' }).runLogin('/bin/ant', {
      onOutput: (_t, url) => url && urls.push(url),
    });
    const result = await run.promise;
    expect(calls[0]?.file).toBe('/bin/ant');
    expect(calls[0]?.args).toEqual([...LOGIN_ARGS]);
    expect(calls[0]?.opts['stdio']).toEqual(['ignore', 'pipe', 'pipe']);
    expect(urls).toEqual(['https://platform.claude.com/oauth?x=1']);
    expect(result).toEqual({ ok: true, summary: 'Login complete' });
  });
  it('reports the last non-empty line as the reason on a non-zero exit', async () => {
    scripts.push({ stderr: ['error: callback timed out\n\n'], code: 1 });
    const result = await createAntCli({ spawn, env: {}, platform: 'linux' }).runLogin(
      '/bin/ant',
      {},
    ).promise;
    expect(result).toEqual({ ok: false, reason: 'error: callback timed out' });
  });
  it('cancel kills the tree and resolves as cancelled', async () => {
    scripts.push({ hang: true });
    const run = createAntCli({ spawn, env: {}, platform: 'linux' }).runLogin('/bin/ant', {});
    await new Promise((r) => setTimeout(r, 10));
    run.cancel();
    expect(killTree).toHaveBeenCalledTimes(1);
    // simulate the process closing after the kill
    const child = vi.mocked(killTree).mock.calls[0]![0] as unknown as EventEmitter;
    child.emit('close', null);
    expect(await run.promise).toEqual({ ok: false, reason: 'cancelado', cancelled: true });
  });
});

describe('antCli.readStatus', () => {
  it('detects a logged-in profile from the status text', async () => {
    scripts.push({
      stdout: ['Active profile: default\n', 'Credentials\n  Logged in to Rodrigo Org as r@x.com\n'],
    });
    const st = await createAntCli({ spawn, env: {}, platform: 'linux' }).readStatus('/bin/ant');
    expect(calls[0]?.args).toEqual([...STATUS_ARGS]);
    expect(st).toEqual({ loggedIn: true, summary: 'Logged in to Rodrigo Org as r@x.com' });
  });
  it('reports not logged in otherwise', async () => {
    scripts.push({
      stdout: [
        'Credentials\n  (profile "default" not configured — run `ant auth login` to set it up)\n',
      ],
    });
    const st = await createAntCli({ spawn, env: {}, platform: 'linux' }).readStatus('/bin/ant');
    expect(st.loggedIn).toBe(false);
    expect(st.summary).toContain('not configured');
  });
});

describe('envShadowWarning', () => {
  it('warns about ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN', () => {
    expect(envShadowWarning({})).toBeUndefined();
    expect(envShadowWarning({ ANTHROPIC_API_KEY: 'x' })).toMatch(/ANTHROPIC_API_KEY/);
    expect(envShadowWarning({ ANTHROPIC_AUTH_TOKEN: 'x' })).toMatch(/ANTHROPIC_AUTH_TOKEN/);
  });
});
