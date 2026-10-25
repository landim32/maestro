import { describe, expect, it } from 'vitest';
import {
  branchRule,
  bumpOf,
  bumpOfCommits,
  computeVersion,
  readGitState,
  resolveVersion,
} from '../../scripts/version.mjs';
import { VERSION, VERSION_INFO } from '../../src/version.js';

describe('scripts/version.mjs — GitVersion.yml rules', () => {
  it('maps commit prefixes to bumps exactly like commit-message-incrementing', () => {
    expect(bumpOf('fix: x')).toBe('patch');
    expect(bumpOf('patch: x')).toBe('patch');
    expect(bumpOf('feat: x')).toBe('minor');
    expect(bumpOf('feature: x')).toBe('minor');
    expect(bumpOf('minor: x')).toBe('minor');
    expect(bumpOf('major: x')).toBe('major');
    expect(bumpOf('breaking: x')).toBe('major');
    expect(bumpOf('chore: x +semver: skip')).toBe('none');
    expect(bumpOf('docs: x')).toBeUndefined();
    expect(bumpOf('fix(ui): scoped')).toBeUndefined(); // GitVersion regex requires `fix:` at the start
    expect(bumpOfCommits(['fix: a', 'feat: b', 'docs: c'])).toBe('minor');
    expect(bumpOfCommits(['docs: c'])).toBeUndefined();
  });

  it('applies the branch rules of GitVersion.yml', () => {
    expect(branchRule('main')).toMatchObject({ increment: 'patch', label: '' });
    expect(branchRule('master')).toMatchObject({ name: 'main' });
    expect(branchRule('develop')).toMatchObject({ increment: 'minor', label: 'alpha' });
    expect(branchRule('feature/x')).toMatchObject({ increment: 'minor', label: 'alpha' });
    expect(branchRule('releases/v1.2.0')).toMatchObject({ increment: 'patch', label: 'beta' });
    expect(branchRule('hotfix/x')).toMatchObject({ label: '' });
    expect(branchRule('003-auth-provider-setup')).toMatchObject({
      increment: 'patch',
      label: '003-auth-provider-setup',
    });
    expect(branchRule('wip/weird name!')).toMatchObject({ label: 'wip-weird-name' });
  });

  it('computes the next version from the latest tag and the commits since it', () => {
    // HEAD tagged → exactly the tag
    expect(computeVersion({ tag: 'v0.1.1', commits: [], branch: 'main' })).toMatchObject({
      version: '0.1.1',
      fullVersion: '0.1.1',
      commitsSinceVersionSource: 0,
    });
    // main: fix → patch, no label; FullSemVer carries the commit count
    expect(
      computeVersion({ tag: 'v0.1.1', commits: ['fix: a', 'fix: b'], branch: 'main' }),
    ).toMatchObject({ version: '0.1.2', fullVersion: '0.1.2+2' });
    // one feat among fixes → minor
    expect(
      computeVersion({ tag: 'v0.1.1', commits: ['fix: a', 'feat: b'], branch: 'main' }),
    ).toMatchObject({ version: '0.2.0' });
    expect(computeVersion({ tag: 'v0.1.1', commits: ['major: b'], branch: 'main' })).toMatchObject({
      version: '1.0.0',
    });
    // no prefix at all → the branch increment (main: patch; feature: minor + alpha label)
    expect(computeVersion({ tag: 'v0.1.1', commits: ['docs: x'], branch: 'main' })).toMatchObject({
      version: '0.1.2',
    });
    expect(
      computeVersion({ tag: 'v0.1.1', commits: ['docs: x', 'docs: y'], branch: 'feature/x' }),
    ).toMatchObject({ version: '0.2.0-alpha.2', fullVersion: '0.2.0-alpha.2' });
    // an unmatched branch uses its name as the label
    expect(
      computeVersion({ tag: 'v0.1.1', commits: ['fix: a'], branch: '003-auth-provider-setup' }),
    ).toMatchObject({ version: '0.1.2-003-auth-provider-setup.1' });
    // +semver: skip only → no bump
    expect(
      computeVersion({ tag: 'v0.1.1', commits: ['chore: x +semver: none'], branch: 'main' }),
    ).toMatchObject({ version: '0.1.1', fullVersion: '0.1.1+1' });
    // no tag at all → GitVersion's fallback base
    expect(computeVersion({ commits: ['fix: a'], branch: 'main' })).toMatchObject({
      version: '0.1.0',
    });
  });

  it('prefers the GitVersion outputs from the environment (CI)', () => {
    const info = resolveVersion({
      cwd: process.cwd(),
      env: { GITVERSION_SEMVER: '1.2.3', GITVERSION_FULLSEMVER: '1.2.3+5', GITVERSION_SHA: 'abc' },
    });
    expect(info).toMatchObject({
      version: '1.2.3',
      fullVersion: '1.2.3+5',
      majorMinorPatch: '1.2.3',
      sha: 'abc',
      source: 'gitversion',
    });
  });

  it('reads the repository state and produces a semver for this checkout', () => {
    const state = readGitState(process.cwd(), {});
    expect(state).toBeDefined();
    const info = resolveVersion({ cwd: process.cwd(), env: {} });
    expect(info.source).toBe('git');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});

describe('src/version.ts', () => {
  it('exposes a semver and its source', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(['gitversion', 'git', 'package']).toContain(VERSION_INFO.source);
  });
});
