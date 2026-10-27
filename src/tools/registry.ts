import type { ToolsSettings } from '../config/schema.js';
import type { SkillCatalog } from '../skills/catalog.js';
import { createLoadSkillTool } from './loadSkill.js';
import { askUserTool } from './askUser.js';
import { editFileTool } from './editFile.js';
import { listDirectoryTool } from './listDirectory.js';
import { readFileTool } from './readFile.js';
import { runCommandTool } from './runCommand.js';
import type { ToolDefinition, ToolName } from './types.js';
import { writeFileTool } from './writeFile.js';

/** Workspace tools (confined to the working directory). */
const WORKSPACE: ToolDefinition[] = [
  readFileTool as ToolDefinition,
  listDirectoryTool as ToolDefinition,
  editFileTool as ToolDefinition,
  writeFileTool as ToolDefinition,
  runCommandTool as ToolDefinition,
];

const ALL: ToolDefinition[] = [...WORKSPACE, askUserTool as ToolDefinition];

export function allTools(): ToolDefinition[] {
  return [...ALL];
}

export function workspaceTools(): ToolDefinition[] {
  return [...WORKSPACE];
}

export function getTool(name: ToolName): ToolDefinition | undefined {
  return ALL.find((t) => t.name === name);
}

/**
 * Tools available for a session according to settings. `ask_user` never touches the workspace,
 * so it stays available with `--no-tools` (contracts/ask-user.md § 6).
 */
export function toolsFor(
  settings: ToolsSettings,
  opts: { skills?: SkillCatalog } = {},
): ToolDefinition[] {
  if (!settings.enabled) return [askUserTool as ToolDefinition];
  // load_skill exists only when there is something to load (specs/013 FR-004).
  if (!opts.skills?.skills.length) return allTools();
  return [
    ...WORKSPACE,
    createLoadSkillTool(opts.skills) as ToolDefinition,
    askUserTool as ToolDefinition,
  ];
}

/** True when the list contains at least one workspace tool (drives the system prompt). */
export function hasWorkspaceTools(tools: ToolDefinition[]): boolean {
  return tools.some((t) => t.kind !== 'question');
}
