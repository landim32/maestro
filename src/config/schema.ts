import { z } from 'zod';
import { APPROVAL_MODES } from '../tools/approval.js';
import { DEFAULTS } from './defaults.js';

export const PROVIDER_IDS = ['claude', 'qwen', 'claude-code', 'codex'] as const;
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

/**
 * Claude Code provider (specs/010): runs the user's installed `claude` binary, which handles its
 * own login (Claude.ai subscription). Maestro never reads or stores those credentials.
 */
export const claudeCodeProviderSchema = z.strictObject({
  _comment: comment,
  enabled: z.boolean().default(false),
  model: z.string().min(1, 'must not be empty').default(DEFAULTS.claudeCode.model),
  models: modelsSchema(DEFAULTS.claudeCode.models),
  effort: effortSchema.default(DEFAULTS.claudeCode.effort),
  /** Path to the executable; default: `claude` on PATH. */
  command: z.string().min(1, 'must not be empty').optional(),
});

/**
 * Codex provider (specs/012): runs the user's installed `codex` binary, which handles its own
 * login (ChatGPT subscription). Maestro never reads or stores those credentials.
 */
export const codexProviderSchema = z.strictObject({
  _comment: comment,
  enabled: z.boolean().default(false),
  model: z.string().min(1, 'must not be empty').default(DEFAULTS.codex.model),
  models: modelsSchema(DEFAULTS.codex.models),
  effort: effortSchema.default(DEFAULTS.codex.effort),
  /** Path to the executable; default: `codex` on PATH. */
  command: z.string().min(1, 'must not be empty').optional(),
});

/** Initial approval mode (contracts/approval-modes.md § 1); Tab changes it for the session only. */
export const approvalModeSchema = z.enum(APPROVAL_MODES);

export const toolsSettingsSchema = z.strictObject({
  _comment: comment,
  enabled: z.boolean().default(DEFAULTS.tools.enabled),
  commandTimeoutMs: z.number().int().min(1000).default(DEFAULTS.tools.commandTimeoutMs),
  maxOutputChars: z.number().int().min(1000).default(DEFAULTS.tools.maxOutputChars),
  /** Model rounds with tool calls per turn (Claude Code: 5 calls per round); 0 = no limit. */
  maxToolIterations: z.number().int().min(0).max(100_000).default(DEFAULTS.tools.maxToolIterations),
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

/** Autopilot (specs/011 data-model.md § 2): verification, per-story limits, commits, remote. */
export const autopilotSettingsSchema = z
  .strictObject({
    _comment: comment,
    verify: z
      .strictObject({
        _comment: comment,
        /** Commands that must exit 0; default: the package.json scripts test/lint/build. */
        command: z.array(z.string().min(1)).optional(),
        maxAttempts: z.number().int().min(0).max(10).default(DEFAULTS.autopilot.verifyMaxAttempts),
        timeoutMs: z.number().int().min(1000).default(DEFAULTS.autopilot.verifyTimeoutMs),
      })
      .prefault({}),
    limits: z
      .strictObject({
        _comment: comment,
        /** 0 = no limit; a cap must leave room for the 7 steps. */
        turns: z
          .number()
          .int()
          .min(0)
          .refine((n) => n === 0 || n >= 7, 'use 0 (sem limite) ou pelo menos 7')
          .default(DEFAULTS.autopilot.turns),
        /** 0 = no limit. Waits for a provider rate limit are not counted. */
        minutes: z.number().int().min(0).default(DEFAULTS.autopilot.minutes),
        /** 0 = no limit. */
        tokens: z.number().int().min(0).default(0),
      })
      .prefault({}),
    commitPrefix: z.enum(['fix:', 'feat:']).default('fix:'),
    /** Push the branch and open a PR after each story (never by default). */
    push: z.boolean().default(false),
    /** Merge the PR (requires push). */
    merge: z.boolean().default(false),
    prBase: z.string().min(1).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.merge && !a.push)
      ctx.addIssue({ code: 'custom', path: ['merge'], message: 'merge exige push: true' });
  });

/** Route names: lowercase, digits, `.`, `-`, `_` (specs/008 contracts/routes-config.md § 1). */
export const ROUTE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const routeNameSchema = z
  .string()
  .regex(ROUTE_NAME_RE, 'nome de rota inválido (minúsculas, dígitos, ".", "-", "_")');

/** Target of a route: provider + model, with optional per-route adjustments. */
export const routeTargetSchema = z.strictObject({
  _comment: comment,
  provider: providerIdSchema,
  model: z.string().regex(/^\S+$/, 'must be a single non-empty token'),
  effort: effortSchema.optional(),
  maxTokens: maxTokensSchema.optional(),
});

/**
 * `routes.<name>` → target. A missing key means "default": `chat` follows the active
 * provider/model and every other route follows `chat` (specs/008 data-model.md § 1).
 */
export const routesSettingsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((routes, ctx) => {
    for (const [name, value] of Object.entries(routes)) {
      if (name === '_comment') {
        if (typeof value !== 'string')
          ctx.addIssue({ code: 'custom', path: [name], message: 'must be a string' });
        continue;
      }
      if (!ROUTE_NAME_RE.test(name)) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'nome de rota inválido (minúsculas, dígitos, ".", "-", "_")',
        });
        continue;
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'must be an object { provider, model }',
        });
        continue;
      }
      const parsed = routeTargetSchema.safeParse(value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ ...issue, path: [name, ...issue.path] } as never);
        }
      }
    }
  })
  .transform((routes) => {
    const out: Record<string, string | z.infer<typeof routeTargetSchema>> = {};
    for (const [name, value] of Object.entries(routes)) {
      if (name === '_comment') {
        if (typeof value === 'string') out[name] = value;
        continue;
      }
      const parsed = routeTargetSchema.safeParse(value); // issues were reported by the refinement
      if (parsed.success) out[name] = parsed.data;
    }
    return out;
  });

