# Data Model: Rotas por Modelo

**Feature**: `008-model-routes` | **Date**: 2026-10-25

---

## 1. Configuração (`src/config/schema.ts`, `src/config/defaults.ts`)

```ts
export const ROUTE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const routeNameSchema = z.string().regex(ROUTE_NAME_RE, 'nome de rota inválido (minúsculas, dígitos, ".", "-", "_")');

export const routeTargetSchema = z.strictObject({
  _comment: comment,
  provider: providerIdSchema,
  model: modelNameSchema,            // token único, sem espaços (mesma regra de providers.<id>.model)
  effort: effortSchema.optional(),   // só o Claude aplica
  maxTokens: z.number().int().min(1).optional(),
});

export const routesSettingsSchema = z
  .record(z.string(), z.union([comment, routeTargetSchema]))
  .superRefine(/* toda chave ≠ '_comment' precisa casar ROUTE_NAME_RE e ter um routeTarget */);

settingsSchema: routes: routesSettingsSchema.prefault({})
export type RouteTarget = z.infer<typeof routeTargetSchema>;
export type RoutesSettings = Record<string, RouteTarget>; // após remover _comment
```

`INITIAL_SETTINGS.routes = { _comment: 'routes.<nome>: { provider, model, effort?, maxTokens? }. chat segue o provedor ativo; cada comando (ex.: speckit.plan) segue chat; github e infra são rotas de propósito (/ask github …). Edite com /routes.' }`.

**Invariantes**: ausência de chave = padrão; `chat`, `github`, `infra` e nomes de comandos de prompt são rotas **conhecidas** mesmo sem chave; uma chave cujo nome não é conhecido é uma rota de propósito do usuário (precisa de alvo, o que o esquema já garante).

---

## 2. Catálogo de rotas (`src/routes/catalog.ts`, puro)

```ts
export const PURPOSE_ROUTES = ['chat', 'github', 'infra'] as const;   // fixas: redefiníveis, não removíveis
export const ROUTE_GUIDANCE: Record<'github' | 'infra', string>;        // bloco curto anexado ao prompt de sistema

export type RouteKind = 'purpose' | 'command';
export interface RouteEntry {
  name: string;
  kind: RouteKind;
  builtin: boolean;                  // chat/github/infra e comandos existentes
  target?: RouteTarget;              // undefined → segue (chat → ativo; demais → chat)
  follows?: 'active' | 'chat';
  origin: 'default' | 'global' | 'project';
  available: boolean;                // provedor do alvo (ou da rota seguida) configurado e habilitado
  missingCommand?: boolean;          // rota de comando configurada cujo comando não existe mais
  alias?: 'ok' | 'collides';         // rotas de propósito: atalho /<nome> disponível ou em colisão
}

export function routeEntries(input: {
  routes: RoutesSettings;
  commands: Array<{ name: string; kind?: 'prompt' }>;   // controller.commands
  statuses: ProviderStatus[];
  rawGlobal?: RoutesSettings;        // readRawSettings(globalPath).routes
  projectKeys?: string[];            // projectOverrides(['routes.<nome>' …])
}): RouteEntry[];                    // ordem: chat, github, infra, rotas do usuário (alfabética), comandos (ordem de controller.commands)

export function isPurposeRoute(name: string, entries: RouteEntry[]): boolean;
export function aliasCommands(entries: RouteEntry[], existing: string[]): SlashCommand[]; // /<rota> para propósito sem colisão
```

---

## 3. Resolução (`src/routes/resolve.ts`, puro)

```ts
export interface ResolveInput {
  forced?: string;                   // /ask <rota>, atalho, --route
  command?: string;                  // nome do comando de prompt em execução
  routes: RoutesSettings;
  statuses: ProviderStatus[];
  active: { provider: ProviderId; model: string };
}
export interface Resolved {
  route: string;                     // nome da rota efetivamente usada ('chat' quando caiu no padrão)
  target: { provider: ProviderId; model: string; effort?: Effort; maxTokens?: number };
  via: 'forced' | 'command' | 'chat' | 'active';
  fallbacks: Array<{ route: string; reason: 'unconfigured' | 'disabled' | 'unknown' }>;
}
export function resolveRoute(input: ResolveInput): Resolved;
```

Regras: `forced` desconhecida → `fallbacks += { route, reason: 'unknown' }` e segue (o `/ask` já bloqueou antes; `--route` em `-p` sai com código 2 antes de chegar aqui). Alvo com provedor indisponível → fallback e próximo passo. `chat` sem alvo → `via: 'active'`. Nunca lança.

---

## 4. Turno roteado

```ts
// providers/types.ts
export interface ProviderRequest { …; overrides?: { effort?: Effort; maxTokens?: number } }
export interface Message { …; route?: string }   // respostas: rota usada (ausente/undefined = chat)

// session/turn.ts
export interface TurnOptions { …; model?: string; overrides?: ProviderRequest['overrides']; route?: string }
// request: model: opts.model ?? session.modelOverride; overrides; pushAssistant(parts, provider.id, model, opts.route)

// session/session.ts
pushAssistant(parts, providerId, model?, route?)

// session/controller.ts
private providers = new Map<ProviderId, ModelProvider>();
providerFor(id): ModelProvider;             // cache por id; applySettings/switchProvider limpam
get activeProvider(): ModelProvider;        // providerFor(session.activeProviderId)
currentRoute?: string;                      // definido enquanto um turno roteado gera (barra de status)
submit(input, opts & { route?: string })    // route = forçada (-p --route)
chatWarned = false;                         // aviso único por sessão quando a chat cai no ativo
```

