import fs from 'node:fs';
import path from 'node:path';
import type { StepRequest } from '../invocation.js';
import { resolveTemplateContent, resolveTemplatePath, TemplateError } from '../templates.js';
import { availableDocs, resolvePathsOrFail, validateFeature } from './checkPrerequisites.js';
import { fail, json, ok } from './types.js';
import type { StepContext, StepResult } from './types.js';

type PlanReq = Extract<StepRequest, { step: 'setup-plan' }>;
type TasksReq = Extract<StepRequest, { step: 'setup-tasks' }>;

/** Copies the resolved plan template to plan.md once and returns the feature paths. */
export function setupPlan(req: PlanReq, ctx: StepContext): StepResult {
  const paths = resolvePathsOrFail(ctx, true);
  if ('ok' in paths) return paths;
  fs.mkdirSync(paths.FEATURE_DIR, { recursive: true });

  let note: string;
  if (fs.existsSync(paths.IMPL_PLAN)) {
    note = `Plan already exists at ${paths.IMPL_PLAN}, skipping template copy`;
  } else {
    let content: string | undefined;
    try {
      content = resolveTemplateContent('plan-template', paths.REPO_ROOT, ctx.assets);
    } catch (err) {
      if (err instanceof TemplateError) return fail([err.message]);
      throw err;
    }
    if (content === undefined || content.trim() === '') {
      return fail([
        'ERROR: Plan template not found; no new plan.md was created.',
        'Restore a valid plan template and rerun plan setup.',
      ]);
    }
    fs.writeFileSync(paths.IMPL_PLAN, content, 'utf8');
    note = `Copied plan template to ${paths.IMPL_PLAN}`;
  }

  const data = {
    FEATURE_SPEC: paths.FEATURE_SPEC,
    IMPL_PLAN: paths.IMPL_PLAN,
    FEATURE_DIR: paths.FEATURE_DIR,
    BRANCH: paths.CURRENT_BRANCH,
    HAS_GIT: paths.HAS_GIT,
  };
  const output = req.json
    ? json(data)
    : [note, ...Object.entries(data).map(([k, v]) => `${k}: ${String(v)}`)].join('\n');
  return ok(output, note, data, req.json ? [note] : undefined);
}

/** Validates spec+plan, lists docs and returns the composed tasks template. */
export function setupTasks(req: TasksReq, ctx: StepContext): StepResult {
  const paths = resolvePathsOrFail(ctx, true);
  if ('ok' in paths) return paths;
  const invalid = validateFeature(paths, { requireSpec: true });
  if (invalid) return invalid;

  const docs = availableDocs(paths, false);
  let content: string | undefined;
  let templatePath: string | undefined;
  try {
    templatePath = resolveTemplatePath('tasks-template', paths.REPO_ROOT, ctx.assets);
    content = resolveTemplateContent('tasks-template', paths.REPO_ROOT, ctx.assets);
  } catch (err) {
    if (err instanceof TemplateError) return fail([err.message]);
    throw err;
  }
  if (content === undefined) {
    return fail([
      `ERROR: Could not resolve required tasks-template from the template override stack for ${paths.REPO_ROOT}`,
      "Template 'tasks-template' was not found in any supported location (overrides, presets, extensions, or shared core). Add an override at .specify/templates/overrides/tasks-template.md, or run /speckit.init to restore the core .specify/templates/tasks-template.md template.",
    ]);
  }
  const data = {
    FEATURE_DIR: paths.FEATURE_DIR,
    AVAILABLE_DOCS: docs,
    TASKS_TEMPLATE: templatePath ?? '',
    TASKS_TEMPLATE_CONTENT: content,
  };
  const output = req.json
    ? json(data)
    : [
        `FEATURE_DIR: ${paths.FEATURE_DIR}`,
        `TASKS_TEMPLATE: ${templatePath ?? 'not found'}`,
        'AVAILABLE_DOCS:',
        ...['research.md', 'data-model.md', 'contracts/', 'quickstart.md'].map(
          (d) => `  ${docs.includes(d) ? '✓' : '✗'} ${d}`,
        ),
      ].join('\n');
  return ok(
    output,
    `${path.basename(paths.FEATURE_DIR)}: ${docs.join(', ') || 'no optional docs'}`,
    data,
  );
}
