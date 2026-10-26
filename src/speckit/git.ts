import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

/**
 * Commit-side operations used by the autopilot (specs/011 research R8). Kept apart from `GitPort`
 * so the Spec Kit steps (and their test doubles) stay read/branch-only.
 */
export interface GitCommitPort {
  headSha(root: string): string | undefined;
  /** Stages every change (git add -A). */
  addAll(root: string): void;
  /** True when something is staged. */
  hasStaged(root: string): boolean;
  /** Commits the staged changes; returns the new HEAD sha. */
  commit(root: string, message: string): string;
  /** git push -u origin <branch>. */
  push(root: string, branch: string): void;
  /** True when `sha` is reachable from `branch`. */
  isAncestor(root: string, sha: string, branch: string): boolean;
  /** True when `rel` differs from HEAD (modified, staged or untracked). */
  uncommitted(root: string, rel: string): boolean;
  /**
   * Re-applies and drops the stash named `message` (clean tree only); false when not applied.
   * Only for runs interrupted before the partial work stayed on disk, which stashed it.
   */
  unstash(root: string, message: string): boolean;
}

export const systemGitCommit: GitCommitPort = {
  headSha: (root) => tryRun(root, ['rev-parse', 'HEAD']),
  addAll: (root) => {
    run(root, ['add', '-A']);
  },
  hasStaged: (root) => (tryRun(root, ['diff', '--cached', '--name-only']) ?? '') !== '',
  commit: (root, message) => {
    // The message goes through a file: no quoting issues, multi-line bodies kept as written.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-commit-'));
    const file = path.join(dir, 'MSG');
    try {
      fs.writeFileSync(file, message, 'utf8');
      run(root, ['commit', '-q', '-F', file]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return run(root, ['rev-parse', 'HEAD']);
  },
  push: (root, branch) => {
    run(root, ['push', '-q', '-u', 'origin', branch]);
  },
  isAncestor: (root, sha, branch) =>
    tryRun(root, ['merge-base', '--is-ancestor', sha, branch]) !== undefined,
  uncommitted: (root, rel) => (tryRun(root, ['status', '--porcelain', '--', rel]) ?? '') !== '',
  unstash: (root, message) => unstashNamed(root, message),
};

/**
 * Re-applies the newest stash whose message is `message` and drops it; only on a clean tree, so
 * the apply cannot conflict. False when there is none, the tree is dirty or the apply fails.
 */
export function unstashNamed(root: string, message: string): boolean {
  if ((tryRun(root, ['status', '--porcelain']) ?? '') !== '') return false;
  const list = tryRun(root, ['stash', 'list', '--format=%gd%x09%s']) ?? '';
  const ref = list
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .find(([, subject]) => subject !== undefined && subject.endsWith(`: ${message}`))?.[0];
  if (!ref) return false;
  if (tryRun(root, ['stash', 'apply', '-q', '--index', ref]) === undefined) return false;
  tryRun(root, ['stash', 'drop', '-q', ref]);
  return true;
}
