import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { resolveQwenBaseUrl } from '../config/defaults.js';
import type { ToolDefinition } from '../tools/types.js';
import { MaestroError, retryAfterFrom, sanitizeCause } from '../utils/errors.js';
import { redact } from '../utils/mask.js';
import { createAnthropicErrorMapper, streamAnthropicProtocol } from './anthropicProtocol.js';
import { CREDENTIAL_HINTS, describeProvider, DISPLAY_NAMES } from './status.js';
import type {
  Message,
  ModelProvider,
  ProviderContext,
  ProviderEvent,
  ProviderRequest,
  StopReason,
} from './types.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

/** Neutral history → OpenAI-compatible chat messages (contracts/provider-interface.md § 4.2). */
export function toOpenAIMessages(system: string, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = m.content
        .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      out.push({ role: 'user', content: text });
    } else if (m.role === 'assistant') {
      const text = m.content
        .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('');
      const toolCalls = m.content
        .filter((p): p is Extract<typeof p, { type: 'tool_call' }> => p.type === 'tool_call')
        .map((p) => ({
          id: p.callId,
          type: 'function' as const,
          function: { name: p.name, arguments: JSON.stringify(p.input ?? {}) },
        }));
      out.push({
        role: 'assistant',
        content: text === '' ? null : text,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // One `tool` message per result.
      for (const p of m.content) {
        if (p.type !== 'tool_result') continue;
        out.push({
          role: 'tool',
          tool_call_id: p.callId,
          content: p.isError ? `ERROR: ${p.output}` : p.output,
        });
      }
    }
  }
  return out;
}

export function toOpenAITools(tools: ToolDefinition[]): ChatTool[] {
  return tools.map((t) => {
    const schema = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
    delete schema['$schema'];
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: { ...schema, type: 'object' },
      },
    };
  });
}

function mapFinishReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

function qwenSecrets(ctx: ProviderContext): Array<string | undefined> {
  return [ctx.settings.providers.qwen.apiKey, (ctx.env ?? process.env)['DASHSCOPE_API_KEY']];
}

export function mapOpenAIError(err: unknown, ctx: ProviderContext): MaestroError {
  const clean = (s: string) => redact(s, qwenSecrets(ctx));
  const base = { providerId: 'qwen' as const, cause: sanitizeCause(err, clean) };
  const baseUrl = resolveQwenBaseUrl(ctx.settings.providers.qwen);

  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
    return new MaestroError({
      ...base,
      category: 'auth',
      message: `the API key was rejected (${err.status})`,
      hint: CREDENTIAL_HINTS.qwen.replace('missing', 'missing or invalid'),
    });
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new MaestroError({
      ...base,
      category: 'rate_limit',
      message: 'too many requests — wait a moment and retry',
      retryAfterMs: retryAfterFrom(err),
    });
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new MaestroError({
      ...base,
      category: 'network',
      message: clean(err.message || 'could not reach the Qwen endpoint'),
      hint: `Check providers.qwen.baseUrl (${baseUrl}).`,
    });
  }
  if (
    err instanceof OpenAI.BadRequestError &&
    /context.?length|maximum context|too long|exceed/i.test(err.message)
  ) {
    return new MaestroError({
      ...base,
      category: 'context_length',
      message: 'the conversation is too long for this model',
      hint: 'Use /clear to start over.',
    });
  }
  if (err instanceof OpenAI.APIError) {
    return new MaestroError({
      ...base,
      category: 'provider',
      message: clean(`API error ${err.status ?? ''}: ${err.message}`.trim()),
    });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new MaestroError({ ...base, category: 'unknown', message: clean(msg) });
}

/** Error mapper for the Anthropic-compatible Qwen endpoint. */
export function mapQwenAnthropicError(err: unknown, ctx: ProviderContext): MaestroError {
  return createAnthropicErrorMapper({
    providerId: 'qwen',
    secrets: qwenSecrets(ctx),
    credentialsMissing: false,
    missingHint: CREDENTIAL_HINTS.qwen,
    rejectedHint: CREDENTIAL_HINTS.qwen.replace('missing', 'missing or invalid'),
    baseUrl: resolveQwenBaseUrl(ctx.settings.providers.qwen),
    endpointName: 'the Qwen endpoint',
  })(err);
}

