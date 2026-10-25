import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Effort } from '../config/schema.js';
import type { ToolDefinition } from '../tools/types.js';
import { MaestroError, sanitizeCause } from '../utils/errors.js';
import { redact } from '../utils/mask.js';
import type { Message, ProviderEvent, ProviderId, ProviderRequest, StopReason } from './types.js';

export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type BetaTool = Anthropic.Beta.BetaTool;

/** Neutral history → Anthropic message params (contracts/provider-interface.md § 4.1). */
export function toAnthropicMessages(messages: Message[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = m.content
        .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      // Images (specs/007) go before the text as base64 blocks.
      const images: BetaContentBlockParam[] = m.content
        .filter((p): p is Extract<typeof p, { type: 'image' }> => p.type === 'image')
        .map((p) => ({
          type: 'image',
          source: { type: 'base64', media_type: p.mediaType as never, data: p.data },
        }));
      out.push({
        role: 'user',
        content: images.length ? [...images, { type: 'text', text }] : text,
      });
    } else if (m.role === 'assistant') {
      const blocks: BetaContentBlockParam[] = [];
      for (const p of m.content) {
        if (p.type === 'text') {
          if (p.text.trim() !== '') blocks.push({ type: 'text', text: p.text });
        } else if (p.type === 'tool_call') {
          blocks.push({ type: 'tool_use', id: p.callId, name: p.name, input: p.input ?? {} });
        }
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    } else {
      // All tool results of one turn go into a single user message.
      const results: BetaContentBlockParam[] = m.content
        .filter((p): p is Extract<typeof p, { type: 'tool_result' }> => p.type === 'tool_result')
        .map((p) => ({
          type: 'tool_result',
          tool_use_id: p.callId,
          content: p.output,
          is_error: p.isError,
        }));
      if (results.length) out.push({ role: 'user', content: results });
    }
  }
  return out;
}

export function toAnthropicTools(tools: ToolDefinition[]): BetaTool[] {
  return tools.map((t) => {
    const schema = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
    delete schema['$schema'];
    return {
      name: t.name,
      description: t.description,
      input_schema: { ...schema, type: 'object' } as BetaTool['input_schema'],
    };
  });
}

function mapStopReason(reason: string | null): { stop: StopReason; contextExceeded?: boolean } {
  switch (reason) {
    case 'tool_use':
      return { stop: 'tool_use' };
    case 'max_tokens':
      return { stop: 'max_tokens' };
    case 'refusal':
      return { stop: 'refusal' };
    case 'model_context_window_exceeded':
      return { stop: 'end_turn', contextExceeded: true };
    default:
      return { stop: 'end_turn' };
  }
}

export interface AnthropicErrorMapperOptions {
  providerId: ProviderId;
  /** Values that must never appear in messages. */
  secrets: Array<string | undefined | null>;
  /** True when no credential at all could be resolved (changes the auth message/hint). */
  credentialsMissing: boolean;
  missingHint: string;
  rejectedHint: string;
  baseUrl?: string;
  endpointName: string;
}

