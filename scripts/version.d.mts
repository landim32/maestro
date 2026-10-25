export type Bump = 'none' | 'patch' | 'minor' | 'major';

export interface BranchRule {
  name: string;
  regex: RegExp | null;
  increment: Exclude<Bump, 'none'>;
  label: string;
}

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export interface GitState {
  tag?: string;
  commits: string[];
  branch?: string;
  sha?: string;
}

export interface VersionInfo {
  version: string;
  fullVersion: string;
  majorMinorPatch: string;
  preReleaseLabel?: string;
  commitsSinceVersionSource?: number;
  versionSourceTag?: string;
  branch?: string;
  sha?: string;
  source: 'gitversion' | 'git' | 'package';
}

export const BRANCH_RULES: BranchRule[];
export const MAJOR_BUMP: RegExp;
export const MINOR_BUMP: RegExp;
export const PATCH_BUMP: RegExp;
export const NO_BUMP: RegExp;
export const TAG_PREFIX: RegExp;
export const FALLBACK_BASE: string;

export function bumpOf(message: string | undefined): Bump | undefined;
export function bumpOfCommits(messages: Iterable<string>): Bump | undefined;
export function branchRule(branch: string | undefined): BranchRule;
export function parseSemver(tag: string | undefined): Semver | undefined;
export function increment(v: Semver, bump: Bump | undefined): Semver;
export function computeVersion(state: GitState): VersionInfo;
export function readGitState(cwd: string, env?: NodeJS.ProcessEnv): GitState | undefined;
export function readPackageVersion(cwd: string): string | undefined;
export function resolveVersion(opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): VersionInfo;
