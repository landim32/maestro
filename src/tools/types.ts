import type { z } from 'zod';
import type { ToolsSettings } from '../config/schema.js';
import type { ApprovalMode, ToolKind } from './approval.js';

export type ToolName = 'read_file' | 'list_directory' | 'write_file' | 'run_command' | 'ask_user';

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
  resolve: (approved: boolean) => void;
}

/** A pending `ask_user` question set waiting for the UI (data-model § 5). */
export interface PendingQuestion {
  request: AskUserRequest;
  resolve: (outcome: AskUserOutcome) => void;
}
