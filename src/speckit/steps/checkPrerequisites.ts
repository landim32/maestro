import fs from 'node:fs';
import { FeatureNotFoundError, resolveFeaturePaths } from '../feature.js';
import type { FeaturePaths } from '../feature.js';
import type { StepRequest } from '../invocation.js';
import { resolveTemplateContent, TemplateError } from '../templates.js';
import { fail, json, ok } from './types.js';
import type { StepContext, StepResult } from './types.js';

type Req = Extract<StepRequest, { step: 'check-prerequisites' }>;

const isFile = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();
const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();
const dirHasFiles = (p: string) => isDir(p) && fs.readdirSync(p).length > 0;

/** Optional artifacts in the order the scripts list them. */
export function availableDocs(paths: FeaturePaths, includeTasks: boolean): string[] {
  const docs: string[] = [];
  if (isFile(paths.RESEARCH)) docs.push('research.md');
  if (isFile(paths.DATA_MODEL)) docs.push('data-model.md');
  if (dirHasFiles(paths.CONTRACTS_DIR)) docs.push('contracts/');
  if (isFile(paths.QUICKSTART)) docs.push('quickstart.md');
  if (includeTasks && isFile(paths.TASKS)) docs.push('tasks.md');
  return docs;
}

export function resolvePathsOrFail(ctx: StepContext, persist: boolean): FeaturePaths | StepResult {
  try {
    return resolveFeaturePaths(ctx, { persist: persist && !ctx.readOnly });
  } catch (err) {
    if (err instanceof FeatureNotFoundError) return fail([err.message]);
    throw err;
  }
}

/** Validation errors shared by check-prerequisites and setup-tasks (text identical to the scripts). */
export function validateFeature(
  paths: FeaturePaths,
  opts: { requireSpec?: boolean; requireTasks?: boolean },
): StepResult | undefined {
  if (!isDir(paths.FEATURE_DIR)) {
    return fail([
      `ERROR: Feature directory not found: ${paths.FEATURE_DIR}`,
      'Run /speckit.specify first to create the feature structure.',
    ]);
  }
  if (!isFile(paths.IMPL_PLAN)) {
    return fail([
      `ERROR: plan.md not found in ${paths.FEATURE_DIR}`,
      'Run /speckit.plan first to create the implementation plan.',
    ]);
  }
  if (fs.statSync(paths.IMPL_PLAN).size === 0) {
    return fail([
      `ERROR: plan.md is empty in ${paths.FEATURE_DIR}`,
      'Populate it, or remove the empty file and rerun /speckit.plan with a valid plan template.',
    ]);
  }
  if (opts.requireSpec && !isFile(paths.FEATURE_SPEC)) {
    return fail([
      `ERROR: spec.md not found in ${paths.FEATURE_DIR}`,
      'Run /speckit.specify first to create the feature specification.',
    ]);
  }
  if (opts.requireTasks && !isFile(paths.TASKS)) {
    return fail([
      `ERROR: tasks.md not found in ${paths.FEATURE_DIR}`,
      'Run /speckit.tasks first to create the task list.',
    ]);
  }
  return undefined;
}

export function checkPrerequisites(req: Req, ctx: StepContext): StepResult {
  const paths = resolvePathsOrFail(ctx, !req.pathsOnly);
  if ('ok' in paths) return paths;

  if (req.pathsOnly) {
    const data = {
      REPO_ROOT: paths.REPO_ROOT,
      BRANCH: paths.CURRENT_BRANCH,
      FEATURE_DIR: paths.FEATURE_DIR,
      FEATURE_SPEC: paths.FEATURE_SPEC,
      IMPL_PLAN: paths.IMPL_PLAN,
      TASKS: paths.TASKS,
    };
    const output = req.json
      ? json(data)
      : Object.entries(data)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join('\n');
    return ok(output, `feature ${paths.CURRENT_BRANCH} (${paths.source})`, data);
  }

  const invalid = validateFeature(paths, req);
  if (invalid) return invalid;

  const docs = availableDocs(paths, Boolean(req.includeTasks));
  const data: Record<string, unknown> = { FEATURE_DIR: paths.FEATURE_DIR, AVAILABLE_DOCS: docs };
  if (req.template) {
    let content: string | undefined;
    try {
      content = resolveTemplateContent(req.template, paths.REPO_ROOT, ctx.assets);
    } catch (err) {
      if (err instanceof TemplateError) return fail([err.message]);
      throw err;
    }
    if (content === undefined) {
      return fail([
        `ERROR: Could not resolve required ${req.template} from the template override stack for ${paths.REPO_ROOT}`,
      ]);
    }
    data['TEMPLATE_CONTENT'] = content;
  }
  const output = req.json
    ? json(data)
    : [
        `FEATURE_DIR:${paths.FEATURE_DIR}`,
        'AVAILABLE_DOCS:',
        ...[
          'research.md',
          'data-model.md',
          'contracts/',
          'quickstart.md',
          ...(req.includeTasks ? ['tasks.md'] : []),
        ].map((d) => `  ${docs.includes(d) ? '✓' : '✗'} ${d}`),
      ].join('\n');
  return ok(
    output,
    `${paths.CURRENT_BRANCH}: ${docs.length ? docs.join(', ') : 'no optional docs'}`,
    data,
  );
}
