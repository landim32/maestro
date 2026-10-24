import { vi } from 'vitest';

/* Minimal stand-in for @anthropic-ai/sdk: a default-export class with error classes as statics
 * and `messages.stream` / `beta.messages.stream` returning a scripted async-iterable stream. */

export class APIError extends Error {
  status: number | undefined;
  constructor(status: number | undefined, message: string) {
    super(message);
    this.status = status;
  }
}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class RateLimitError extends APIError {}
export class BadRequestError extends APIError {}
export class APIConnectionError extends APIError {
  constructor(message = 'Connection error.') {
    super(undefined, message);
  }
}
export class APIUserAbortError extends APIError {
  constructor() {
    super(undefined, 'Request was aborted.');
  }
}

export interface ScriptedStream {
  events: unknown[];
  final?: Record<string, unknown>;
  /** Throw this error during iteration (after `events`). */
  throwDuring?: unknown;
  /** Keep the stream open until the signal aborts (for cancel tests). */
  hangUntilAbort?: boolean;
}

export const calls: Array<{
  path: 'beta' | 'plain';
  params: Record<string, unknown>;
  options: { signal?: AbortSignal };
}> = [];
let script: ScriptedStream[] = [];

export function scriptStreams(s: ScriptedStream[]) {
  script = [...s];
  calls.length = 0;
}

function makeStream(s: ScriptedStream, options: { signal?: AbortSignal }) {
  const signal = options.signal;
  const stream = {
    async *[Symbol.asyncIterator]() {
      for (const ev of s.events) yield ev;
      if (s.hangUntilAbort) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new APIUserAbortError();
      }
      if (s.throwDuring) throw s.throwDuring;
    },
    async finalMessage() {
      if (signal?.aborted) throw new APIUserAbortError();
      return {
        stop_reason: 'end_turn',
        stop_details: null,
        usage: { input_tokens: 11, output_tokens: 7 },
        content: [],
        ...s.final,
      };
    },
  };
  return stream;
}

function nextStream(
  path: 'beta' | 'plain',
  params: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
) {
  calls.push({ path, params, options });
  const s = script.shift() ?? { events: [] };
  return makeStream(s, options);
}

export const ctorSpy = vi.fn();

export default class AnthropicMock {
  static APIError = APIError;
  static AuthenticationError = AuthenticationError;
  static PermissionDeniedError = PermissionDeniedError;
  static RateLimitError = RateLimitError;
  static BadRequestError = BadRequestError;
  static APIConnectionError = APIConnectionError;
  static APIUserAbortError = APIUserAbortError;

  messages = {
    stream: (p: Record<string, unknown>, o?: { signal?: AbortSignal }) => nextStream('plain', p, o),
  };
  beta = {
    messages: {
      stream: (p: Record<string, unknown>, o?: { signal?: AbortSignal }) =>
        nextStream('beta', p, o),
    },
  };

  constructor(opts: unknown) {
    ctorSpy(opts);
  }
}
