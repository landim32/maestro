import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findExecutable } from '../../../src/utils/process.js';

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
