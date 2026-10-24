import type { ProviderId } from '../providers/types.js';

export type ErrorCategory =
  | 'auth'
  | 'network'
  | 'rate_limit'
  | 'context_length'
  | 'invalid_config'
  | 'provider'
  | 'tool'
  | 'unknown';

export interface MaestroErrorInit {
  category: ErrorCategory;
  message: string;
  providerId?: ProviderId;
  hint?: string;
  cause?: unknown;
}

/** User-facing error. `message` and `hint` must never contain secrets. */
export class MaestroError extends Error {
  readonly category: ErrorCategory;
  readonly providerId?: ProviderId;
  readonly hint?: string;
  override readonly cause?: unknown;

  constructor(init: MaestroErrorInit) {
    super(init.message);
    this.name = 'MaestroError';
    this.category = init.category;
    this.providerId = init.providerId;
    this.hint = init.hint;
    this.cause = init.cause;
  }
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const cause = (err as { cause?: unknown }).cause;
    if (cause) return errorCode(cause);
  }
  return undefined;
}

/** Converts any thrown value into a MaestroError (generic mapping; SDK-specific mapping lives in providers). */
export function toMaestroError(err: unknown, providerId?: ProviderId): MaestroError {
  if (err instanceof MaestroError) return err;

  const code = errorCode(err);
  const msg = err instanceof Error ? err.message : String(err);

  if (code && NETWORK_CODES.has(code)) {
    return new MaestroError({
      category: 'network',
      providerId,
      message: `Network error (${code}). Check your connection and the configured endpoint.`,
      cause: err,
    });
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new MaestroError({
      category: 'network',
      providerId,
      message: 'The request timed out or was aborted.',
      cause: err,
    });
  }
  if (err instanceof Error && err.name === 'ZodError') {
    return new MaestroError({
      category: 'invalid_config',
      providerId,
      message: `Invalid configuration: ${msg}`,
      cause: err,
    });
  }
  return new MaestroError({
    category: 'unknown',
    providerId,
    message: msg || 'Unknown error',
    cause: err,
  });
}

const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  auth: 'authentication failed',
  network: 'network unavailable',
  rate_limit: 'rate limit exceeded',
  context_length: 'conversation too long',
  invalid_config: 'invalid configuration',
  provider: 'provider error',
  tool: 'tool error',
  unknown: 'error',
};

export interface SanitizedCause {
  name: string;
  message: string;
  stack?: string;
  status?: number;
}

/**
 * Copies the displayable parts of an SDK error with `clean` applied, so a `cause` kept for
 * debugging can never leak a key through its message or stack.
 */
export function sanitizeCause(err: unknown, clean: (s: string) => string): SanitizedCause {
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    return {
      name: err.name,
      message: clean(err.message),
      stack: err.stack ? clean(err.stack) : undefined,
      status: typeof status === 'number' ? status : undefined,
    };
  }
  return { name: 'Error', message: clean(String(err)) };
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.stack ?? cause.message;
  if (typeof cause === 'object' && cause !== null) {
    const c = cause as Partial<SanitizedCause>;
    if (typeof c.stack === 'string') return c.stack;
    if (typeof c.message === 'string') return `${c.name ?? 'Error'}: ${c.message}`;
  }
  return String(cause);
}

/** Human-readable, secret-free rendering. `cause` is only shown in debug mode. */
export function formatError(err: MaestroError, opts: { debug?: boolean } = {}): string {
  const who = err.providerId ? `${err.providerId}: ` : '';
  let out = `${who}${CATEGORY_LABEL[err.category]} — ${err.message}`;
  if (err.hint) out += `\n  hint: ${err.hint}`;
  if (opts.debug && err.cause !== undefined) out += `\n  cause: ${describeCause(err.cause)}`;
  return out;
}
