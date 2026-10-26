/** `.specify/autopilot.json` (specs/011 contracts/state-file.md): read, validate, atomic write. */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { STEPS } from './types.js';
import type { Run } from './types.js';

export const STATE_FILE = path.join('.specify', 'autopilot.json');

const stepRunSchema = z.strictObject({
  status: z.enum(['pending', 'running', 'done', 'failed', 'interrupted']),
  rounds: z.number().int().min(0),
  attempts: z.number().int().min(0),
  answers: z.number().int().min(0),
  fixing: z.boolean().optional(),
  sha: z.string().optional(),
  ms: z.number().min(0),
  tokens: z.number().min(0),
  gate: z.strictObject({ ok: z.boolean(), reason: z.string() }).optional(),
});

const stepsSchema = z.strictObject(
  Object.fromEntries(STEPS.map((s) => [s, stepRunSchema])) as Record<
    (typeof STEPS)[number],
    typeof stepRunSchema
  >,
);

const storyRunSchema = z.strictObject({
  title: z.string(),
  hash: z.string(),
  feature: z.string().optional(),
  branch: z.string().optional(),
  status: z.enum(['pending', 'running', 'done', 'stopped']),
  usage: z.strictObject({
    turns: z.number().int().min(0),
    ms: z.number().min(0),
    inputTokens: z.number().min(0),
    outputTokens: z.number().min(0),
  }),
  steps: stepsSchema,
  pr: z.strictObject({ url: z.string(), number: z.number().int() }).optional(),
});

export const runStateSchema = z.strictObject({
  version: z.literal(1),
  id: z.string(),
  input: z.string(),
  inputHash: z.string(),
  baseBranch: z.string(),
  status: z.enum(['active', 'interrupted', 'stopped', 'done']),
  pid: z.number().int(),
  startedAt: z.string(),
  stopped: z
    .strictObject({ story: z.number().int(), step: z.enum(STEPS), reason: z.string() })
    .optional(),
  stories: z.array(storyRunSchema),
});

export function statePath(root: string): string {
  return path.join(root, STATE_FILE);
}

export function readRunState(root: string): Run | undefined | { error: string } {
  const file = statePath(root);
  if (!fs.existsSync(file)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { error: 'Estado do autopiloto ilegível (.specify/autopilot.json).' };
  }
  const version = (raw as { version?: unknown } | null)?.version;
  if (version !== 1)
    return { error: `Estado do autopiloto em formato desconhecido (versão ${String(version)}).` };
  const parsed = runStateSchema.safeParse(raw);
  if (!parsed.success)
    return { error: 'Estado do autopiloto em formato desconhecido (campos inválidos).' };
  return parsed.data as Run;
}

export function serializeRun(run: Run): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}

/** Atomic write (tmp + rename). */
export function writeRunState(root: string, run: Run): void {
  const file = statePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serializeRun(run), 'utf8');
  fs.renameSync(tmp, file);
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
