import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The only external program the Spec Kit steps use; always via execFile, never a shell. */
export interface GitPort {
  available(): boolean;
  /** True when `root` is inside a git work tree. */
  hasGit(root: string): boolean;
  toplevel(cwd: string): string | undefined;
  currentBranch(root: string): string | undefined;
  /** Local and remote branch names (remote prefix stripped, HEAD pointers dropped). */
  branches(root: string): string[];
  branchExists(root: string, name: string): boolean;
  checkoutNew(root: string, name: string): void;
  checkoutExisting(root: string, name: string): void;
  isDirty(root: string): boolean;
  remoteUrl(root: string): string | undefined;
}

function run(root: string | undefined, args: string[]): string {
  return execFileSync('git', root ? ['-C', root, ...args] : args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function tryRun(root: string | undefined, args: string[]): string | undefined {
  try {
    return run(root, args);
  } catch {
    return undefined;
  }
}

export const systemGit: GitPort = {
  available: () => tryRun(undefined, ['--version']) !== undefined,
  // `.git` (directory, or file for worktrees/submodules) is the marker; no process spawn needed.
  hasGit: (root) => fs.existsSync(path.join(root, '.git')),
  toplevel: (cwd) => tryRun(cwd, ['rev-parse', '--show-toplevel']),
  currentBranch: (root) => tryRun(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
  branches: (root) => {
    const out = tryRun(root, ['branch', '-a', '--format=%(refname:short)']) ?? '';
    const names = new Set<string>();
    for (const line of out.split('\n')) {
      const name = line.trim().replace(/^remotes\//, '');
      if (!name || name.endsWith('/HEAD') || name === 'HEAD') continue;
      names.add(name);
      if (name.includes('/')) names.add(name.slice(name.lastIndexOf('/') + 1)); // origin/005-x → 005-x
    }
    return [...names];
  },
  branchExists: (root, name) =>
    tryRun(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) !== undefined,
  checkoutNew: (root, name) => {
    run(root, ['checkout', '-q', '-b', name]);
  },
  checkoutExisting: (root, name) => {
    run(root, ['checkout', '-q', name]);
  },
  isDirty: (root) => (tryRun(root, ['status', '--porcelain']) ?? '') !== '',
  remoteUrl: (root) => tryRun(root, ['config', '--get', 'remote.origin.url']),
};

/** For tests and for machines without git: nothing is a repository. */
export const nullGit: GitPort = {
  available: () => false,
  hasGit: () => false,
  toplevel: () => undefined,
  currentBranch: () => undefined,
  branches: () => [],
  branchExists: () => false,
  checkoutNew: () => {
    throw new Error('git is not available');
  },
  checkoutExisting: () => {
    throw new Error('git is not available');
  },
  isDirty: () => false,
  remoteUrl: () => undefined,
};