/** Builds a mapper from Anthropic SDK errors to MaestroError for a given provider. */
export function createAnthropicErrorMapper(
  o: AnthropicErrorMapperOptions,
): (err: unknown) => MaestroError {
  const clean = (s: string) => redact(s, o.secrets);
  return (err) => {
    const base = { providerId: o.providerId, cause: sanitizeCause(err, clean) };
    if (
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError
    ) {
      return new MaestroError({
        ...base,
        category: 'auth',
        message: o.credentialsMissing
          ? 'no credentials were found'
          : `the credentials were rejected (${err.status})`,
        hint: o.credentialsMissing ? o.missingHint : o.rejectedHint,
      });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return new MaestroError({
        ...base,
        category: 'rate_limit',
        message: 'too many requests — wait a moment and retry',
      });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return new MaestroError({
        ...base,
        category: 'network',
        message: clean(err.message || `could not reach ${o.endpointName}`),
        hint: o.baseUrl ? `Check providers.${o.providerId}.baseUrl (${o.baseUrl}).` : undefined,
      });
    }
    if (
      err instanceof Anthropic.BadRequestError &&
      /context|too long|prompt is too long|maximum/i.test(err.message)
    ) {
      return new MaestroError({
        ...base,
        category: 'context_length',
        message: 'the conversation is too long for this model',
        hint: 'Use /clear to start over.',
      });
    }
    if (err instanceof Anthropic.APIError) {
      return new MaestroError({
        ...base,
        category: 'provider',
        message: clean(`API error ${err.status ?? ''}: ${err.message}`.trim()),
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new MaestroError({ ...base, category: 'unknown', message: clean(msg) });
  };
}

export interface AnthropicStreamOptions {
  client: Anthropic;
  providerId: ProviderId;
  req: ProviderRequest;
  model: string;
  maxTokens: number;
  /** Anthropic-only extras (omitted for compatible third-party endpoints). */
  effort?: Effort;
  fallbacks?: boolean;
  mapError: (err: unknown) => MaestroError;
}

/**
 * Streams one Messages-API turn and converts raw events into ProviderEvents
 * (contracts/provider-interface.md § 4.1). Shared by the Claude provider and the
 * Anthropic-compatible Qwen endpoint.
 */
export async function* streamAnthropicProtocol(
  o: AnthropicStreamOptions,
): AsyncIterable<ProviderEvent> {
  const { client, req, providerId } = o;
  // Route adjustments (specs/008) win over the provider settings.
  const maxTokens = req.overrides?.maxTokens ?? o.maxTokens;
  const effort = o.effort === undefined ? undefined : (req.overrides?.effort ?? o.effort);
  const params = {
    model: o.model,
    max_tokens: maxTokens,
    system: req.system,
    messages: toAnthropicMessages(req.messages),
    tools: req.tools.length ? toAnthropicTools(req.tools) : undefined,
    ...(effort ? { output_config: { effort } } : {}),
  };

  const stream = o.fallbacks
    ? client.beta.messages.stream(
        { ...params, betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: 'default' },
        { signal: req.signal },
      )
    : client.messages.stream(params as Anthropic.MessageStreamParams, { signal: req.signal });

  const pendingTools = new Map<number, { id: string; name: string; json: string }>();

  try {
    for await (const event of stream as AsyncIterable<Anthropic.Beta.BetaRawMessageStreamEvent>) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        pendingTools.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          json: '',
        });
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          const t = pendingTools.get(event.index);
          if (t) t.json += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        const t = pendingTools.get(event.index);
        if (t) {
          pendingTools.delete(event.index);
          let input: unknown = {};
          if (t.json.trim() !== '') {
            try {
              input = JSON.parse(t.json);
            } catch {
              yield {
                type: 'error',
                error: new MaestroError({
                  providerId,
                  category: 'provider',
                  message: `the model returned malformed JSON for tool '${t.name}'`,
                }),
              };
              return;
            }
          }
          yield { type: 'tool_call', callId: t.id, name: t.name, input };
        }
      }
    }

    const final = await stream.finalMessage();
    yield {
      type: 'usage',
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
    };

    const { stop, contextExceeded } = mapStopReason(final.stop_reason);
    if (contextExceeded) {
      yield {
        type: 'error',
        error: new MaestroError({
          providerId,
          category: 'context_length',
          message: 'the conversation exceeded the model context window',
          hint: 'Use /clear to start over.',
        }),
      };
      return;
    }
    const detail =
      stop === 'refusal' && final.stop_details && 'explanation' in final.stop_details
        ? (final.stop_details.explanation ?? undefined)
        : undefined;
    yield { type: 'done', stopReason: stop, detail };
  } catch (err) {
    if (req.signal.aborted || err instanceof Anthropic.APIUserAbortError) {
      yield { type: 'done', stopReason: 'cancelled' };
      return;
    }
    yield { type: 'error', error: o.mapError(err) };
  }
}
