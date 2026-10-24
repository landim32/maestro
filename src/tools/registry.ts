import type { ToolsSettings } from '../config/schema.js';
import { listDirectoryTool } from './listDirectory.js';
import { readFileTool } from './readFile.js';
import { runCommandTool } from './runCommand.js';
import type { ToolDefinition, ToolName } from './types.js';
import { writeFileTool } from './writeFile.js';

const ALL: ToolDefinition[] = [
  readFileTool as ToolDefinition,
  listDirectoryTool as ToolDefinition,
  writeFileTool as ToolDefinition,
  runCommandTool as ToolDefinition,
];

export function allTools(): ToolDefinition[] {
  return [...ALL];
}

export function getTool(name: ToolName): ToolDefinition | undefined {
  return ALL.find((t) => t.name === name);
}

/** Tools available for a session according to settings (empty when disabled). */
export function toolsFor(settings: ToolsSettings): ToolDefinition[] {
  return settings.enabled ? allTools() : [];
}
