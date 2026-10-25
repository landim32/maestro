#!/usr/bin/env node
/**
 * Resolves the Maestro version the same way the CI does with GitVersion (GitVersion.yml):
 *   1. `GITVERSION_SEMVER` (+ `GITVERSION_FULLSEMVER`, `GITVERSION_SHA`, `GITVERSION_BRANCHNAME`)
 *      — set by the "Version and Tag" workflow from the GitVersion action outputs;
 *   2. the git history: latest `v*` tag + Conventional-Commit prefixes since it
 *      (`fix:`/`patch:` → patch, `feat:`/`feature:`/`minor:` → minor, `major:`/`breaking:` → major,
 *      `+semver: none|skip` → no bump) and the branch rules of GitVersion.yml;
 *   3. `package.json` (installed package, tarball, or no git available).
 *
 * Usage:
 *   node scripts/version.mjs                 # prints the SemVer
 *   node scripts/version.mjs --json          # prints the full VersionInfo
 *   node scripts/version.mjs --write <file>  # writes VersionInfo as JSON (dist/version.json)
 *   node scripts/version.mjs --sync-package [semver]  # sets package.json/package-lock.json version
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Branch rules from GitVersion.yml (ContinuousDelivery). Order matters: first match wins. */
export const BRANCH_RULES = [
  { name: 'main', regex: /^master$|^main$/, increment: 'patch', label: '' },
  { name: 'develop', regex: /^dev(elop)?(ment)?$/, increment: 'minor', label: 'alpha' },
  { name: 'feature', regex: /^features?[/-]/, increment: 'minor', label: 'alpha' },
  { name: 'release', regex: /^releases?[/-]/, increment: 'patch', label: 'beta' },
  { name: 'hotfix', regex: /^hotfix(es)?[/-]/, increment: 'patch', label: '' },
  { name: 'pull-request', regex: /^(pull|pull-requests|pr)[/-]/, increment: 'patch', label: 'pr' },
];

export const MAJOR_BUMP = /^(major|breaking):/i;
export const MINOR_BUMP = /^(feat|feature|minor):/i;
export const PATCH_BUMP = /^(fix|patch):/i;
export const NO_BUMP = /\+semver:\s?(none|skip)/i;
export const TAG_PREFIX = /^[vV]/;

/** Version GitVersion assumes when the history has no version tag yet. */
export const FALLBACK_BASE = '0.1.0';

const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

/** Bump implied by one commit message (checked at the start of the message, like GitVersion). */
export function bumpOf(message) {
  const m = (message ?? '').trimStart();
  if (MAJOR_BUMP.test(m)) return 'major';
  if (MINOR_BUMP.test(m)) return 'minor';
  if (PATCH_BUMP.test(m)) return 'patch';
  if (NO_BUMP.test(m)) return 'none';
  return undefined;
}

/** Highest bump across commit messages; `undefined` when no message decides. */
export function bumpOfCommits(messages) {
  let best;
  for (const msg of messages) {
    const b = bumpOf(msg);
    if (b === undefined) continue;
    if (best === undefined || RANK[b] > RANK[best]) best = b;
  }
  return best;
}

