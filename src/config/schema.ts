import { z } from 'zod';
import { APPROVAL_MODES } from '../tools/approval.js';
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

/**
 * Model catalogue of a provider (contracts/model-catalog.md § 1): single tokens, no duplicates.
 * An empty array means "not set" so it falls back to the provider default.
 */
function modelsSchema(defaults: readonly string[]) {
  return z.preprocess(
    (v) => (Array.isArray(v) && v.length === 0 ? undefined : v),
    z
      .array(z.string().regex(/^\S+$/, 'must be a single non-empty token'))
      .superRefine((models, ctx) => {
        const seen = new Set<string>();
        for (const m of models) {
          if (seen.has(m)) {
            ctx.addIssue({ code: 'custom', message: `duplicate model '${m}'` });
            return;
          }
          seen.add(m);
        }
      })
      .default([...defaults]),
  );
}

export const claudeProviderSchema = z.strictObject({
  _comment: comment,
  enabled: z.boolean().default(true),
  model: z.string().min(1, 'must not be empty').default(DEFAULTS.claude.model),
  models: modelsSchema(DEFAULTS.claude.models),
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
  models: modelsSchema(DEFAULTS.qwen.models),
  maxTokens: maxTokensSchema.default(DEFAULTS.qwen.maxTokens),
  apiKey: apiKeySchema,
  /** Optional: defaults to the protocol's Qwen Cloud endpoint (see resolveQwenBaseUrl). */
  baseUrl: baseUrlSchema.optional(),
});

/** Initial approval mode (contracts/approval-modes.md § 1); Tab changes it for the session only. */
export const approvalModeSchema = z.enum(APPROVAL_MODES);

export const toolsSettingsSchema = z.strictObject({
  _comment: comment,
  enabled: z.boolean().default(DEFAULTS.tools.enabled),
  commandTimeoutMs: z.number().int().min(1000).default(DEFAULTS.tools.commandTimeoutMs),
  maxOutputChars: z.number().int().min(1000).default(DEFAULTS.tools.maxOutputChars),
  approvalMode: approvalModeSchema.default(DEFAULTS.tools.approvalMode),
});

export const uiSettingsSchema = z.strictObject({
  _comment: comment,
  color: z.boolean().optional(),
  /** Render in the terminal's alternate screen (restored on exit). */
  altScreen: z.boolean().default(true),
  /** Enable mouse-wheel scrolling (SGR mouse tracking) when stdout is a TTY. */
  mouse: z.boolean().default(true),
  /** A paste with more lines than this becomes a `[Pasted text #N +L lines]` marker (specs/007). */
  pasteCollapseLines: z.number().int().min(1).default(DEFAULTS.ui.pasteCollapseLines),
  /** Largest text file accepted as an attachment (bytes). */
  attachMaxBytes: z.number().int().min(1024).default(DEFAULTS.ui.attachMaxBytes),
  /** Largest total of expanded attachments in one message (bytes). */
  attachMaxTotalBytes: z.number().int().min(1024).default(DEFAULTS.ui.attachMaxTotalBytes),
  /** Largest image accepted as an attachment (bytes). */
  imageMaxBytes: z.number().int().min(1024).default(DEFAULTS.ui.imageMaxBytes),
});

/** Native Spec Kit options (specs/006 contracts/init-and-context.md § 4). */
export const speckitSettingsSchema = z.strictObject({
  _comment: comment,
  /** `/speckit.specify` creates and checks out the feature branch when the project is a git repo. */
  createBranch: z.boolean().default(true),
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
  speckit: speckitSettingsSchema.prefault({}),
});

export type ProviderId = z.infer<typeof providerIdSchema>;
export type Effort = z.infer<typeof effortSchema>;
export type ClaudeProviderSettings = z.infer<typeof claudeProviderSchema>;
export type QwenProviderSettings = z.infer<typeof qwenProviderSchema>;
export type ToolsSettings = z.infer<typeof toolsSettingsSchema>;
export type UiSettings = z.infer<typeof uiSettingsSchema>;
export type SpecKitSettings = z.infer<typeof speckitSettingsSchema>;
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