export function createQwenProvider(ctx: ProviderContext): ModelProvider {
  const cfg = ctx.settings.providers.qwen;
  const env = ctx.env ?? process.env;
  const apiKey = env['DASHSCOPE_API_KEY'] || cfg.apiKey;
  const baseURL = resolveQwenBaseUrl(cfg);

  const noKey = (): ProviderEvent => ({
    type: 'error',
    error: new MaestroError({
      providerId: 'qwen',
      category: 'auth',
      message: 'no API key configured',
      hint: CREDENTIAL_HINTS.qwen,
    }),
  });

  if (cfg.protocol === 'anthropic') {
    const client = apiKey ? new Anthropic({ apiKey, baseURL, maxRetries: 2 }) : undefined;
    return {
      id: 'qwen',
      displayName: DISPLAY_NAMES.qwen,
      status: () => describeProvider('qwen', ctx),
      async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
        if (!client) {
          yield noKey();
          return;
        }
        // Anthropic-only extras (effort, server-side fallbacks) are not sent to third-party endpoints.
        yield* streamAnthropicProtocol({
          client,
          providerId: 'qwen',
          req,
          model: req.model ?? cfg.model,
          maxTokens: cfg.maxTokens,
          mapError: (err) => mapQwenAnthropicError(err, ctx),
        });
      },
    };
  }

  const client = apiKey ? new OpenAI({ apiKey, baseURL, maxRetries: 2 }) : undefined;

  return {
    id: 'qwen',
    displayName: DISPLAY_NAMES.qwen,
    status: () => describeProvider('qwen', ctx),

    async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
      if (!client) {
        yield noKey();
        return;
      }

      const pending = new Map<number, { id: string; name: string; args: string }>();
      let finish: string | null | undefined;
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      try {
        const stream = await client.chat.completions.create(
          {
            model: req.model ?? cfg.model,
            // Route adjustments (specs/008): only maxTokens applies here (effort is Anthropic-only).
            max_tokens: req.overrides?.maxTokens ?? cfg.maxTokens,
            messages: toOpenAIMessages(req.system, req.messages),
            ...(req.tools.length ? { tools: toOpenAITools(req.tools) } : {}),
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: req.signal },
        );

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (choice) {
            if (choice.delta.content) yield { type: 'text_delta', text: choice.delta.content };
            for (const tc of choice.delta.tool_calls ?? []) {
              const slot = pending.get(tc.index) ?? { id: '', name: '', args: '' };
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name += tc.function.name;
              if (tc.function?.arguments) slot.args += tc.function.arguments;
              pending.set(tc.index, slot);
            }
            if (choice.finish_reason) finish = choice.finish_reason;
          }
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            };
          }
        }

        for (const [index, slot] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
          let input: unknown = {};
          if (slot.args.trim() !== '') {
            try {
              input = JSON.parse(slot.args);
            } catch {
              yield {
                type: 'error',
                error: new MaestroError({
                  providerId: 'qwen',
                  category: 'provider',
                  message: `the model returned malformed JSON for tool '${slot.name}'`,
                }),
              };
              return;
            }
          }
          yield { type: 'tool_call', callId: slot.id || `call_${index}`, name: slot.name, input };
        }

        if (usage) yield { type: 'usage', ...usage };
        const stop = pending.size > 0 && finish !== 'length' ? 'tool_use' : mapFinishReason(finish);
        yield { type: 'done', stopReason: stop };
      } catch (err) {
        if (req.signal.aborted || err instanceof OpenAI.APIUserAbortError) {
          yield { type: 'done', stopReason: 'cancelled' };
          return;
        }
        yield { type: 'error', error: mapOpenAIError(err, ctx) };
      }
    },
  };
}