export function branchRule(branch) {
  const name = branch ?? '';
  const rule = BRANCH_RULES.find((r) => r.regex.test(name));
  if (rule) return rule;
  // GitVersion falls back to the branch name as the pre-release label.
  const label = name.replace(/[^0-9A-Za-z-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return { name: 'fallback', regex: null, increment: 'patch', label };
}

export function parseSemver(tag) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec((tag ?? '').replace(TAG_PREFIX, ''));
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function increment(v, bump) {
  switch (bump) {
    case 'major':
      return { major: v.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major: v.major, minor: v.minor + 1, patch: 0 };
    case 'patch':
      return { major: v.major, minor: v.minor, patch: v.patch + 1 };
    default:
      return { ...v };
  }
}

const fmt = (v) => `${v.major}.${v.minor}.${v.patch}`;

/**
 * Pure computation (mirrors GitVersion.yml):
 * - HEAD tagged → exactly the tag;
 * - otherwise base + bump (from commit messages, else the branch increment),
 *   with `-<label>.<commits>` on branches that carry a label.
 */
export function computeVersion({ tag, commits = [], branch, sha }) {
  const base = parseSemver(tag);
  const rule = branchRule(branch);
  const count = commits.length;
  let next;
  if (!base) {
    next = parseSemver(FALLBACK_BASE);
  } else if (count === 0) {
    next = base;
  } else {
    const bump = bumpOfCommits(commits) ?? rule.increment;
    next = increment(base, bump);
  }
  const mmp = fmt(next);
  const pre = count > 0 || !base ? rule.label : '';
  const semver = pre ? `${mmp}-${pre}.${count}` : mmp;
  const fullSemver = pre ? semver : count > 0 ? `${mmp}+${count}` : mmp;
  return {
    version: semver,
    fullVersion: fullSemver,
    majorMinorPatch: mmp,
    preReleaseLabel: pre || undefined,
    commitsSinceVersionSource: count,
    versionSourceTag: tag ?? undefined,
    branch: branch ?? undefined,
    sha: sha ?? undefined,
    source: 'git',
  };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .replace(/\r?\n$/, '')
    .trim();
}

/** Reads tag, commits-since-tag, branch and sha from the repository at `cwd`. */
export function readGitState(cwd, env = process.env) {
  try {
    git(['rev-parse', '--git-dir'], cwd);
  } catch {
    return undefined;
  }
  let tag;
  try {
    tag = git(['describe', '--tags', '--match', 'v*', '--match', 'V*', '--abbrev=0'], cwd);
  } catch {
    tag = undefined;
  }
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  let commits = [];
  try {
    const raw = execFileSync('git', ['log', '--format=%B%x00', range], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    commits = raw
      .split('\0')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  } catch {
    commits = [];
  }
  let branch = env['GITHUB_HEAD_REF'] || env['GITHUB_REF_NAME'] || '';
  if (!branch) {
    try {
      branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    } catch {
      branch = '';
    }
  }
  if (branch === 'HEAD') branch = '';
  let sha;
  try {
    sha = git(['rev-parse', '--short', 'HEAD'], cwd);
  } catch {
    sha = undefined;
  }
  return { tag, commits, branch, sha };
}

export function readPackageVersion(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/** Resolution chain: GitVersion env (CI) → git history → package.json. */
export function resolveVersion({ cwd = process.cwd(), env = process.env } = {}) {
  const fromEnv = env['GITVERSION_SEMVER'];
  if (fromEnv) {
    return {
      version: fromEnv,
      fullVersion: env['GITVERSION_FULLSEMVER'] || fromEnv,
      majorMinorPatch: env['GITVERSION_MAJORMINORPATCH'] || fromEnv.split(/[-+]/)[0],
      branch: env['GITVERSION_BRANCHNAME'] || undefined,
      sha: env['GITVERSION_SHA'] || undefined,
      source: 'gitversion',
    };
  }
  const state = readGitState(cwd, env);
  if (state) return computeVersion(state);
  const pkg = readPackageVersion(cwd) ?? '0.0.0';
  return {
    version: pkg,
    fullVersion: pkg,
    majorMinorPatch: pkg.split(/[-+]/)[0],
    source: 'package',
  };
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const info = resolveVersion({ cwd: root });
  const [cmd, arg] = argv;
  if (cmd === '--json') {
    process.stdout.write(JSON.stringify(info, null, 2) + '\n');
    return;
  }
  if (cmd === '--write') {
    if (!arg) throw new Error('--write needs a file path');
    const target = resolve(root, arg);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(info, null, 2) + '\n');
    process.stdout.write(`${target}: ${info.version} (${info.source})\n`);
    return;
  }
  if (cmd === '--sync-package') {
    const version = arg || info.version;
    execFileSync('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    return;
  }
  process.stdout.write(info.version + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
