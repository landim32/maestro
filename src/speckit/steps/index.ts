import type { StepRequest } from '../invocation.js';
import { updateAgentContext } from './agentContext.js';
import { checkPrerequisites } from './checkPrerequisites.js';
import { createFeature } from './createFeature.js';
import { resolveTemplate } from './resolveTemplate.js';
import { setupPlan, setupTasks } from './setupPlan.js';
import type { StepContext, StepResult } from './types.js';

export type { StepContext, StepResult } from './types.js';

/** Runs one native Spec Kit step; never throws for expected failures (`ok: false` instead). */
export async function runStep(req: StepRequest, ctx: StepContext): Promise<StepResult> {
  switch (req.step) {
    case 'create-feature':
      return createFeature(req, ctx);
    case 'setup-plan':
      return setupPlan(req, ctx);
    case 'setup-tasks':
      return setupTasks(req, ctx);
    case 'check-prerequisites':
      return checkPrerequisites(req, ctx);
    case 'resolve-template':
      return resolveTemplate(req, ctx);
    case 'update-agent-context':
      return updateAgentContext(req, ctx);
  }
}
