import { z } from 'zod';
import { DEFAULTS } from './defaults.js';

export const PROVIDER_IDS = ['claude', 'qwen'] as const;
export const providerIdSchema = z.enum(PROVIDER_IDS);

const comment = z.string().optional();

/** Empty string means "not set" so the generated file (apiKey: "") validates. */
const apiKeySchema = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().min(1, 'must not be empty').optional(),
);

const baseUrlSchema = z
  .string()
  .regex(/^https?:\/\/\S+$/, 'must start with http:// or https://')
  .transform((s) => s.replace(/\/+$/, ''));

const maxTokensSchema = z.number().int().min(1).max(200_000);

export const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

export const claudeProviderSchema = z.strictObject({
  _comment: comment,
  enabled: z.boolean().default(true),
  model: z.string().min(1, 'must not be empty').default(DEFAULTS.claude.model),
  maxTokens: maxTokensSchema.default(DEFAULTS.claude.maxTokens),
  apiKey: apiKeySchema,
  baseUrl: baseUrlSchema.optional(),
  effort: effortSchema.default(DEFAULTS.claude.effort),
  fallbacks: z.boolean().default(DEFAULTS.claude.fallbacks),
});

export const qwenProtocolSchema = z.enum(['openai', 'anthropic']);

export const qwenProviderSchema = z.strictObject({
  _comment: comment,
  enabled: z.boolean().default(false),
  /** Wire protocol of the endpoint: OpenAI-compatible (chat completions) or Anthropic-compatible (messages). */
  protocol: qwenProtocolSchema.default(DEFAULTS.qwen.protocol),
  model: z.string().min(1, 'must not be empty').default(DEFAULTS.qwen.model),
  maxTokens: maxTokensSchema.default(DEFAULTS.qwen.maxTokens),
  apiKey: apiKeySchema,
  /** Optional: defaults to the protocol's Qwen Cloud endpoint (see resolveQwenBaseUrl). */
  baseUrl: baseUrlSchema.optional(),
});

export const toolsSettingsSchema = z.strictObject({
  _comment: comment,
  enabled: z.boolean().default(DEFAULTS.tools.enabled),
  commandTimeoutMs: z.number().int().min(1000).default(DEFAULTS.tools.commandTimeoutMs),
  maxOutputChars: z.number().int().min(1000).default(DEFAULTS.tools.maxOutputChars),
});

export const uiSettingsSchema = z.strictObject({
  _comment: comment,
  color: z.boolean().optional(),
  /** Render in the terminal's alternate screen (restored on exit). */
  altScreen: z.boolean().default(true),
  /** Enable mouse-wheel scrolling (SGR mouse tracking) when stdout is a TTY. */
  mouse: z.boolean().default(true),
});

export const settingsSchema = z.strictObject({
  _comment: comment,
  activeProvider: providerIdSchema.default(DEFAULTS.activeProvider),
  providers: z
    .strictObject({
      claude: claudeProviderSchema.prefault({}),
      qwen: qwenProviderSchema.prefault({}),
    })
    .prefault({}),
  tools: toolsSettingsSchema.prefault({}),
  ui: uiSettingsSchema.prefault({}),
});

export type ProviderId = z.infer<typeof providerIdSchema>;
export type Effort = z.infer<typeof effortSchema>;
export type ClaudeProviderSettings = z.infer<typeof claudeProviderSchema>;
export type QwenProviderSettings = z.infer<typeof qwenProviderSchema>;
export type ToolsSettings = z.infer<typeof toolsSettingsSchema>;
export type UiSettings = z.infer<typeof uiSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;

/** Renders zod issues as `path.to.field: reason` lines (one per problem). */
export function formatZodIssues(error: z.ZodError): string[] {
  const lines: string[] = [];
  for (const issue of error.issues) {
    const base = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      for (const key of (issue as { keys: string[] }).keys) {
        lines.push(`${[...base, key].join('.')}: unknown key`);
      }
      continue;
    }
    const p = base.length ? base.join('.') : '<root>';
    lines.push(`${p}: ${issue.message}`);
  }
  return lines;
}
