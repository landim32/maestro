import { registerProvider } from './registry.js';
import { createClaudeProvider } from './claude.js';
import { createQwenProvider } from './qwen.js';
import { createClaudeCodeProvider } from './claudeCode.js';

registerProvider('claude', createClaudeProvider);
registerProvider('qwen', createQwenProvider);
registerProvider('claude-code', (ctx) => createClaudeCodeProvider(ctx));

export * from './registry.js';
export * from './status.js';
export type * from './types.js';
