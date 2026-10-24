import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveInsideCwd, SandboxError, truncate } from '../../../src/tools/sandbox.js';

let root: string;
let outside: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-sbx-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-out-')));
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'a');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('resolveInsideCwd', () => {
  it('accepts relative paths inside the workspace, including the root itself', () => {
    expect(resolveInsideCwd(root, 'sub/a.txt')).toBe(path.join(root, 'sub', 'a.txt'));
    expect(resolveInsideCwd(root, '.')).toBe(root);
    expect(resolveInsideCwd(root, 'sub/../sub/a.txt')).toBe(path.join(root, 'sub', 'a.txt'));
    expect(resolveInsideCwd(root, 'new/dir/file.txt')).toBe(
      path.join(root, 'new', 'dir', 'file.txt'),
    );
  });

  it('accepts absolute paths that are inside the workspace', () => {
    expect(resolveInsideCwd(root, path.join(root, 'sub'))).toBe(path.join(root, 'sub'));
  });

  it('rejects parent traversal and absolute paths outside', () => {
    expect(() => resolveInsideCwd(root, '../x')).toThrow(SandboxError);
    expect(() => resolveInsideCwd(root, 'sub/../../x')).toThrow(SandboxError);
    expect(() => resolveInsideCwd(root, outside)).toThrow(SandboxError);
    expect(() => resolveInsideCwd(root, path.join(outside, 'secret.txt'))).toThrow(
      /outside workspace/,
    );
  });

  it('rejects empty or invalid paths', () => {
    expect(() => resolveInsideCwd(root, '')).toThrow(SandboxError);
    expect(() => resolveInsideCwd(root, 'a\0b')).toThrow(SandboxError);
  });

  it('rejects a path that escapes through a symlink', () => {
    const link = path.join(root, 'escape');
    try {
      fs.symlinkSync(outside, link, 'junction');
    } catch {
      return; // symlinks not permitted on this system — skip
    }
    expect(() => resolveInsideCwd(root, 'escape/secret.txt')).toThrow(/symlink/);
    expect(() => resolveInsideCwd(root, 'escape/new.txt')).toThrow(/symlink/);
  });

  it('does not reject a sibling directory whose name merely starts with the root name', () => {
    const sibling = root + '-sibling';
    fs.mkdirSync(sibling);
    try {
      expect(() => resolveInsideCwd(root, sibling)).toThrow(SandboxError);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });
});

describe('truncate', () => {
  it('returns short text unchanged and marks omitted characters otherwise', () => {
    expect(truncate('abc', 10)).toBe('abc');
    expect(truncate('abcdefghij', 4)).toBe('abcd\n… [truncated 6 characters]');
  });
});
