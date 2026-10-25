/**
 * Route catalogue (specs/008 data-model.md § 2): which routes exist, what each one resolves
 * to, where its value comes from and whether its provider is usable. Pure.
 */
import type { ProviderId, RouteTarget, RoutesSettings } from '../config/schema.js';
import { ROUTE_NAME_RE } from '../config/schema.js';
import type { ProviderStatus } from '../providers/types.js';
import type { PromptTurn } from '../speckit/prompt.js';

export const PURPOSE_ROUTES = ['chat', 'github', 'infra'] as const;
export type PurposeRoute = (typeof PURPOSE_ROUTES)[number];

/** Short guidance appended to the system prompt of a turn on these routes. */
export const ROUTE_GUIDANCE: Record<'github' | 'infra', string> = {
  github: [
    '# Route: github',
    'The user is working on GitHub tasks: branches, commits, pull requests, issues, reviews and',
    'repository settings. Prefer the `gh` CLI and git commands available in the working directory,',
    'follow the repository conventions (commit prefixes, PR templates) and never push, merge or',
    'delete without the user asking for it.',
  ].join('\n'),
  infra: [
    '# Route: infra',
    'The user is working on infrastructure: deployment, CI pipelines, containers, servers, networking',
    'and configuration. Favour reproducible commands and configuration files, explain the blast radius',
    'of destructive operations, and ask before anything that changes a live environment.',
  ].join('\n'),
};

export type RouteKind = 'purpose' | 'command';
export type RouteOrigin = 'default' | 'global' | 'project';

export interface RouteEntry {
  name: string;
  kind: RouteKind;
  /** chat/github/infra and routes of existing commands. */
  builtin: boolean;
  /** Configured target; undefined → follows (`chat` → active; others → chat). */
  target?: RouteTarget;
  follows?: 'active' | 'chat';
  /** Provider/model the route resolves to for display. */
  resolved: {
    provider: ProviderId;
    model: string;
    effort?: RouteTarget['effort'];
    maxTokens?: number;
  };
  origin: RouteOrigin;
  /** Provider of the resolved target is configured and enabled. */
  available: boolean;
  /** Command route configured for a command that no longer exists. */
  missingCommand?: boolean;
  /** Purpose routes: `/<name>` shortcut available or shadowed by a command. */
  alias?: 'ok' | 'collides';
}

export interface CommandLike {
  name: string;
  /** `prompt` commands get a route; `route` commands (/ask, shortcuts) are ignored here. */
  kind?: 'prompt' | 'route';
}

export interface RouteEntriesInput {
  routes: RoutesSettings;
  commands: readonly CommandLike[];
  statuses: readonly ProviderStatus[];
  active: { provider: ProviderId; model: string };
  /** `routes` of the raw global file (to tell global from project values). */
  rawGlobal?: RoutesSettings;
  /** `routes.<name>` keys the project file defines. */
  projectKeys?: readonly string[];
}

export function providerAvailable(statuses: readonly ProviderStatus[], id: ProviderId): boolean {
  const s = statuses.find((x) => x.id === id);
  return Boolean(s && s.enabled && s.configured);
}

/** Why a provider cannot serve a route (contracts/route-resolution.md § 2). */
export function unavailableReason(
  statuses: readonly ProviderStatus[],
  id: ProviderId,
): 'disabled' | 'unconfigured' | undefined {
  const s = statuses.find((x) => x.id === id);
  if (!s || !s.enabled) return 'disabled';
  if (!s.configured) return 'unconfigured';
  return undefined;
}

function originOf(
  name: string,
  routes: RoutesSettings,
  rawGlobal: RoutesSettings | undefined,
  projectKeys: readonly string[] | undefined,
): RouteOrigin {
  if (!(name in routes)) return 'default';
  if (projectKeys?.includes(`routes.${name}`)) return 'project';
  if (rawGlobal && !(name in rawGlobal)) return 'project';
  return 'global';
}

/**
 * All known routes in display order: chat, github, infra, user purpose routes (alphabetical),
 * command routes (in command order), then configured routes of missing commands.
 */
