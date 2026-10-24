/**
 * Masks a secret for display: only the last 4 characters are kept.
 * Keys with 4 characters or fewer are fully masked.
 */
export function mask(key: string | undefined | null): string {
  if (!key || key.length <= 4) return '****';
  return `****${key.slice(-4)}`;
}

/**
 * Replaces every occurrence of the given secrets inside an arbitrary string.
 * Used by loggers and error formatters so a raw key never reaches stdout/stderr/logs.
 */
export function redact(text: string, secrets: Array<string | undefined | null>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length > 4) out = out.split(s).join(mask(s));
  }
  return out;
}
