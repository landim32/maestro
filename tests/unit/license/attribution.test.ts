import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** specs/005 contracts/attribution.md § 8 — licence and attribution invariants of the repository. */
const root = path.resolve(import.meta.dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const notices = read('THIRD_PARTY_NOTICES.md');

/** Rows of the "Files in Maestro" table: | `src/...` | ... | (cells may be padded by Prettier). */
function attributedFiles(): string[] {
  const files = new Set<string>();
  for (const m of notices.matchAll(/^\| `(src\/[^`]+)`\s*\|/gm)) files.add(m[1]!);
  return [...files];
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe('third-party attribution', () => {
  it('THIRD_PARTY_NOTICES.md names qwen-code and gemini-cli and reproduces the Apache License 2.0', () => {
    expect(notices).toContain('qwen-code');
    expect(notices).toContain('https://github.com/QwenLM/qwen-code');
    expect(notices).toContain('gemini-cli');
    expect(notices).toMatch(/Copyright 2025 Qwen/);
    expect(notices).toMatch(/Copyright 2025 Google LLC/);
    expect(notices).toContain('Apache License');
    expect(notices).toContain('Version 2.0, January 2004');
    expect(notices).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION');
  });

  it('every file listed in the notices starts with the attribution header', () => {
    const files = attributedFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      expect(fs.existsSync(path.join(root, file)), `${file} exists`).toBe(true);
      const head = read(file).split('\n').slice(0, 12).join('\n');
      expect(head, `${file} header`).toContain('@license');
      expect(head, `${file} header`).toContain('qwen-code');
      expect(head, `${file} header`).toMatch(/Copyright 2025 Qwen Team/);
      expect(head, `${file} header`).toContain('SPDX-License-Identifier: Apache-2.0');
      expect(head, `${file} header`).toContain('THIRD_PARTY_NOTICES.md');
    }
  });

  it('no source file carries an Apache-2.0 header without being listed in the notices', () => {
    const listed = new Set(attributedFiles());
    const stray = sourceFiles('src').filter(
      (f) => !listed.has(f) && read(f).includes('SPDX-License-Identifier: Apache-2.0'),
    );
    expect(stray).toEqual([]);
  });
});

describe('open-source commitment', () => {
  it('package.json declares MIT, is not private and ships LICENSE + THIRD_PARTY_NOTICES.md', () => {
    const pkg = JSON.parse(read('package.json')) as {
      license?: string;
      private?: boolean;
      files?: string[];
    };
    expect(pkg.license).toBe('MIT');
    expect(pkg.private).not.toBe(true);
    expect(pkg.files).toContain('LICENSE');
    expect(pkg.files).toContain('THIRD_PARTY_NOTICES.md');
  });

  it('LICENSE is MIT and points to the third-party notices; README states the commitment and credits', () => {
    const license = read('LICENSE');
    expect(license).toContain('MIT License');
    expect(license).toContain('THIRD_PARTY_NOTICES.md');
    const readme = read('README.md');
    expect(readme).toMatch(/open-source/i);
    expect(readme).toContain('qwen-code');
    expect(readme).toContain('## Licença');
    expect(readme).toContain('## Créditos');
  });

  it('the constitution records the open-source and attribution principles', () => {
    const constitution = read('.specify/memory/constitution.md');
    expect(constitution).toContain('Open-source permanente');
    expect(constitution).toContain('Atribuição de terceiros');
    expect(constitution).not.toContain('[PROJECT_NAME]');
  });
});
