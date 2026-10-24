import readline from 'node:readline';
import type { ProviderId, ProviderStatus } from '../providers/types.js';
import { statusLabel } from '../providers/status.js';
import { EXIT } from './exitCodes.js';

export interface PreflightOptions {
  statuses: ProviderStatus[];
  activeId: ProviderId;
  interactive: boolean;
  stderr?: { write(s: string): unknown };
  /** Asks a yes/no question (interactive only). Default reads stdin. */
  ask?: (question: string) => Promise<boolean>;
}

export type PreflightResult =
  { ok: true; providerId: ProviderId; switched: boolean } | { ok: false; code: number };

async function askStdin(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    const a = answer.trim().toLowerCase();
    return a === '' || a === 'y' || a === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Verifies the active provider is usable; offers the first ready alternative otherwise
 * (contracts/cli.md § 5). Exit code 3 when nothing is usable.
 */
export async function preflight(opts: PreflightOptions): Promise<PreflightResult> {
  const err = opts.stderr ?? process.stderr;
  const active = opts.statuses.find((s) => s.id === opts.activeId);
  if (active?.configured) return { ok: true, providerId: active.id, switched: false };

  const label = active ? statusLabel(active) : 'unknown';
  const missing = active?.missing.length ? ` (missing: ${active.missing.join(', ')})` : '';
  err.write(`maestro: provider '${opts.activeId}' is ${label}${missing}\n`);
  if (active?.hint) err.write(`  hint: ${active.hint}\n`);

  const alt = opts.statuses.find((s) => s.id !== opts.activeId && s.configured);
  if (!alt) return { ok: false, code: EXIT.NO_PROVIDER };

  if (!opts.interactive) {
    err.write(`  Using '${alt.id}' instead.\n`);
    return { ok: true, providerId: alt.id, switched: true };
  }
  const ask = opts.ask ?? askStdin;
  const yes = await ask(`  Use '${alt.id}' (${alt.model}) instead? [Y/n] `);
  if (!yes) return { ok: false, code: EXIT.NO_PROVIDER };
  return { ok: true, providerId: alt.id, switched: true };
}
