import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyPath,
  readAttachment,
  rejectionMessage,
  relativeInside,
  resolvePastedPath,
  splitPastedPaths,
} from '../../../src/ui/attachments.js';
import type { AttachLimits, PathClass } from '../../../src/ui/attachments.js';

const limits: AttachLimits = {
  attachMaxBytes: 512 * 1024,
  attachMaxTotalBytes: 2 * 1024 * 1024,
  imageMaxBytes: 5 * 1024 * 1024,
};

let cwd: string;
let outside: string;
beforeEach(() => {
  cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-att-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-out-')));
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, 'a b'));
  fs.writeFileSync(path.join(cwd, 'x.log'), 'l1\nl2\nl3\n');
  fs.writeFileSync(path.join(cwd, 'src', 'y.ts'), 'export const y = 1;');
  fs.writeFileSync(path.join(cwd, 'a b', 'z.md'), '# z\n');
  fs.writeFileSync(path.join(cwd, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
  fs.writeFileSync(path.join(cwd, 'big.log'), 'x'.repeat(limits.attachMaxBytes + 1));
  fs.writeFileSync(path.join(cwd, 'i.png'), Buffer.alloc(120 * 1024, 7));
  fs.writeFileSync(path.join(cwd, 'huge.jpg'), Buffer.alloc(limits.imageMaxBytes + 1, 7));
  fs.writeFileSync(path.join(outside, 'o.txt'), 'outside');
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('splitPastedPaths (contracts/attachments.md § 1)', () => {
  it('splits by line breaks and spaces, honouring single and double quotes', () => {
    expect(splitPastedPaths('"C:\\a b\\x.log" \'y.ts\'\nsrc/z.ts  w.md')).toEqual([
      'C:\\a b\\x.log',
      'y.ts',
      'src/z.ts',
      'w.md',
    ]);
    expect(splitPastedPaths('one\r\ntwo\tthree')).toEqual(['one', 'two', 'three']);
    expect(splitPastedPaths('   ')).toEqual([]);
  });
});

describe('resolvePastedPath', () => {
  it('accepts absolute, relative, quoted, ~ and file:// tokens that name existing files', () => {
    const env = { HOME: cwd, USERPROFILE: cwd };
    expect(resolvePastedPath(path.join(cwd, 'x.log'), cwd, env)).toBe(path.join(cwd, 'x.log'));
    expect(resolvePastedPath('src/y.ts', cwd, env)).toBe(path.join(cwd, 'src', 'y.ts'));
    expect(resolvePastedPath('./src/y.ts', cwd, env)).toBe(path.join(cwd, 'src', 'y.ts'));
    expect(resolvePastedPath('~/x.log', cwd, env)).toBe(path.join(cwd, 'x.log'));
    expect(resolvePastedPath(pathToFileURL(path.join(cwd, 'a b', 'z.md')).href, cwd, env)).toBe(
      path.join(cwd, 'a b', 'z.md'),
    );
  });

  it('ignores directories, missing paths and ordinary words', () => {
    expect(resolvePastedPath('src', cwd)).toBeUndefined();
    expect(resolvePastedPath('nope.txt', cwd)).toBeUndefined();
    expect(resolvePastedPath('explique:', cwd)).toBeUndefined();
    expect(resolvePastedPath('', cwd)).toBeUndefined();
  });
});

describe('classifyPath (contracts/attachments.md § 2)', () => {
  const cls = (rel: string, imagesOk = true): PathClass =>
    classifyPath(path.join(cwd, rel), cwd, limits, imagesOk);

  it('text files carry rel path (with /), size and line count', () => {
    expect(cls('src/y.ts')).toMatchObject({
      kind: 'text',
      rel: 'src/y.ts',
      name: 'y.ts',
      lines: 1,
    });
    expect(cls('x.log')).toMatchObject({ kind: 'text', rel: 'x.log', bytes: 9, lines: 3 });
  });

  it('images depend on the provider capability and the image limit', () => {
    expect(cls('i.png')).toMatchObject({ kind: 'image', mediaType: 'image/png', bytes: 122880 });
    expect(cls('i.png', false)).toMatchObject({ kind: 'rejected', reason: 'images-unsupported' });
    expect(cls('huge.jpg')).toMatchObject({ kind: 'rejected', reason: 'image-too-large' });
  });

  it('binary, too large and outside the working directory are refused', () => {
    expect(cls('bin.dat')).toMatchObject({ kind: 'rejected', reason: 'binary' });
    expect(cls('big.log')).toMatchObject({ kind: 'rejected', reason: 'too-large' });
    expect(classifyPath(path.join(outside, 'o.txt'), cwd, limits, true)).toMatchObject({
      kind: 'rejected',
      reason: 'outside',
    });
    expect(relativeInside(cwd, path.join(cwd, 'a b', 'z.md'))).toBe('a b/z.md');
    expect(relativeInside(cwd, path.join(outside, 'o.txt'))).toBeUndefined();
  });

  it('rejectionMessage uses the exact wording of the contract', () => {
    const rej = (
      reason: Extract<PathClass, { kind: 'rejected' }>['reason'],
      name: string,
      bytes: number,
    ) =>
      rejectionMessage(
        { kind: 'rejected', abs: name, rel: name, name, bytes, reason },
        limits,
        'qwen',
      );
    expect(rej('images-unsupported', 'x.png', 1)).toBe(
      'O provedor qwen não aceita imagens; o caminho entrou como texto.',
    );
    expect(rej('image-too-large', 'x.png', 6.1 * 1024 * 1024)).toBe(
      'Imagem x.png (6.1 MB) acima do limite (5 MB).',
    );
    expect(rej('binary', 'nome.bin', 3)).toBe(
      'nome.bin parece binário; o caminho entrou como texto.',
    );
    expect(rej('too-large', 'nome.log', 700 * 1024)).toBe(
      'nome.log (700 KB) acima do limite (512 KB); use read_file ou aumente ui.attachMaxBytes.',
    );
    expect(rej('outside', 'nome.ext', 1)).toBe(
      'nome.ext está fora da pasta de trabalho; o caminho entrou como texto.',
    );
  });

  it('readAttachment reads at send time and reports a missing file', () => {
    expect(readAttachment(path.join(cwd, 'x.log'))).toEqual({ text: 'l1\nl2\nl3\n', lines: 3 });
    expect(readAttachment(path.join(cwd, 'gone.log'))).toBeUndefined();
  });
});
