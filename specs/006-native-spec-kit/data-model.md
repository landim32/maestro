# Data Model: Spec Kit Nativo no Maestro

**Feature**: `006-native-spec-kit` | **Date**: 2026-10-25

---

## 1. Comandos de prompt (`src/session/commands.ts`, `src/speckit/commands.ts`)

```ts
// commands.ts — o tipo existente ganha a variante "prompt"
export interface SlashCommand {
  name: string;
  aliases?: string[];
  usage?: string;
  description: string;
  /** Where the command came from (shown by /help): 'builtin' | 'project' | '<integration>' | 'bundled'. */
  origin?: string;
  run: (ctl: SessionController, args: string[]) => Promise<void | PromptTurn> | void | PromptTurn;
}

/** A command that runs a model turn with a composed prompt (data-model § 1). */
export interface PromptTurn {
  /** Text shown in the transcript and recorded in history (the typed line). */
  display: string;
  /** Full text sent to the model (preamble + command body with arguments). */
  prompt: string;
}
```

`executeSlash` devolve `{ handled: true, turn?: PromptTurn }`; `SessionController.submit` roda `runTurn` com `prompt` como mensagem do usuário e `display` como rótulo.

```ts
// providers/types.ts
export interface Message { …; /** Transcript label when the content is a composed prompt. */ display?: string }
```

---

## 2. Arquivo de comando Spec Kit (`src/speckit/discovery.ts`, `frontmatter.ts`)

```ts
export interface SpecKitCommandFile {
  name: string;              // 'speckit.plan' (ou 'speckit.bug.assess')
  path: string;              // absoluto
  origin: 'project' | 'bundled' | string; // 'project' = .maestro/commands; integração = seu id (ex. 'claude')
  description: string;
  scripts?: { sh?: string; ps?: string; py?: string };  // frontmatter 1.x
  handoffs?: Array<{ label: string; agent: string; prompt?: string; send?: boolean }>;
  tools?: string[];
  body: string;              // markdown sem a frontmatter
}

export interface Frontmatter { data: Record<string, unknown>; body: string }
export function parseFrontmatter(text: string): Frontmatter;   // YAML mínimo (R8)
export function discoverCommands(cwd: string, env?: NodeJS.ProcessEnv): SpecKitCommandFile[];
export function renderCommandBody(file: SpecKitCommandFile, args: string): string; // $ARGUMENTS / {ARGS}
```

**Precedência**: `.maestro/commands/` → pasta da integração ativa (`.specify/integration.json`) → embutidos (`assets/speckit/commands/`). Primeiro nome vence.

**Preflight** (R5): `preflightFor(file): StepRequest | undefined` — da frontmatter `scripts.sh` ou da tabela por nome.

---

## 3. Passos nativos (`src/speckit/steps/*.ts`, `invocation.ts`)

```ts
export type StepRequest =
  | { step: 'create-feature'; description: string; shortName?: string; number?: string; timestamp?: boolean;
      dryRun?: boolean; allowExisting?: boolean; json: boolean }
  | { step: 'setup-plan'; json: boolean }
  | { step: 'setup-tasks'; json: boolean }
  | { step: 'check-prerequisites'; json: boolean; requireSpec?: boolean; requireTasks?: boolean;
      includeTasks?: boolean; pathsOnly?: boolean; template?: string }
  | { step: 'resolve-template'; name: string; json: boolean }
  | { step: 'update-agent-context'; agentType?: string; planPath?: string };

export interface StepResult { ok: boolean; output: string; summary: string; data?: Record<string, unknown> }

/** Recognises the three script dialects; undefined when the command is not a Spec Kit script. */
export function parseInvocation(command: string): StepRequest | undefined;
export function runStep(req: StepRequest, ctx: StepContext): Promise<StepResult>;

export interface StepContext {
  cwd: string;                   // pasta de trabalho da sessão
  env: NodeJS.ProcessEnv;
  git: GitPort;                  // injetável nos testes
  assets: AssetsPort;            // templates embutidos
  settings: { createBranch: boolean };
  now?: () => Date;
}
```

**Saídas JSON** (compatíveis com os scripts; chaves extras permitidas):

| Passo | JSON |
|---|---|
| create-feature | `{ BRANCH_NAME, SPEC_FILE, FEATURE_NUM, FEATURE_DIR, HAS_GIT, DRY_RUN? }` |
| setup-plan | `{ FEATURE_SPEC, IMPL_PLAN, FEATURE_DIR, BRANCH, HAS_GIT }` |
| setup-tasks | `{ FEATURE_DIR, AVAILABLE_DOCS, TASKS_TEMPLATE, TASKS_TEMPLATE_CONTENT }` |
| check-prerequisites | `{ FEATURE_DIR, AVAILABLE_DOCS, TEMPLATE_CONTENT? }`; `--paths-only`: `{ REPO_ROOT, BRANCH, FEATURE_DIR, FEATURE_SPEC, IMPL_PLAN, TASKS }` |
| resolve-template | `{ TEMPLATE_NAME, TEMPLATE_CONTENT }` |
| update-agent-context | texto (`INFO:`/`✓` linhas) + `{ updated: string[], created: string[] }` em `data` |

Erros reproduzem as mensagens dos scripts (`ERROR: plan.md not found in <dir>` + `Run /speckit.plan first …`) com `ok: false`.

---

## 4. Feature e caminhos (`src/speckit/feature.ts`)