export const settingsSchema = z.strictObject({
  _comment: comment,
  activeProvider: providerIdSchema.default(DEFAULTS.activeProvider),
  providers: z
    .strictObject({
      claude: claudeProviderSchema.prefault({}),
      qwen: qwenProviderSchema.prefault({}),
      'claude-code': claudeCodeProviderSchema.prefault({}),
      codex: codexProviderSchema.prefault({}),
    })
    .prefault({}),
  tools: toolsSettingsSchema.prefault({}),
  ui: uiSettingsSchema.prefault({}),
  speckit: speckitSettingsSchema.prefault({}),
  autopilot: autopilotSettingsSchema.prefault({}),
  routes: routesSettingsSchema.prefault({}),
});

export type ProviderId = z.infer<typeof providerIdSchema>;
export type Effort = z.infer<typeof effortSchema>;
export type ClaudeProviderSettings = z.infer<typeof claudeProviderSchema>;
export type QwenProviderSettings = z.infer<typeof qwenProviderSchema>;
export type ClaudeCodeProviderSettings = z.infer<typeof claudeCodeProviderSchema>;
export type CodexProviderSettings = z.infer<typeof codexProviderSchema>;
export type ToolsSettings = z.infer<typeof toolsSettingsSchema>;
export type UiSettings = z.infer<typeof uiSettingsSchema>;
export type SpecKitSettings = z.infer<typeof speckitSettingsSchema>;
export type AutopilotSettings = z.infer<typeof autopilotSettingsSchema>;
export type RouteTarget = z.infer<typeof routeTargetSchema>;
/** Validated routes without the `_comment` entry. */
export type RoutesSettings = Record<string, RouteTarget>;

/** `settings.routes` without `_comment` (the only non-object entry the schema allows). */
export function routesOf(settings: {
  routes: Record<string, string | RouteTarget>;
}): RoutesSettings {
  const out: RoutesSettings = {};
  for (const [name, value] of Object.entries(settings.routes)) {
    if (typeof value !== 'string') out[name] = value;
  }
  return out;
}
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
