import Anthropic from '@anthropic-ai/sdk';
import type { MaestroError } from '../utils/errors.js';
import { createAnthropicErrorMapper, streamAnthropicProtocol } from './anthropicProtocol.js';
import { CREDENTIAL_HINTS, describeProvider, DISPLAY_NAMES } from './status.js';
import type { ModelProvider, ProviderContext, ProviderEvent, ProviderRequest } from './types.js';

export {
  SERVER_SIDE_FALLBACK_BETA,
  toAnthropicMessages,
  toAnthropicTools,
} from './anthropicProtocol.js';

/** Maps Anthropic SDK errors for the Claude provider (kept for the connection test and tests). */
export function mapAnthropicError(err: unknown, ctx: ProviderContext): MaestroError {
  return createAnthropicErrorMapper({
    providerId: 'claude',
    secrets: [ctx.settings.providers.claude.apiKey, (ctx.env ?? process.env)['ANTHROPIC_API_KEY']],
    credentialsMissing: ctx.credentialSources.claude === 'none',
    missingHint: CREDENTIAL_HINTS.claude,
    rejectedHint: 'Check ANTHROPIC_API_KEY / your ant profile, or providers.claude.apiKey.',
    baseUrl: ctx.settings.providers.claude.baseUrl,
    endpointName: 'the Anthropic API',
  })(err);
}

export function createClaudeProvider(ctx: ProviderContext): ModelProvider {
  const cfg = ctx.settings.providers.claude;
  const client = new Anthropic({
    apiKey: cfg.apiKey ?? undefined,
    baseURL: cfg.baseUrl ?? undefined,
    maxRetries: 2,
  });

  return {
    id: 'claude',
    displayName: DISPLAY_NAMES.claude,
    capabilities: { images: true },
    status: () => describeProvider('claude', ctx),
    stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
      return streamAnthropicProtocol({
        client,
        providerId: 'claude',
        req,
        model: req.model ?? cfg.model,
        maxTokens: cfg.maxTokens,
        effort: cfg.effort,
        fallbacks: cfg.fallbacks,
        mapError: (err) => mapAnthropicError(err, ctx),
      });
    },
  };
}