export function routeEntries(input: RouteEntriesInput): RouteEntry[] {
  const { routes, statuses, active } = input;
  const commands = input.commands.filter((c) => c.kind !== 'route');
  const promptNames = commands.filter((c) => c.kind === 'prompt').map((c) => c.name);
  const commandNames = new Set(commands.map((c) => c.name));
  const chatTarget = routes['chat'];
  const chatResolved = chatTarget
    ? {
        provider: chatTarget.provider,
        model: chatTarget.model,
        effort: chatTarget.effort,
        maxTokens: chatTarget.maxTokens,
      }
    : { provider: active.provider, model: active.model };

  const make = (name: string, kind: RouteKind, builtin: boolean, missing = false): RouteEntry => {
    const target = routes[name];
    const resolved = target
      ? {
          provider: target.provider,
          model: target.model,
          effort: target.effort,
          maxTokens: target.maxTokens,
        }
      : chatResolved;
    const entry: RouteEntry = {
      name,
      kind,
      builtin,
      target,
      follows: target ? undefined : name === 'chat' ? 'active' : 'chat',
      resolved,
      origin: originOf(name, routes, input.rawGlobal, input.projectKeys),
      available: providerAvailable(statuses, resolved.provider),
    };
    if (missing) entry.missingCommand = true;
    if (kind === 'purpose') entry.alias = commandNames.has(name) ? 'collides' : 'ok';
    return entry;
  };

  const out: RouteEntry[] = PURPOSE_ROUTES.map((n) => make(n, 'purpose', true));
  const known = new Set<string>([...PURPOSE_ROUTES, ...promptNames]);
  const user = Object.keys(routes)
    .filter((n) => !known.has(n) && !commandNames.has(n) && ROUTE_NAME_RE.test(n))
    .sort();
  // A configured name that matches a command which is not a prompt command is a stale command route.
  const stale = Object.keys(routes).filter((n) => !known.has(n) && commandNames.has(n));
  for (const n of user) out.push(make(n, 'purpose', false));
  for (const n of promptNames) out.push(make(n, 'command', true));
  for (const n of stale) out.push(make(n, 'command', false, true));
  return out;
}

/** True when `name` is a purpose route (built-in or created by the user). */
export function isPurposeRoute(name: string, entries: readonly RouteEntry[]): boolean {
  return entries.some((e) => e.name === name && e.kind === 'purpose');
}

export function findRoute(name: string, entries: readonly RouteEntry[]): RouteEntry | undefined {
  return entries.find((e) => e.name === name);
}

/** `chat, github, infra, review, speckit.plan, …` for notices. */
export function routeNamesText(entries: readonly RouteEntry[]): string {
  return entries
    .filter((e) => !e.missingCommand)
    .map((e) => e.name)
    .join(', ');
}

export interface AliasCommand {
  name: string;
  usage: string;
  description: string;
  kind: 'route';
  origin: string;
  run: (ctl: unknown, args: string[], rest?: string) => PromptTurn | void;
}

/** `/<route> <request>` shortcuts for purpose routes that do not collide with a command. */
export function aliasCommands(
  entries: readonly RouteEntry[],
  existing: readonly string[],
  onEmpty: (ctl: unknown, route: string) => void,
): AliasCommand[] {
  const taken = new Set(existing);
  return entries
    .filter((e) => e.kind === 'purpose' && e.name !== 'chat' && !taken.has(e.name))
    .map((e) => ({
      name: e.name,
      usage: `/${e.name} <pedido>`,
      description: `Envia o pedido pela rota ${e.name} (atalho de /ask ${e.name})`,
      kind: 'route' as const,
      origin: 'rota',
      run: (ctl: unknown, _args: string[], rest?: string) => {
        const text = (rest ?? '').trim();
        if (text === '') {
          onEmpty(ctl, e.name);
          return;
        }
        return { display: `/${e.name} ${text}`, prompt: text, route: e.name };
      },
    }));
}

/** Guidance block for a route (empty for chat and user routes). */
export function guidanceFor(route: string | undefined): string {
  if (route === 'github' || route === 'infra') return ROUTE_GUIDANCE[route];
  return '';
}
