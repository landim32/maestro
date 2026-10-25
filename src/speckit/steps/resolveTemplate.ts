import { findSpecifyRoot } from '../feature.js';
import type { StepRequest } from '../invocation.js';
import { resolveTemplateContent, TemplateError } from '../templates.js';
import { fail, json, ok } from './types.js';
import type { StepContext, StepResult } from './types.js';

type Req = Extract<StepRequest, { step: 'resolve-template' }>;

export function resolveTemplate(req: Req, ctx: StepContext): StepResult {
  const root = findSpecifyRoot(ctx.cwd, ctx.git);
  let content: string | undefined;
  try {
    content = resolveTemplateContent(req.name, root, ctx.assets);
  } catch (err) {
    if (err instanceof TemplateError) return fail([err.message]);
    throw err;
  }
  if (content === undefined) {
    return fail([
      `ERROR: Could not resolve required ${req.name} from the template override stack for ${root}`,
    ]);
  }
  const data = { TEMPLATE_NAME: req.name, TEMPLATE_CONTENT: content };
  return ok(req.json ? json(data) : content, `${req.name} (${content.length} chars)`, data);
}
