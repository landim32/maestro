import type { z } from 'zod';
import type { ToolsSettings } from '../config/schema.js';
import type { ApprovalMode, ToolKind } from './approval.js';
import type { FileDiff } from './diff.js';
import type { SkillSource } from '../skills/catalog.js';

/** What a `load_skill` call loaded (specs/013 data-model § 4); feeds the transcript and the autopilot log. */
export interface SkillLoadDisplay {
  name: string;
  /** Absent when the name is unknown. */
  source?: SkillSource;
  file?: string;
  ok: boolean;
  lines?: number;
  /** Reference files listed (only without `file`). */
  files?: number;
}

/**
 * Display-only metadata of a tool result (specs/009 data-model § 3). Shown in the transcript;
 * never sent to the model (the provider converters copy only callId/output/isError).
 */
export interface ToolResultDisplay {
  diff?: FileDiff;
  /** The action ran without asking because of this approval mode. */
  autoMode?: ApprovalMode;
  /** The user declined the action. */
  declined?: boolean;
  /** Native Spec Kit step that replaced a script invocation. */
  speckitStep?: string;
  summary?: string;
  skill?: SkillLoadDisplay;
}

export type ToolName =
  'read_file' | 'list_directory' | 'write_file' | 'run_command' | 'ask_user' | 'load_skill';

// ---------------------------------------------------------------- ask_user (contracts/ask-user.md)

export interface AskUserOption {
  label: string;
  description: string;
}

export interface AskUserQuestion {
  question: string;
  header: string;
  options: AskUserOption[];
  multiSelect: boolean;
}

export interface AskUserRequest {
  questions: AskUserQuestion[];
}

export type AskUserAnswer = { kind: 'options'; labels: string[] } | { kind: 'other'; text: string };

export type AskUserOutcome = { answered: true; answers: AskUserAnswer[] } | { answered: false };

// ---------------------------------------------------------------- tools

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  settings: ToolsSettings;
  /** Present only in interactive sessions; `ask_user` uses it to reach the user. */
  ask?: (request: AskUserRequest) => Promise<AskUserOutcome>;
}

export interface ToolResult {
  output: string;
  isError: boolean;
  display?: ToolResultDisplay;
}

export interface ToolDefinition<I = unknown> {
  name: ToolName;
  description: string;
  /** Validated before execution — model-supplied input is untrusted. */
  inputSchema: z.ZodType<I>;
  /** What the tool does; together with the approval mode decides whether to ask the user. */
  kind: ToolKind;
  /** Text shown to the user before confirmation (diff, command…). */
  preview?: (input: I, ctx: ToolContext) => Promise<string>;
  /** Structured diff of what the call would change, computed before it runs (specs/009). */
  diff?: (input: I, ctx: ToolContext) => Promise<FileDiff>;
  run: (input: I, ctx: ToolContext) => Promise<ToolResult>;
}

export interface PendingToolAction {
  callId: string;
  tool: ToolDefinition;
  input: unknown;
  previewText: string;
  /** Why confirmation is required beyond the mode's default rule (e.g. a destructive pattern). */
  reason?: string;
  mode: ApprovalMode;
  /** Structured diff for the dialog (write_file). */
  diff?: FileDiff;
  resolve: (approved: boolean) => void;
}

/** A pending `ask_user` question set waiting for the UI (data-model § 5). */
export interface PendingQuestion {
  request: AskUserRequest;
  resolve: (outcome: AskUserOutcome) => void;
}
