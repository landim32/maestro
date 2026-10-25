import type { AssetsPort } from '../assets.js';
import type { GitPort } from '../git.js';

export interface StepContext {
  /** Working directory of the session (the Spec Kit root is found from here). */
  cwd: string;
  env: NodeJS.ProcessEnv;
  git: GitPort;
  assets: AssetsPort;
  settings: { createBranch: boolean };
  now?: () => Date;
  /** Preflight mode: never persist `.specify/feature.json`. */
  readOnly?: boolean;
}

export interface StepResult {
  ok: boolean;
  /** What the script would print (JSON line in json mode, text otherwise, errors as `ERROR: …`). */
  output: string;
  /** One line for the transcript (`⚙ speckit <step> · <summary>`). */
  summary: string;
  /** Structured payload (the JSON object, or extra facts such as updated files). */
  data?: Record<string, unknown>;
  /** Non-fatal warnings the scripts print to stderr. */
  warnings?: string[];
}

export const ok = (
  output: string,
  summary: string,
  data?: Record<string, unknown>,
  warnings?: string[],
): StepResult => ({
  ok: true,
  output,
  summary,
  data,
  warnings,
});

export const fail = (lines: string[], summary = lines[0] ?? 'error'): StepResult => ({
  ok: false,
  output: lines.join('\n'),
  summary,
});

export const json = (obj: Record<string, unknown>): string => JSON.stringify(obj);
