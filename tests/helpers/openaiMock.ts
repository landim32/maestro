import { vi } from 'vitest';

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
export class APIConnectionTimeoutError extends APIConnectionError {
  constructor() {
    super('Request timed out.');
  }
}
export class NotFoundError extends APIError {}

export interface ScriptedCompletion {
  chunks: unknown[];
  /** Reject `create()` itself with this error. */
  rejectWith?: unknown;
  /** Throw during iteration after the chunks. */
  throwDuring?: unknown;
  hangUntilAbort?: boolean;
}

export const calls: Array<{ params: Record<string, unknown>; options: { signal?: AbortSignal } }> =
  [];
let script: ScriptedCompletion[] = [];

export function scriptCompletions(s: ScriptedCompletion[]) {
  script = [...s];
  calls.length = 0;
}

export const ctorSpy = vi.fn();

export default class OpenAIMock {
  static APIError = APIError;
  static AuthenticationError = AuthenticationError;
  static PermissionDeniedError = PermissionDeniedError;
  static RateLimitError = RateLimitError;
  static BadRequestError = BadRequestError;
  static APIConnectionError = APIConnectionError;
  static APIUserAbortError = APIUserAbortError;
  static APIConnectionTimeoutError = APIConnectionTimeoutError;
  static NotFoundError = NotFoundError;

  chat = {
    completions: {
      create: async (params: Record<string, unknown>, options: { signal?: AbortSignal } = {}) => {
        calls.push({ params, options });
        const s = script.shift() ?? { chunks: [] };
        if (s.rejectWith) throw s.rejectWith;
        const signal = options.signal;
        return {
          async *[Symbol.asyncIterator]() {
            for (const c of s.chunks) yield c;
            if (s.hangUntilAbort) {
              await new Promise<void>((resolve) => {
                if (signal?.aborted) return resolve();
                signal?.addEventListener('abort', () => resolve(), { once: true });
              });
              throw new APIUserAbortError();
            }
            if (s.throwDuring) throw s.throwDuring;
          },
        };
      },
    },
  };

  constructor(opts: unknown) {
    ctorSpy(opts);
  }
}
