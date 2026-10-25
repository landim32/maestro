import fs from 'node:fs';
import path from 'node:path';
import { findSpecifyRoot, writeFeatureJson } from '../feature.js';
import type { StepRequest } from '../invocation.js';
import { cleanBranchName, fitBranchName, generateBranchName } from '../naming.js';
import {
  formatFeatureNum,
  highestFromSpecs,
  nextFeatureNumber,
  readInitOptions,
  specPrefixExists,
  timestampPrefix,
} from '../numbering.js';
import { resolveTemplateContent, TemplateError } from '../templates.js';
import { fail, json, ok } from './types.js';
import type { StepContext, StepResult } from './types.js';

type Req = Extract<StepRequest, { step: 'create-feature' }>;

/**
 * create-new-feature: numbers and names the feature, creates `specs/<name>/spec.md` from the
 * resolved template, persists feature.json and (Maestro, research R4) creates the git branch.
 */
export function createFeature(req: Req, ctx: StepContext): StepResult {
  const root = findSpecifyRoot(ctx.cwd, ctx.git);
  const specsDir = path.join(root, 'specs');
  const warnings: string[] = [];
  const description = req.description.trim();
  if (!description && !req.shortName) {
    return fail(['Error: Feature description cannot be empty or contain only whitespace']);
  }

  const suffix = req.shortName ? cleanBranchName(req.shortName) : generateBranchName(description);
  if (!suffix) {
    warnings.push(
      '[specify] Warning: Feature name is empty after removing unsupported characters. Use --short-name with letters or digits (for example, user-auth).',
    );
  }

  const initOptions = readInitOptions(root);
  if (initOptions.deprecatedKey) {
    warnings.push(
      '⚠️ `branch_numbering` in init-options.json is deprecated. Rename to `feature_numbering`.',
    );
  }
  const useTimestamp = Boolean(req.timestamp) || initOptions.numbering === 'timestamp';
  let explicitNumber = req.number;
  if (useTimestamp && explicitNumber) {
    warnings.push('[specify] Warning: --number is ignored when --timestamp is used');
    explicitNumber = undefined;
  }

  let featureNum: string;
  if (useTimestamp) {
    featureNum = timestampPrefix((ctx.now ?? (() => new Date()))());
  } else if (explicitNumber !== undefined) {
    if (!/^\d+$/.test(explicitNumber)) {
      return fail([`Error: --number must be an unsigned integer, got '${explicitNumber}'`]);
    }
    featureNum = formatFeatureNum(Number.parseInt(explicitNumber, 10));
    const conflicts = !(
      req.allowExisting && fs.existsSync(path.join(specsDir, fitBranchName(featureNum, suffix)))
    );
    if (conflicts && specPrefixExists(specsDir, featureNum)) {
      let n = highestFromSpecs(specsDir);
      do n += 1;
      while (specPrefixExists(specsDir, formatFeatureNum(n)));
      warnings.push(
        `[specify] Warning: --number ${featureNum} conflicts with an existing spec directory; using ${formatFeatureNum(n)} instead`,
      );
      featureNum = formatFeatureNum(n);
    }
  } else {
    featureNum = formatFeatureNum(nextFeatureNumber(root, ctx.git));
  }

  const original = `${featureNum}-${suffix}`;
  const branchName = fitBranchName(featureNum, suffix);
  if (branchName !== original) {
    warnings.push(
      `[specify] Warning: Branch name exceeded GitHub's 244-byte limit`,
      `[specify] Original: ${original} (${Buffer.byteLength(original)} bytes)`,
      `[specify] Truncated to: ${branchName} (${Buffer.byteLength(branchName)} bytes)`,
    );
  }

  const featureDir = path.join(specsDir, branchName);
  const specFile = path.join(featureDir, 'spec.md');
  const hasGit = ctx.git.hasGit(root);
  const data: Record<string, unknown> = {
    BRANCH_NAME: branchName,
    SPEC_FILE: specFile,
    FEATURE_NUM: featureNum,
    FEATURE_DIR: featureDir,
    HAS_GIT: hasGit,
  };

  if (req.dryRun) {
    data['DRY_RUN'] = true;
    return ok(req.json ? json(data) : textOf(data), `${branchName} (dry run)`, data, warnings);
  }

  if (fs.existsSync(featureDir) && !req.allowExisting) {
    return fail([
      useTimestamp
        ? `Error: Feature directory '${featureDir}' already exists. Rerun to get a new timestamp or use a different --short-name.`
        : `Error: Feature directory '${featureDir}' already exists. Please use a different feature name or specify a different number with --number.`,
    ]);
  }

  fs.mkdirSync(featureDir, { recursive: true });
  if (!fs.existsSync(specFile)) {
    let template: string | undefined;
    try {
      template = resolveTemplateContent('spec-template', root, ctx.assets);
    } catch (err) {
      if (err instanceof TemplateError) return fail([err.message]);
      throw err;
    }
    if (template === undefined) {
      warnings.push('Warning: Spec template not found; created empty spec file');
      template = '';
    }
    fs.writeFileSync(specFile, template, 'utf8');
  }
  writeFeatureJson(root, featureDir);

  const summaryParts = [branchName];
  if (hasGit && ctx.settings.createBranch) {
    if (ctx.git.isDirty(root)) {
      warnings.push(
        '[specify] Warning: working tree has uncommitted changes; they move to the new branch',
      );
    }
    try {
      if (ctx.git.branchExists(root, branchName)) {
        if (!req.allowExisting) {
          return fail([
            `Error: git branch '${branchName}' already exists. Use --allow-existing-branch to switch to it.`,
          ]);
        }
        ctx.git.checkoutExisting(root, branchName);
        summaryParts.push('branch existente');
      } else {
        ctx.git.checkoutNew(root, branchName);
        summaryParts.push('branch criada');
      }
    } catch (err) {
      return fail([
        `Error: could not create git branch '${branchName}': ${(err as Error).message}`,
      ]);
    }
  } else if (!hasGit) {
    warnings.push('[specify] Warning: Git repository not detected; skipped branch creation');
    summaryParts.push('sem git');
  } else {
    summaryParts.push('sem branch (speckit.createBranch=false)');
  }

  return ok(req.json ? json(data) : textOf(data), summaryParts.join(' · '), data, warnings);
}

function textOf(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('\n');
}
