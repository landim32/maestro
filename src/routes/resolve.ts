/**
 * Route resolution for one turn (specs/008 contracts/route-resolution.md § 1–2). Pure.
 * Order: forced route → command route → chat → active provider/model.
 */
import type { Effort, ProviderId, RoutesSettings } from '../config/schema.js';
import type { ProviderStatus } from '../providers/types.js';
import { unavailableReason } from './catalog.js';

export type FallbackReason = 'unconfigured' | 'disabled' | 'unknown';

export interface ResolveInput {
  /** `/ask <route>`, a purpose shortcut or `--route`. */
  forced?: string;
  /** Name of the prompt command being executed. */
  command?: string;
  routes: RoutesSettings;
  statuses: readonly ProviderStatus[];
  active: { provider: ProviderId; model: string };
  /** Names considered valid for `forced` (purpose + command routes); undefined → any configured name. */
  known?: readonly string[];
}

export interface ResolvedTarget {
  provider: ProviderId;
  model: string;
  effort?: Effort;
  maxTokens?: number;
}

export interface Resolved {
  /** Route actually used (`chat` when the request fell back to the default). */
  route: string;
  target: ResolvedTarget;
  via: 'forced' | 'command' | 'chat' | 'active';
  fallbacks: Array<{ route: string; reason: FallbackReason; provider?: ProviderId }>;
}

export function resolveRoute(input: ResolveInput): Resolved {
  const fallbacks: Resolved['fallbacks'] = [];
  const tryRoute = (name: string, via: Resolved['via']): Resolved | undefined => {
    const target = input.routes[name];
    if (!target) return undefined;
    const reason = unavailableReason(input.statuses, target.provider);
    if (reason) {
      fallbacks.push({ route: name, reason, provider: target.provider });
      return undefined;
    }
    return {
      route: name,
      target: {
        provider: target.provider,
        model: target.model,
        effort: target.effort,
        maxTokens: target.maxTokens,
      },
      via,
      fallbacks,
    };
  };

  if (input.forced !== undefined) {
    const known = input.known ? input.known.includes(input.forced) : input.forced in input.routes;
    if (!known) fallbacks.push({ route: input.forced, reason: 'unknown' });
    else {
      const r = tryRoute(input.forced, 'forced');
      if (r) return r;
      // A known purpose/command route without a target follows chat (no fallback entry).
      if (!(input.forced in input.routes) && input.forced !== 'chat') {
        const viaChat = tryRoute('chat', 'chat');
        if (viaChat) return { ...viaChat, route: input.forced, via: 'forced' };
        return {
          route: input.forced,
          target: { ...input.active },
          via: 'forced',
          fallbacks,
        };
      }
    }
  }
  if (input.command !== undefined && input.command !== input.forced) {
    const r = tryRoute(input.command, 'command');
    if (r) return r;
  }
  const chat = tryRoute('chat', 'chat');
  if (chat) return chat;
  return { route: 'chat', target: { ...input.active }, via: 'active', fallbacks };
}

/** User-facing text of a fallback (contracts/route-resolution.md § 2). */
export function fallbackText(fb: Resolved['fallbacks'][number], usedChat: boolean): string {
  const reason =
    fb.reason === 'unknown'
      ? 'rota desconhecida'
      : fb.reason === 'disabled'
        ? `provedor ${fb.provider} desabilitado`
        : `provedor ${fb.provider} não configurado`;
  const target = fb.route === 'chat' || !usedChat ? 'usando o provedor ativo' : 'usando chat';
  return `Rota ${fb.route} indisponível (${reason}); ${target}.`;
}
