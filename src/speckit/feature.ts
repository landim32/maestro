import fs from 'node:fs';
import path from 'node:path';
import type { GitPort } from './git.js';

/** Paths the Spec Kit scripts expose (`get_feature_paths`), plus how the feature was found. */
export interface FeaturePaths {
  REPO_ROOT: string;
  CURRENT_BRANCH: string;
  HAS_GIT: boolean;
  FEATURE_DIR: string;
  FEATURE_SPEC: string;
  IMPL_PLAN: string;
  TASKS: string;
  RESEARCH: string;
  DATA_MODEL: string;
  QUICKSTART: string;
  CONTRACTS_DIR: string;
  source: 'env-dir' | 'env-name' | 'feature-json' | 'git-branch' | 'latest-dir';
}

export interface FeatureContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  git: GitPort;
}

export class FeatureNotFoundError extends Error {
  constructor() {
    super(
      'ERROR: Feature directory not found. Run /speckit.specify first to create the feature structure.',
    );
    this.name = 'FeatureNotFoundError';
  }
}

const SEQUENTIAL = /^\d{3,}-/;
const TIMESTAMP = /^\d{8}-\d{6}-/;

export function isFeatureName(name: string): boolean {
  return SEQUENTIAL.test(name) || TIMESTAMP.test(name);
}

/** Walks up from `cwd` looking for `.specify/`; falls back to the git top level, then `cwd`. */
export function findSpecifyRoot(cwd: string, git?: GitPort): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.specify'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return git?.toplevel(cwd) ?? path.resolve(cwd);
}

export function readFeatureJson(root: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(root, '.specify', 'feature.json'), 'utf8'),
    );
    const value = (parsed as { feature_directory?: unknown }).feature_directory;
    return typeof value === 'string' && value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Persists the feature directory (relative to root, forward slashes) when it changed. */
export function writeFeatureJson(root: string, featureDir: string): void {
  let rel = path.isAbsolute(featureDir) ? path.relative(root, featureDir) : featureDir;
  rel = rel.split(path.sep).join('/');
  if (readFeatureJson(root) === rel) return;
  fs.mkdirSync(path.join(root, '.specify'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specify', 'feature.json'),
    `${JSON.stringify({ feature_directory: rel })}\n`,
  );
}

/** Newest feature directory under specs/: timestamps win over numbers; otherwise the highest number. */
export function latestFeatureDir(specsDir: string): string | undefined {
  if (!fs.existsSync(specsDir)) return undefined;
  let latestTs = '';
  let latestNum = 0;
  let byTs: string | undefined;
  let byNum: string | undefined;
  for (const entry of fs.readdirSync(specsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const ts = /^(\d{8}-\d{6})-/.exec(entry.name);
    if (ts) {
      if (ts[1]! > latestTs) {
        latestTs = ts[1]!;
        byTs = entry.name;
      }
      continue;
    }
    const seq = /^(\d{3,})-/.exec(entry.name);
    if (seq) {
      const n = Number.parseInt(seq[1]!, 10);
      if (n > latestNum) {
        latestNum = n;
        byNum = entry.name;
      }
    }
  }
  return byTs ?? byNum;
}

/**
 * Resolves the active feature (contracts/native-steps.md § 3): env dir → env name → feature.json →
 * git branch → newest specs/ directory. `persist` writes feature.json for the last two sources.
 */
export function resolveFeaturePaths(ctx: FeatureContext, opts: { persist: boolean }): FeaturePaths {
  const root = findSpecifyRoot(ctx.cwd, ctx.git);
  const hasGit = ctx.git.hasGit(root);
  const specsDir = path.join(root, 'specs');
  const abs = (p: string) => (path.isAbsolute(p) ? p : path.join(root, p));

  let featureDir: string | undefined;
  let source: FeaturePaths['source'] | undefined;

  const envDir = ctx.env['SPECIFY_FEATURE_DIRECTORY'];
  const envName = ctx.env['SPECIFY_FEATURE'];
  if (envDir) {
    featureDir = abs(envDir);
    source = 'env-dir';
  } else if (envName) {
    featureDir = path.join(specsDir, envName);
    source = 'env-name';
  } else {
    const fromJson = readFeatureJson(root);
    if (fromJson) {
      featureDir = abs(fromJson);
      source = 'feature-json';
    }
  }
  let gitBranch: string | undefined;
  if (!featureDir) {
    gitBranch = hasGit ? ctx.git.currentBranch(root) : undefined;
    if (gitBranch && isFeatureName(gitBranch)) {
      featureDir = path.join(specsDir, gitBranch);
      source = 'git-branch';
    }
  }
  if (!featureDir) {
    const latest = latestFeatureDir(specsDir);
    if (latest) {
      featureDir = path.join(specsDir, latest);
      source = 'latest-dir';
    }
  }
  if (!featureDir || !source) throw new FeatureNotFoundError();

  if (
    opts.persist &&
    (source === 'git-branch' || source === 'latest-dir' || source === 'env-dir')
  ) {
    writeFeatureJson(root, featureDir);
  }

  // CURRENT_BRANCH: the git branch when it names a feature, else the directory basename.
  const branch =
    source === 'git-branch' ? gitBranch : hasGit ? ctx.git.currentBranch(root) : undefined;
  const branchName = branch && isFeatureName(branch) ? branch : path.basename(featureDir);

  return {
    REPO_ROOT: root,
    CURRENT_BRANCH: branchName,
    HAS_GIT: hasGit,
    FEATURE_DIR: featureDir,
    FEATURE_SPEC: path.join(featureDir, 'spec.md'),
    IMPL_PLAN: path.join(featureDir, 'plan.md'),
    TASKS: path.join(featureDir, 'tasks.md'),
    RESEARCH: path.join(featureDir, 'research.md'),
    DATA_MODEL: path.join(featureDir, 'data-model.md'),
    QUICKSTART: path.join(featureDir, 'quickstart.md'),
    CONTRACTS_DIR: path.join(featureDir, 'contracts'),
    source,
  };
}
