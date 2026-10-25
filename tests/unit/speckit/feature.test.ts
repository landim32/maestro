import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FeatureNotFoundError,
  findSpecifyRoot,
  resolveFeaturePaths,
} from '../../../src/speckit/feature.js';
import { systemGit } from '../../../src/speckit/git.js';
import {
  highestFromBranches,
  highestFromSpecs,
  nextFeatureNumber,
  readInitOptions,
  timestampPrefix,
} from '../../../src/speckit/numbering.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';

let repo: TempRepo;
beforeEach(() => {
  repo = withTempRepo({ git: true, specify: '1.x' });
});
afterEach(() => repo.cleanup());

const ctx = (env: NodeJS.ProcessEnv = {}) => ({ cwd: repo.root, env, git: systemGit });

/** contracts/native-steps.md § 3 */
describe('resolveFeaturePaths', { timeout: 60_000 }, () => {
  it('finds the .specify root from a subdirectory', () => {
    repo.write('src/deep/x.txt', '');
    expect(findSpecifyRoot(path.join(repo.root, 'src', 'deep'), systemGit)).toBe(repo.root);
  });

  it('fails with the scripts message when nothing identifies a feature', () => {
    expect(() => resolveFeaturePaths(ctx(), { persist: false })).toThrow(FeatureNotFoundError);
    expect(() => resolveFeaturePaths(ctx(), { persist: false })).toThrow(
      /Run \/speckit\.specify first/,
    );
  });

  it('resolves by env dir, env name, feature.json, git branch and newest dir, in that order', () => {
    repo.write('specs/001-old/spec.md', '');
    repo.write('specs/003-new/spec.md', '');
    expect(resolveFeaturePaths(ctx(), { persist: false })).toMatchObject({
      source: 'latest-dir',
      CURRENT_BRANCH: '003-new',
    });
    expect(repo.exists('.specify/feature.json')).toBe(false);
    resolveFeaturePaths(ctx(), { persist: true });
    expect(JSON.parse(repo.read('.specify/feature.json'))).toEqual({
      feature_directory: 'specs/003-new',
    });

    repo.git('checkout', '-q', '-b', '002-branch');
    repo.write('.specify/feature.json', '{}');
    const byBranch = resolveFeaturePaths(ctx(), { persist: false });
    expect(byBranch).toMatchObject({
      source: 'git-branch',
      CURRENT_BRANCH: '002-branch',
      HAS_GIT: true,
    });
    expect(byBranch.FEATURE_DIR).toBe(path.join(repo.root, 'specs', '002-branch'));

    repo.write('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/001-old' }));
    expect(resolveFeaturePaths(ctx(), { persist: false })).toMatchObject({
      source: 'feature-json',
      CURRENT_BRANCH: '002-branch',
    });

    expect(
      resolveFeaturePaths(ctx({ SPECIFY_FEATURE: '003-new' }), { persist: false }),
    ).toMatchObject({ source: 'env-name' });
    expect(
      resolveFeaturePaths(ctx({ SPECIFY_FEATURE_DIRECTORY: 'specs/001-old' }), { persist: false }),
    ).toMatchObject({
      source: 'env-dir',
      FEATURE_SPEC: path.join(repo.root, 'specs', '001-old', 'spec.md'),
    });
  });

  it('timestamp directories win over numbered ones as "latest"', () => {
    repo.write('specs/009-num/spec.md', '');
    repo.write('specs/20260101-120000-ts/spec.md', '');
    expect(resolveFeaturePaths(ctx(), { persist: false }).CURRENT_BRANCH).toBe(
      '20260101-120000-ts',
    );
  });
});

/** specs/006 data-model § 4 — numbering */
describe('numbering', { timeout: 60_000 }, () => {
  it('reads feature_numbering with the deprecated branch_numbering fallback', () => {
    expect(readInitOptions(repo.root)).toMatchObject({
      numbering: 'sequential',
      deprecatedKey: false,
    });
    repo.write('.specify/init-options.json', JSON.stringify({ branch_numbering: 'timestamp' }));
    expect(readInitOptions(repo.root)).toMatchObject({
      numbering: 'timestamp',
      deprecatedKey: true,
    });
  });

  it('takes the max of spec dirs and local+remote branches, +1, ignoring timestamps and octal', () => {
    repo.write('specs/010-ten/spec.md', '');
    repo.write('specs/20260101-120000-ts/spec.md', '');
    expect(highestFromSpecs(path.join(repo.root, 'specs'))).toBe(10);
    expect(
      highestFromBranches(['main', '012-x', 'origin/015-y', 'origin/HEAD', '20260101-120000-z']),
    ).toBe(15);
    repo.git('branch', '012-twelve');
    expect(nextFeatureNumber(repo.root, systemGit)).toBe(13);
    expect(timestampPrefix(new Date(2026, 0, 5, 7, 8, 9))).toBe('20260105-070809');
  });
});
