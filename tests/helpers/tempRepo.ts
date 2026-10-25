import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TempRepoOptions {
  /** `git init` + initial commit (default true). */
  git?: boolean;
  /** Spec Kit layout to pre-install: none, the 0.4.x shape of this repo, or the 1.x shape. */
  specify?: 'none' | '0.4' | '1.x';
  /** Copy this repository's `.claude/commands/speckit.*.md` into the given directory. */
  commandsDir?: string;
}

export interface TempRepo {
  root: string;
  cleanup(): void;
  write(rel: string, text: string): void;
  read(rel: string): string;
  exists(rel: string): boolean;
  /** Current git branch (undefined without git). */
  branch(): string | undefined;
  git(...args: string[]): string;
}

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const ASSETS = path.join(REPO_ROOT, 'assets', 'speckit');

function copyDir(from: string, to: string, filter?: (name: string) => boolean): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst, filter);
    else if (!filter || filter(entry.name)) fs.copyFileSync(src, dst);
  }
}

/** A throw-away project directory, optionally a git repository with a Spec Kit layout. */
export function withTempRepo(opts: TempRepoOptions = {}): TempRepo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-repo-'));
  const useGit = opts.git ?? true;
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  if (useGit) {
    // Three spawns instead of six: identity and signing via -c (the suite runs many repos in parallel).
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, 'README.md'), '# temp\n');
    git('add', '.');
    git(
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=Maestro Tests',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'init',
    );
    // later commits/checkouts in tests need an identity too
    fs.appendFileSync(
      path.join(root, '.git', 'config'),
      '[user]\n\temail = test@example.com\n\tname = Maestro Tests\n[commit]\n\tgpgsign = false\n',
    );
  }

  const specify = opts.specify ?? 'none';
  if (specify !== 'none') {
    const templates = path.join(root, '.specify', 'templates');
    copyDir(path.join(ASSETS, 'templates'), templates, (n) => n.endsWith('.md'));
    fs.rmSync(path.join(templates, 'commands'), { recursive: true, force: true });
    fs.mkdirSync(path.join(root, '.specify', 'memory'), { recursive: true });
    fs.copyFileSync(
      path.join(ASSETS, 'templates', 'constitution-template.md'),
      path.join(root, '.specify', 'memory', 'constitution.md'),
    );
    if (specify === '0.4') {
      fs.writeFileSync(
        path.join(root, '.specify', 'init-options.json'),
        JSON.stringify({ ai: 'claude', branch_numbering: 'sequential', script: 'ps' }, null, 2),
      );
      fs.writeFileSync(
        path.join(root, '.specify', 'integration.json'),
        JSON.stringify({ integration: 'claude', version: '0.4.5.dev0' }, null, 2),
      );
    } else {
      fs.writeFileSync(
        path.join(root, '.specify', 'init-options.json'),
        JSON.stringify(
          { feature_numbering: 'sequential', integration: 'claude', script: 'sh' },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(root, '.specify', 'integration.json'),
        JSON.stringify(
          {
            default_integration: 'claude',
            integration_settings: { claude: { invoke_separator: '.' } },
          },
          null,
          2,
        ),
      );
    }
  }

  if (opts.commandsDir) {
    const dst = path.join(root, opts.commandsDir);
    copyDir(path.join(REPO_ROOT, '.claude', 'commands'), dst, (n) => n.startsWith('speckit.'));
  }

  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    write: (rel, text) => {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text, 'utf8');
    },
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    branch: () => (useGit ? git('rev-parse', '--abbrev-ref', 'HEAD') : undefined),
    git,
  };
}
