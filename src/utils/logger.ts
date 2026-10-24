import fs from 'node:fs';
import path from 'node:path';
import { redact } from './mask.js';

export interface Logger {
  readonly enabled: boolean;
  readonly filePath?: string;
  log(event: string, data?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  enabled: boolean;
  filePath: string;
  /** Secrets that must never appear in the log (masked to ****xxxx). */
  secrets?: Array<string | undefined | null>;
}

export const noopLogger: Logger = { enabled: false, log: () => {} };

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      if (typeof v === 'bigint') return v.toString();
      return v;
    });
  } catch {
    return JSON.stringify(String(value));
  }
}

/** Appends JSON lines to `~/.maestro/debug.log` (only when --debug). Every line is redacted. */
export function createLogger(opts: LoggerOptions): Logger {
  if (!opts.enabled) return noopLogger;
  const secrets = opts.secrets ?? [];
  try {
    fs.mkdirSync(path.dirname(opts.filePath), { recursive: true });
  } catch {
    /* best effort */
  }
  return {
    enabled: true,
    filePath: opts.filePath,
    log(event, data) {
      const line = safeStringify({ ts: new Date().toISOString(), event, ...(data ?? {}) });
      try {
        fs.appendFileSync(opts.filePath, redact(line, secrets) + '\n', 'utf8');
      } catch {
        /* never let logging break the CLI */
      }
    },
  };
}
