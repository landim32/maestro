import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findExecutable,
  locateClaudeCode,
  locateCodex,
  spawnSpec,
} from '../../../src/utils/process.js';

let dir: string;
let extra: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-path-'));
  extra = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-extra-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(extra, { recursive: true, force: true });
});

describe('findExecutable', () => {
  it('finds a binary in a PATH directory (Windows honours PATHEXT)', () => {
    fs.writeFileSync(path.join(dir, 'ant.exe'), '');
    const env = { PATH: dir, PATHEXT: '.COM;.EXE;.BAT' };
    expect(findExecutable('ant', { env, platform: 'win32' })).toBe(path.join(dir, 'ant.exe'));
    expect(findExecutable('ant', { env, platform: 'linux' })).toBeUndefined(); // no extension on linux
  });

  it('finds an extension-less binary on linux', () => {
    fs.writeFileSync(path.join(dir, 'ant'), '');
    expect(findExecutable('ant', { env: { PATH: dir }, platform: 'linux' })).toBe(
      path.join(dir, 'ant'),
    );
  });

  it('falls back to extraDirs and returns undefined when absent', () => {
    fs.writeFileSync(path.join(extra, 'ant.exe'), '');
    const env = { PATH: dir, PATHEXT: '.EXE' };
    expect(findExecutable('ant', { env, platform: 'win32' })).toBeUndefined();
    expect(findExecutable('ant', { env, platform: 'win32', extraDirs: [extra] })).toBe(
      path.join(extra, 'ant.exe'),
    );
  });

  it('ignores directories (not files) with the same name', () => {
    fs.mkdirSync(path.join(dir, 'ant'));
    expect(findExecutable('ant', { env: { PATH: dir }, platform: 'linux' })).toBeUndefined();
  });
});

describe('locateCodex (specs/012 research R7)', () => {
  it('on Windows skips the npm POSIX shim and picks codex.exe, else codex.cmd', () => {
    fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh');
    fs.writeFileSync(path.join(dir, 'codex.cmd'), '@echo off');
    const env = { PATH: dir, PATHEXT: '.EXE;.CMD' };
    expect(locateCodex(undefined, { env, platform: 'win32' })).toBe(path.join(dir, 'codex.cmd'));
    fs.writeFileSync(path.join(dir, 'codex.exe'), '');
    expect(locateCodex(undefined, { env, platform: 'win32' })).toBe(path.join(dir, 'codex.exe'));
    expect(locateCodex(undefined, { env: { PATH: dir }, platform: 'linux' })).toBe(
      path.join(dir, 'codex'),
    );
  });

  it('an explicit command path must exist', () => {
    const exe = path.join(dir, 'my-codex');
    fs.writeFileSync(exe, '');
    expect(locateCodex(exe, { env: { PATH: '' }, platform: 'linux' })).toBe(exe);
    expect(
      locateCodex(path.join(dir, 'nope'), { env: { PATH: '' }, platform: 'linux' }),
    ).toBeUndefined();
  });

  it('spawnSpec runs .cmd shims through the shell, quoting every argument', () => {
    expect(spawnSpec('C:/npm/codex.cmd', ['exec', 'a b'], 'win32')).toEqual({
      file: '"C:/npm/codex.cmd"',
      args: ['"exec"', '"a b"'],
      shell: true,
    });
    expect(spawnSpec('/usr/bin/codex', ['exec'], 'linux')).toEqual({
      file: '/usr/bin/codex',
      args: ['exec'],
      shell: false,
    });
  });
});
