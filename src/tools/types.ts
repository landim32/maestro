import type { z } from 'zod';
import type { ToolsSettings } from '../config/schema.js';

export type ToolName = 'read_file' | 'list_directory' | 'write_file' | 'run_command';

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  settings: ToolsSettings;
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
  requiresConfirmation: boolean;
  /** Text shown to the user before confirmation (diff, command…). */
  preview?: (input: I, ctx: ToolContext) => Promise<string>;
  run: (input: I, ctx: ToolContext) => Promise<ToolResult>;
}

export interface PendingToolAction {
  callId: string;
  tool: ToolDefinition;
  input: unknown;
  previewText: string;
  resolve: (approved: boolean) => void;
}