Fluxo em `submit`: comando de prompt → `PromptTurn { display, prompt, route? }`; `resolveRoute({ forced: turn.route ?? opts.route, command: slash.command?.kind === 'prompt' ? slash.command.name : undefined, … })` → avisos para `fallbacks` → `providerFor(target.provider)` → `runTurn(session, provider, { system: this.system + guidance(route), model: target.model, overrides, route })`. Log `route.resolve`.

---

## 5. Comandos (`src/session/commands.ts`, `src/speckit/prompt.ts`)

```ts
export interface SlashCommand { …; kind?: 'prompt' }        // chama o modelo → tem rota
export interface PromptTurn { display: string; prompt: string; route?: string }

/ask <rota> <pedido>   kind: 'prompt'; valida a rota (conhecida) e devolve { display: '/ask <rota> <pedido>', prompt: <pedido>, route }
/<rota> <pedido>       gerado por aliasCommands() para rotas de propósito sem colisão; mesmo efeito
/routes                abre o diálogo (interativo); em -p lista as rotas resolvidas em texto
```

`controller.commands` passa a ser recalculado (`refreshCommands`) também após gravar rotas (novo atalho) e após `applySettings`.

---

## 6. Diálogo `/routes` (`src/setup/routesFlow.ts`, puro; `src/setup/dialog.ts`)

```ts
export type DialogState = … | { type: 'routes'; flow: RoutesFlowState };

export interface RoutesFlowContext {
  entries: RouteEntry[];                 // routeEntries(...)
  statuses: ProviderStatus[];
  settings: Settings;                    // catálogo de modelos
  commandNames: string[];                // colisão de nomes ao criar rota
}

export type RoutesFlowState =
  | { step: 'list'; selected: number }                                   // índice em entries; entries.length → "Nova rota…"
  | { step: 'action'; route: string; options: RouteAction[]; selected: number }
  | { step: 'provider'; route: string; providers: ProviderChoice[]; selected: number }
  | { step: 'model'; route: string; providerId: ProviderId; models: string[]; selected: number } // models.length → "Digitar outro modelo…"
  | { step: 'custom'; route: string; providerId: ProviderId; value: string; error?: string }
  | { step: 'newRoute'; value: string; error?: string }
  | { step: 'applying'; route: string; action: 'set' | 'reset' | 'remove'; target?: RouteTarget; learn?: boolean }
  | { step: 'done'; message: string }
  | { step: 'failed'; error: string }
  | { step: 'closed' };

export type RouteAction = 'set' | 'reset' | 'remove' | 'back';   // reset = voltar ao padrão (builtin); remove = rotas do usuário
export type RoutesFlowEvent = { type: 'up' | 'down' | 'enter' | 'back' | 'cancel' } | { type: 'input'; value: string } | { type: 'applied'; message: string } | { type: 'applyError'; error: string };

export function initialRoutesFlow(ctx): RoutesFlowState;
export function routesFlowReducer(state, event, ctx): RoutesFlowState;
export function routesEffectsFor(state): { kind: 'none' | 'apply' | 'close' };
```

Validação em `newRoute`: formato (`ROUTE_NAME_RE`), não existente (rota ou comando), não vazio. Após `newRoute` válido → `provider` para a rota nova (uma rota do usuário sempre nasce com alvo).

Efeitos (`SetupDriver.runRoutesEffect`): `apply` → `writeSettings([{ path: `routes.${route}`, value: target | undefined }, ...rememberModel(provider, model)])` → `reloadSettings()` → `refreshCommands()` → `dispatchRoutes({ type: 'applied', message })`; erro → `applyError`. Log `routes.write { route, action }`.

---

## 7. UI

- `src/ui/dialogs/RoutesDialog.tsx`: `DialogFrame` + `SelectList` (lista com cabeçalhos e status `padrão`/`global`/`projeto`/`indisponível`/`comando ausente`), `TextField` para `custom`/`newRoute`, `ResultView` para `done`/`failed`. `DialogHost` roteia `type === 'routes'`.
- `MessageList`: linha dim `⇢ ${route} · ${providerId} / ${model}` acima de respostas com `route && route !== 'chat'`.
- `StatusBar`: prop `route?: string` → `thinking…  ·  rota: github`.
- `useSession`: expõe `currentRoute`.

---

## 8. CLI

- `args.ts`: `--route <rota>` (string). `index.ts`: valida contra as rotas conhecidas (entries) e passa `route` ao `runNonInteractive` → `controller.submit(prompt, { route })`; desconhecida → stderr + `EXIT.USAGE`.
- `/routes` em `-p`: imprime a tabela de rotas resolvidas (nome, provedor/modelo, origem, disponibilidade).