```ts
export interface FeaturePaths {
  REPO_ROOT: string; CURRENT_BRANCH: string; HAS_GIT: boolean; FEATURE_DIR: string;
  FEATURE_SPEC: string; IMPL_PLAN: string; TASKS: string; RESEARCH: string; DATA_MODEL: string;
  QUICKSTART: string; CONTRACTS_DIR: string;
  /** how the feature was found: 'env-dir' | 'env-name' | 'feature-json' | 'git-branch' | 'latest-dir' */
  source: string;
}
export function findSpecifyRoot(cwd): string | undefined;   // sobe até achar .specify/
export function resolveFeaturePaths(ctx, opts: { persist: boolean }): FeaturePaths; // ordem de R3
export function isFeatureName(name: string): boolean;        // ^\d{3,}- | ^\d{8}-\d{6}-
```

Regras de numeração (`numbering.ts`): sequencial = `max(branches locais e remotas, pastas specs/) + 1`, três dígitos mínimo; `timestamp` = `YYYYMMDD-HHMMSS`; `--number N` explícito é ajustado para o próximo livre quando o prefixo já existe em `specs/` (aviso).

Nomes (`naming.ts`): `cleanBranchName(shortName)` (minúsculas, não alfanumérico → `-`, colapso, trim); `generateBranchName(description)` (stop words do script, palavras ≥ 3 chars ou acrônimos em maiúsculas no original, 3 palavras ou 4 quando houver exatamente 4); `fitBranchName(num, suffix)` (≤ 244 bytes UTF‑8, corte em limite de caractere, sem hífen final).

---

## 5. Templates em camadas (`src/speckit/templates.ts`)

```ts
export interface TemplateLayer { path: string; strategy: 'replace' | 'prepend' | 'append' | 'wrap' }
export function resolveTemplatePath(name, root, assets): string | undefined;      // primeira camada
export function resolveTemplateContent(name, root, assets): string | undefined;   // composto (R6)
```

Ordem: overrides → presets (registry por prioridade, senão alfabética; `preset.yml` define estratégia) → extensions (registry, senão alfabética) → `.specify/templates/` → embutido. `wrap` exige `{CORE_TEMPLATE}`.

---

## 6. Instalação e manifesto (`src/speckit/init.ts`, `assets.ts`)

```ts
export interface InitOptions { upgrade?: boolean }
export interface InitReport { created: string[]; skipped: string[]; updated: string[]; kept: string[]; version: string; next: string }
export function initSpecKit(cwd: string, opts: InitOptions, assets: AssetsPort): InitReport;

export interface AssetsPort {
  version: string;                                   // 'v1.2.3'
  read(rel: string): string;                         // 'templates/spec-template.md'
  list(): string[];                                  // todos os caminhos relativos
}
export function bundledAssets(): AssetsPort;         // resolve assets/speckit ao lado do pacote
```

Manifesto `.specify/integrations/maestro.manifest.json`: `{ integration: 'maestro', version, installed_at, files: { '<rel>': '<sha256>' } }`. Upgrade: para cada arquivo embutido, `atual === manifesto` → substitui e atualiza hash; `atual !== manifesto` → `kept`; ausente → `created`.

Arquivos gerados por `init`:

| Destino | Origem |
|---|---|
| `.specify/memory/constitution.md` | `templates/constitution-template.md` (só se ausente) |
| `.specify/templates/{spec,plan,tasks,checklist,constitution,agent-file}-template.md` | embutidos |
| `.specify/scripts/{bash,powershell,python}/*` | embutidos (para outros agentes) |
| `.maestro/commands/speckit.<x>.md` | `templates/commands/<x>.md` renderizado |
| `.specify/init-options.json` | `{ feature_numbering: 'sequential', integration: 'maestro', script: 'sh', speckit_version }` (só se ausente) |
| `.specify/integration.json` | acrescenta `integration_settings.maestro = { invoke_separator: '.', commands_dir: '.maestro/commands' }`; `integration: 'maestro'` só se ausente |

---

## 7. Contexto do agente (`src/speckit/steps/agentContext.ts`) e do projeto (`src/config/projectContext.ts`)

```ts
export interface PlanFacts { language?: string; framework?: string; storage?: string; projectType?: string }
export function parsePlanFacts(planText: string): PlanFacts;           // **Language/Version**: …
export function updateAgentFile(path, facts, branch, template, now): 'created' | 'updated';
export const AGENT_FILES: Record<string, string>;                     // claude → CLAUDE.md, … (tabela 0.4.x) + maestro → MAESTRO.md

export interface ProjectContext { file: string; text: string; bytes: number; large: boolean }
export function loadProjectContext(cwd: string): ProjectContext | undefined;   // MAESTRO.md, senão CLAUDE.md
```

`buildSystemPrompt` ganha `projectContext?: ProjectContext` e anexa `# Project guidelines (<file>)` + texto.

---

## 8. Controller, turno e UI

```ts
// session/turn.ts
TurnOptions.intercept?: (tool: ToolDefinition, input: unknown) => Promise<ToolResult | undefined>;
// executado após a validação do input e antes de classifyAction; resultado definido encerra a chamada

// session/controller.ts
specKit: SpecKitService;            // discovery + steps + init (injetável: git, assets, clock)
commands = [...DEFAULT_COMMANDS, ...specKit.commands()]   // recarregado em /speckit.init
submitPrompt(turn: PromptTurn): Promise<TurnResult>       // usado por executeSlash

// ui/components/InputPrompt.tsx
commands: Array<{ name: string; description: string }>;    // sugestões ao digitar "/"
```

Comandos nativos: `/speckit.init [--upgrade]`, `/speckit.status` (feature atual, origem da resolução, artefatos ✓/✗, versão embutida e instalada).

Configuração: `speckit: { createBranch: boolean (true) }` em `settings.json` (global/projeto).
