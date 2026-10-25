---

description: "Task list for Spec Kit Nativo no Maestro"
---

# Tasks: Spec Kit Nativo no Maestro

**Input**: Design documents from `/specs/006-native-spec-kit/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (speckit-commands.md, native-steps.md, init-and-context.md), quickstart.md

**Tests**: O plano define a estratégia (research R13 e § "Testes que fixam este contrato" de cada contrato): passos nativos testados sobre repositórios git temporários reais, JSON comparado com amostras dos scripts 0.4.x e 1.x, fluxo `specify → plan → tasks` com `FakeProvider` que "executa" os scripts via `run_command`, UI com `mountApp`. As tarefas de teste abaixo implementam exatamente esses casos. Nenhum teste acessa a rede; os assets são baixados uma única vez na Fase 1 e versionados no repositório.

**Organization**: Tarefas por história de usuário. Nenhuma dependência nova de runtime. O módulo novo é `src/speckit/`; os assets ficam em `assets/speckit/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: História a que a tarefa pertence (US1, US2, US3, US4)
- Caminhos exatos em cada descrição

## Path Conventions

Projeto único: `src/`, `tests/`, `assets/` na raiz, conforme plan.md § Project Structure.

---

## Phase 1: Setup (Assets e atribuição)

**Purpose**: Trazer o Spec Kit v1.2.3 para o pacote com a atribuição exigida e um helper de teste para repositórios temporários.

- [x] T001 Baixar do spec-kit tag `v1.2.3` (commit `8ac9e8103319d98099cfc274a2517bb2b621626c`) para `assets/speckit/`: `templates/{spec,plan,tasks,checklist,constitution}-template.md`, `templates/commands/{analyze,checklist,clarify,constitution,converge,implement,plan,specify,tasks,taskstoissues}.md`, `scripts/bash/*.sh`, `scripts/powershell/*.ps1`, `scripts/python/*.py`; copiar `.specify/templates/agent-file-template.md` (0.4.5) para `assets/speckit/templates/agent-file-template.md`; gravar `assets/speckit/VERSION` (`v1.2.3 8ac9e8103319d98099cfc274a2517bb2b621626c 2026-10-22`)
- [x] T002 Aplicar as modificações do Maestro aos comandos embutidos: em `assets/speckit/templates/commands/specify.md` substituir os passos 2–3 (branch via hook, criação manual do diretório) por "Run `{SCRIPT}` with `--json --short-name "<short-name>" "<description>"` and parse BRANCH_NAME, SPEC_FILE, FEATURE_DIR, FEATURE_NUM" com frontmatter `scripts: { sh: scripts/bash/create-new-feature.sh --json, ps: scripts/powershell/create-new-feature.ps1 -Json, py: scripts/python/create_new_feature.py --json }`; em `assets/speckit/templates/commands/plan.md` acrescentar à Phase 1 o passo "Agent context update: run `scripts/bash/update-agent-context.sh`"; registrar ambas em `assets/speckit/NOTICE` (MIT, Copyright (c) GitHub, Inc., tag/commit, lista de arquivos e modificações)
- [x] T003 [P] Em `THIRD_PARTY_NOTICES.md`, adicionar a seção **spec-kit** (repositório, tag, commit, MIT, copyright, tabela de arquivos em `assets/speckit/`, modificações de T002, texto da licença MIT); em `README.md` § Créditos, citar o spec-kit; em `package.json`, adicionar `assets` a `files`
- [x] T004 [P] Criar `tests/helpers/tempRepo.ts`: `withTempRepo({ git?: boolean; specify?: 'none' | '0.4' | '1.x'; commandsDir?: string })` que cria uma pasta temporária, opcionalmente `git init` + commit inicial (via `execFileSync('git', …)`, usuário/e-mail locais), copia os templates de `assets/speckit/` para `.specify/templates/` quando pedido, grava `.specify/init-options.json`/`integration.json` conforme o dialeto, e devolve `{ root, cleanup, write(rel, text), read(rel), exists(rel), branch() }`
- [x] T005 [P] Estender `tests/unit/license/attribution.test.ts`: `THIRD_PARTY_NOTICES.md` contém `spec-kit` e `MIT License`; `assets/speckit/NOTICE` e `VERSION` existem; `package.json.files` contém `assets`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: O núcleo puro de `src/speckit/`: frontmatter, resolução de feature, nomes, numeração, templates, git, invocação e os seis passos nativos. Bloqueia todas as histórias.

- [x] T006 [P] Criar `src/speckit/frontmatter.ts` com `parseFrontmatter(text): { data, body }` — parser YAML mínimo para o subconjunto do spec-kit: escalares (`key: value`, aspas simples/duplas, booleanos), mapas aninhados por indentação (`scripts: { sh, ps, py }`), listas de escalares e de mapas (`handoffs:` com `- label:`), comentários `#`; sem frontmatter devolve `data = {}`
- [x] T007 [P] Criar `tests/unit/speckit/frontmatter.test.ts`: frontmatter dos dez comandos embutidos e dos nove de `.claude/commands/` é lida (`description`, `scripts`, `handoffs`, `tools`); arquivo sem frontmatter; valores com `:` dentro de aspas; indentação inválida → erro com linha
- [x] T008 [P] Criar `src/speckit/assets.ts` com `AssetsPort`, `bundledAssets()` (resolve `../../assets/speckit` a partir de `import.meta.url`, válido em `src/` e `dist/`), `version` lido de `VERSION`, `read(rel)`, `list()`
- [x] T009 [P] Criar `src/speckit/git.ts` com `GitPort` (`hasGit(root)`, `currentBranch(root)`, `branches(root)` locais + remotas sem o prefixo `remotes/<r>/`, `checkoutNew(root, name)`, `checkoutExisting(root, name)`, `isDirty(root)`, `remoteUrl(root)`) implementado com `execFileSync('git', …)` sem shell, e `nullGit` (sem git) para testes
- [x] T010 [P] Criar `src/speckit/naming.ts` com `cleanBranchName`, `generateBranchName` (stop words e regras de `create-new-feature.sh`: palavras ≥ 3 chars ou acrônimos em maiúsculas no original, 3 palavras ou 4 quando houver exatamente 4, fallback às 3 primeiras), `fitBranchName(num, suffix)` (≤ 244 bytes UTF‑8, corte em limite de caractere, sem `-` final) e `STOP_WORDS`
- [x] T011 [P] Criar `tests/unit/speckit/naming.test.ts`: `"I want to add user authentication"` → `user-auth`‑like (`user-authentication`), `"Implement OAuth2 integration for the API"` → `oauth2-integration-api`, acrônimo `API` mantido, Unicode (`é`) preservado, nome com só símbolos → vazio, sufixo de 300 bytes cortado sem hífen final
- [x] T012 [P] Criar `src/speckit/feature.ts` com `findSpecifyRoot(cwd)` (sobe até `.specify/`, senão raiz git, senão `cwd`), `isFeatureName`, `readFeatureJson`, `writeFeatureJson` (valor relativo), `resolveFeaturePaths(ctx, { persist })` na ordem de contracts/native-steps.md § 3 (env dir, env name, feature.json, branch git, pasta mais recente, erro) devolvendo `FeaturePaths` com `source`
- [x] T013 [P] Criar `src/speckit/numbering.ts` com `readInitOptions(root)` (`feature_numbering`, senão `branch_numbering`), `highestFromSpecs(specsDir)`, `highestFromBranches(branches)`, `nextFeatureNumber(root, git)` (max + 1, três dígitos), `timestampPrefix(now)`, `resolveExplicitNumber(root, n)` (ajuste em conflito com aviso)
- [x] T014 [P] Criar `src/speckit/templates.ts` com `resolveTemplatePath` e `resolveTemplateContent` (overrides → presets por `.registry`/alfabético com estratégias `replace|prepend|append|wrap` do `preset.yml` via `parseFrontmatter`‑style parser → extensions → `.specify/templates/` → embutido via `AssetsPort`); `wrap` exige `{CORE_TEMPLATE}`; erros com caminho
- [x] T015 [P] Criar `tests/unit/speckit/templates.test.ts` com `withTempRepo`: core, override vence, preset com `prepend`/`append`/`wrap`, registry por prioridade, extensão, fallback ao embutido quando `.specify/templates` não existe, `wrap` sem placeholder → erro
- [x] T016 Criar `src/speckit/invocation.ts` com `parseInvocation(command): StepRequest | undefined` conforme contracts/native-steps.md § 1–2: ignora prefixos (`pwsh -File`, `powershell -File`, `bash`, `sh`, `python3`, `py -3`, `&`, `./`), aceita caminhos relativos/absolutos sob `.specify/scripts/<dialeto>/` ou `scripts/<dialeto>/`, tokeniza com aspas simples/duplas e `'\''`, mapeia as opções das três grafias, posicional = descrição/nome; scripts desconhecidos e segmentos extras (`cd x && …`) → `undefined` só se nenhum segmento for script; opção desconhecida → `{ step, error }`
- [x] T017 [P] Criar `tests/unit/speckit/invocation.test.ts`: as nove invocações literais dos comandos de `.claude/commands/` (0.4.x PowerShell), as dez dos comandos v1.2.3 (bash e python), `--short-name "I'm Groot"`, `'I'\''m Groot'`, caminho absoluto Windows, `& '.specify/scripts/powershell/x.ps1' -Json`, `npm test` e `.specify/scripts/bash/outro.sh` → `undefined`, `--bogus` → erro
- [x] T018 Criar `src/speckit/steps/checkPrerequisites.ts`, `setupPlan.ts`, `setupTasks.ts`, `resolveTemplate.ts` (saídas e mensagens de erro de contracts/native-steps.md § 4; `--paths-only` sem persistir `feature.json`; `AVAILABLE_DOCS` na ordem research, data-model, contracts/, quickstart, tasks)
- [x] T019 Criar `src/speckit/steps/createFeature.ts` (research R4): nome/número, `--dry-run`, `--allow-existing-branch`, pasta + `spec.md` do template resolvido (vazio com aviso), `feature.json`, branch git quando `ctx.settings.createBranch && git.hasGit` (`checkoutNew`, ou `checkoutExisting` se já existir e `allowExisting`), aviso de working tree sujo, JSON `{ BRANCH_NAME, SPEC_FILE, FEATURE_NUM, FEATURE_DIR, HAS_GIT }`
- [x] T020 Criar `src/speckit/steps/agentContext.ts` com `AGENT_FILES` (tabela 0.4.x + `maestro: 'MAESTRO.md'`), `parsePlanFacts`, `createAgentFile(template, facts, branch, projectName, now)`, `updateAgentFile(text, facts, branch, now)` (Active Technologies sem duplicar, Recent Changes com 3, `Last updated`, frontmatter `.mdc`, seção manual intacta) e `runUpdateAgentContext(req, ctx)` (alvo pedido + `MAESTRO.md` sempre + existentes; texto no formato `INFO:`/`✓`)
- [x] T021 Criar `src/speckit/steps/index.ts` com `runStep(req, ctx): Promise<StepResult>` (dispatch, `summary` de uma linha por passo, erros → `ok: false`) e o tipo `StepContext`
- [x] T022 [P] Criar `tests/unit/speckit/feature.test.ts` (seis fontes de resolução, `persist` só quando branch/pasta, `CURRENT_BRANCH` = branch ou basename) e `tests/unit/speckit/numbering.test.ts` (branches locais/remotas + pastas, `010` em octal, timestamp, número explícito em conflito)
- [x] T023 [P] Criar `tests/unit/speckit/steps.test.ts` com `withTempRepo({ git: true, specify: '1.x' })`: create-feature (branch criada e ativa, spec do template, feature.json, dry-run, allow-existing, sem git, `createBranch: false`, working tree sujo avisado); setup-plan (copia uma vez); setup-tasks (exige plan e spec); check-prerequisites (todas as combinações, mensagens exatas); resolve-template; update-agent-context (cria `MAESTRO.md` e `CLAUDE.md`, segunda execução não duplica, mantém 3 mudanças e a seção manual)
- [x] T024 [P] Criar `tests/contract/speckit.test.ts`: para cada invocação literal dos comandos deste repositório (`.claude/commands/*.md`) e dos embutidos, `parseInvocation` + `runStep` num repo temporário produzem JSON com exatamente as chaves documentadas em contracts/native-steps.md § 4 (comparar com amostras fixas: `{"FEATURE_DIR":…,"AVAILABLE_DOCS":[…]}`, `{"FEATURE_SPEC":…,"IMPL_PLAN":…,"FEATURE_DIR":…,"BRANCH":…}` etc.)

**Checkpoint**: núcleo de `src/speckit/` verde e sem nenhuma dependência de UI/controller.

---

## Phase 3: User Story 1 — Rodar o fluxo Spec Kit de um projeto já inicializado (Priority: P1) 🎯 MVP

**Goal**: `/speckit.*` descobertos e executados como turnos de prompt; scripts interceptados e executados nativamente; preflight sem chamar o modelo; transcrição com `display`; sugestões no prompt; `-p`.

**Independent Test**: `tests/integration/speckit/flow.test.ts` + `tests/integration/ui/speckit.test.tsx` + `tests/contract/speckit.test.ts` (contracts/speckit-commands.md § 1–5).

- [x] T025 [US1] Criar `src/speckit/discovery.ts`: `discoverCommands(cwd, env)` com a precedência de contracts/speckit-commands.md § 1 (`.maestro/commands/`, pasta da integração ativa de `.specify/integration.json` via tabela `INTEGRATION_DIRS`, embutidos), filtro `speckit.*.md`/`speckit-*.md` (+ `*.prompt.md` para copilot), `SpecKitCommandFile` com `origin`, e `preflightFor(file)` (frontmatter `scripts.sh` → `parseInvocation`; senão tabela por nome: plan → setup-plan validação, tasks/analyze/checklist/implement/converge/clarify/taskstoissues → check-prerequisites com as opções de cada um, specify/constitution → nenhum)
- [x] T026 [P] [US1] Criar `src/speckit/preamble.ts` (texto de contracts/speckit-commands.md § 3) e `src/speckit/prompt.ts` com `renderCommandBody(file, args)` (`$ARGUMENTS` e `{ARGS}`; vazio quando sem argumentos) e `buildPromptTurn(file, args): PromptTurn` (`display = '/<name> <args>'.trim()`, `prompt = preâmbulo + corpo`)
- [x] T027 [P] [US1] Criar `tests/unit/speckit/discovery.test.ts` (precedência, origem, integração TOML ignorada, `preflightFor` dos dois dialetos) e `tests/unit/speckit/prompt.test.ts` (render, preâmbulo presente, `display` curto)
- [x] T028 [US1] Em `src/session/commands.ts`: `SlashCommand.origin?`, tipo `PromptTurn`, `run` pode devolver `PromptTurn`; `parseSlash` passa a devolver também `rest` (texto bruto após o nome); `executeSlash` devolve `{ handled: boolean; turn?: PromptTurn }`; `/help` ganha a seção "Spec Kit (embutido vX · projeto: <pasta>)" listando comandos descobertos com descrição e origem (contracts/speckit-commands.md § 1)
- [x] T029 [US1] Em `src/providers/types.ts` adicionar `Message.display?: string`; em `src/session/session.ts`, `pushUser(text, display?)`; em `src/ui/components/MessageList.tsx`, renderizar `message.display ?? textOf(message)` para mensagens do usuário
- [x] T030 [US1] Em `src/session/turn.ts`: `TurnOptions.intercept?: (tool, input) => Promise<ToolResult | undefined>` chamado em `executeTool` após a validação do input e antes de `classifyAction`; resultado definido → `onToolStart`/`onToolEnd` não são chamados e o resultado vai direto ao modelo
- [x] T031 [US1] Criar `src/speckit/service.ts` com `SpecKitService` (`constructor({ cwd, env, git, assets, settings, logger, now })`, `commands(): SlashCommand[]` (descobertos como comandos de prompt com preflight embutido no `run`: falha → `ctl.notice(warn)` e sem turno), `interceptor(): TurnOptions['intercept']` (`parseInvocation` → `runStep` → `ToolResult`; emite `onStep(result)`), `refresh()`), e `src/speckit/index.ts` reexportando a API pública
- [x] T032 [US1] Em `src/session/controller.ts`: opção `specKit?: SpecKitService`; `commands = [...DEFAULT_COMMANDS, ...specKit.commands()]` (recalculado em `refreshCommands()`); `submit()` trata `{ turn }` de `executeSlash` chamando `submitPrompt(turn)` (push do usuário com `display`, `runTurn` com `intercept`); avisos `⚙ speckit <passo> · <resumo>` / `⚠ speckit <passo>: <erro>` e log `speckit.step { step, ok, ms }` a partir de `onStep`
- [x] T033 [US1] Em `src/config/schema.ts` e `src/config/defaults.ts`, adicionar `speckit: z.strictObject({ _comment, createBranch: z.boolean().default(true) }).prefault({})` e `INITIAL_SETTINGS.speckit`; em `src/index.ts`, criar `SpecKitService` com `bundledAssets()`, git real e `loaded.settings.speckit`, passar ao controller (interativo e `-p`)
- [x] T034 [P] [US1] Em `src/ui/components/InputPrompt.tsx`: prop `commands: Array<{ name: string; usage?: string; description: string }>`; quando `value` começa com `/` e não tem espaço, renderizar até 6 linhas `  /nome  descrição` (prefixo, `flexShrink={0}`); `key.rightArrow` com o cursor no fim completa o primeiro (acrescenta espaço se `usage` tiver argumentos); em `src/ui/hooks/useSession.ts` expor `commands`; em `src/ui/App.tsx` passar ao prompt
- [x] T035 [P] [US1] Estender `tests/unit/session/commands.test.ts`: `executeSlash` devolve `turn` para um comando de prompt injetado; `/help` lista a seção Spec Kit com origem; `parseSlash` preserva `rest` com espaços internos
- [x] T036 [US1] Criar `tests/integration/speckit/flow.test.ts` com `withTempRepo({ git: true, specify: '0.4' })` + comandos copiados de `.claude/commands/` e `FakeProvider` com roteiro por requisição que (a) em `/speckit.specify` emite `run_command` `.specify/scripts/powershell/create-new-feature.ps1 -Json -ShortName "user-auth" "…"`, recebe o JSON, escreve `spec.md` via `write_file` em modo `auto-edit`, e responde; verificar branch `001-user-auth` ativa, `spec.md`, `feature.json`, nenhum `confirm` chamado para o script, aviso `⚙ speckit create-new-feature`, `display` da mensagem = `/speckit.specify …`; (b) `/speckit.plan` → `setup-plan.ps1 -Json` + `update-agent-context.ps1 -AgentType claude` → `plan.md`, `CLAUDE.md` e `MAESTRO.md`; (c) `/speckit.tasks` em `main` sem feature → aviso FR-005 e `provider.requests` vazio; (d) `-p "/speckit.status"` via `runNonInteractive` imprime a feature; (e) script desconhecido (`.specify/scripts/bash/outro.sh`) segue o fluxo normal de comando (confirmação em `default`)
- [x] T037 [US1] Criar `tests/integration/ui/speckit.test.tsx` com `mountApp` + `controller.specKit` apontando para um `withTempRepo`: digitar `/spec` mostra até 6 sugestões com `/speckit.specify`; `→` completa; Enter envia e a transcrição mostra `› /speckit.plan` e não o preâmbulo; `/help` mostra a seção Spec Kit; sugestões somem com espaço no texto
- [x] T038 [P] [US1] Estender `tests/integration/cli/nonInteractive.test.ts` (`-p "/speckit.tasks"` sem feature → stderr com `Run /speckit.specify first` e código 2) e `tests/contract/config-schema.test.ts` (`speckit.createBranch` padrão `true`, chave desconhecida rejeitada)

**Checkpoint**: US1 completa (quickstart 1–4, 6).

---

## Phase 4: User Story 2 — Perguntas de clarificação como diálogos (Priority: P2)

**Goal**: Perguntas dos comandos viram diálogos `ask_user`; respostas gravadas antes da próxima; Esc encerra a rodada preservando o gravado.

**Independent Test**: `tests/integration/speckit/clarify.test.ts` (contracts/speckit-commands.md § 3; spec US2).

- [x] T039 [US2] Em `src/speckit/preamble.ts`, detalhar a regra de perguntas: uma chamada `ask_user` por rodada (até 4 perguntas), opções sugeridas pelo comando como `label` (`A`, `B`, `C` + descrição), "Outro…" automático; após cada resposta gravar no artefato antes da próxima pergunta como o comando exige; resposta `User declined` → encerrar a rodada, manter o gravado e relatar o que ficou em aberto; sem usuário (`-p`) → seguir com a suposição padrão e registrá‑la em Assumptions
- [x] T040 [US2] Em `assets/speckit/templates/commands/clarify.md` e `specify.md` (seção de clarificações), acrescentar a nota "In Maestro, ask each question through the `ask_user` tool" nos pontos onde o texto pede para apresentar perguntas e aguardar; registrar em `assets/speckit/NOTICE`
- [x] T041 [US2] Criar `tests/integration/speckit/clarify.test.ts` com `mountApp` + repo temporário: `/speckit.clarify` com `FakeProvider` que chama `ask_user` (duas perguntas A/B/C), verificar o diálogo `Pergunta 1 de 2`, escolher, verificar que a segunda requisição recebeu `**Q1**: B` e que o modelo (roteiro) gravou na spec via `write_file` (modo `auto-edit`); repetir com Esc → `DECLINED_TEXT` e spec inalterada; em `-p`, a ferramenta devolve `NO_USER_TEXT` e o roteiro grava a suposição

**Checkpoint**: US2 completa (quickstart 5).

---

## Phase 5: User Story 3 — Iniciar o Spec Kit em um projeto novo (Priority: P2)

**Goal**: `/speckit.init [--upgrade]`, manifesto de hashes, `/speckit.status`, versão embutida visível.

**Independent Test**: `tests/unit/speckit/init.test.ts` + cenários 7–9 do quickstart.

- [x] T042 [US3] Criar `src/speckit/init.ts` com `renderBundledCommand(text, scripts)` (`{SCRIPT}` → `scripts.sh`, `{ARGS}` → `$ARGUMENTS`, `__SPECKIT_COMMAND_X__` → `/speckit.x` minúsculo com `.`, `/memory/` → `.specify/memory/`), `initSpecKit(cwd, { upgrade }, assets, git)` conforme contracts/init-and-context.md § 1 (criar só ausentes; `integration.json` merge; `init-options.json`; manifesto `.specify/integrations/maestro.manifest.json` com sha256; `--upgrade` igual/modificado/ausente), devolvendo `InitReport` e o texto do relatório (com o aviso sem git)
- [x] T043 [P] [US3] Criar `src/speckit/status.ts` com `statusText(ctx, assets)`: feature atual e `source`, artefatos ✓/✗ (spec, plan, research, data-model, contracts/, quickstart, tasks, checklists/), versão embutida × instalada (`init-options.json`/manifesto), pasta de comandos ativa e integração
- [x] T044 [US3] Em `src/session/commands.ts` (ou `src/speckit/service.ts` → `commands()`), registrar os comandos nativos `/speckit.init [--upgrade]` e `/speckit.status` (origem `Maestro`), funcionando em `-p`; após `init`, `ctl.refreshCommands()`; em `src/version.ts`/`src/cli/args.ts`, `versionText()` passa a incluir a linha `spec-kit <versão embutida>`
- [x] T045 [P] [US3] Criar `tests/unit/speckit/init.test.ts` com `withTempRepo({ git: true, specify: 'none' })`: criação completa (contagem e lista), idempotência (segunda execução sem alterações), `--upgrade` (arquivo igual substituído, modificado mantido e listado, ausente criado), merge de `integration.json` preservando `default_integration: claude`, sem git → aviso, comandos renderizados sem `{SCRIPT}`/`{ARGS}`/`__SPECKIT_COMMAND_` e com `.specify/memory/constitution.md`; `tests/unit/speckit/assets.test.ts`: `VERSION`, 10 comandos, 6 templates, 3 pastas de scripts, `NOTICE`
- [x] T046 [P] [US3] Estender `tests/integration/speckit/flow.test.ts`: fluxo completo em pasta nova (`/speckit.init` → `/speckit.specify` com os comandos embutidos (dialeto bash) → `/speckit.plan` → `/speckit.tasks`) e `/speckit.status` antes/depois; `tests/unit/cli/args.test.ts`: `--version` contém `spec-kit v`

**Checkpoint**: US3 completa (quickstart 7–9, 11).

---

## Phase 6: User Story 4 — Contexto do projeto para o modelo (Priority: P3)

**Goal**: `MAESTRO.md` (ou `CLAUDE.md`) no prompt de sistema; `update-agent-context` mantém `MAESTRO.md`.

**Independent Test**: `tests/unit/config/projectContext.test.ts` + `tests/unit/session/systemPrompt.test.ts` + quickstart 10.

- [x] T047 [P] [US4] Criar `src/config/projectContext.ts` com `loadProjectContext(cwd): ProjectContext | undefined` (`MAESTRO.md`, senão `CLAUDE.md`; `bytes`; `large = bytes > 24 * 1024`) e `PROJECT_CONTEXT_LIMIT`
- [x] T048 [US4] Em `src/session/systemPrompt.ts`, aceitar `projectContext?: ProjectContext` e anexar `# Project guidelines (<file>)` + texto ao final; em `src/index.ts`, carregar o contexto, logar `context.loaded { file, bytes }`, e emitir os avisos únicos de contracts/init-and-context.md § 3 (`CLAUDE.md` em uso; arquivo grande) no primeiro `change` do controller
- [x] T049 [P] [US4] Criar `tests/unit/config/projectContext.test.ts` (prioridade `MAESTRO.md` > `CLAUDE.md`, ausente, `large`) e `tests/unit/session/systemPrompt.test.ts` (seção anexada com o nome do arquivo; sem contexto o prompt é idêntico ao atual); estender `tests/unit/speckit/steps.test.ts` para confirmar que `update-agent-context` sempre cria/atualiza `MAESTRO.md` mesmo com `-AgentType claude`

**Checkpoint**: US4 completa (quickstart 10).

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T050 [P] Em `README.md`: seção **Spec Kit nativo** (comandos, descoberta e precedência, `/speckit.init`, dialetos de script executados nativamente, `speckit.createBranch`, `MAESTRO.md`, sugestões com →), atualizar "Uso" e a tabela de comandos
- [x] T051 [P] Em `CLAUDE.md` (Code Style e árvore): regras do módulo `src/speckit/` (passos puros sobre `StepContext`; nunca executar os scripts; interceptor antes da classificação de aprovação; `display` em mensagens de comando; assets em `assets/speckit/` com NOTICE e teste de atribuição; `MAESTRO.md` como contexto)
- [x] T052 Rodar `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm pack --dry-run` (confirmar `assets/speckit/**` no tarball); corrigir o que falhar
- [ ] T053 Executar o quickstart (`specs/006-native-spec-kit/quickstart.md`, cenários 1–11) em terminal real, de preferência com o Qwen ativo; registrar divergências como tarefas

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → US1 → (US2, US3, US4) → Polish**. US2, US3 e US4 dependem só de US1 (serviço, comandos de prompt, interceptor) e são independentes entre si.
- Dentro da Fase 2: T006–T015 em paralelo (arquivos distintos); T016 depende de nada mas seus testes (T017) usam os comandos de `.claude/commands/`; T018–T020 dependem de T012–T014 e T009; T021 depende de T018–T020; T022–T024 após T021.
- Dentro de US1: T025 → T026/T027 → T028 → T029 → T030 → T031 → T032 → T033; T034 em paralelo após T028; testes T035–T038 ao final.
- US3 depende de T042 → T043/T044 → T045/T046. US4: T047 → T048 → T049.

## Parallel Execution Examples

- **Setup**: T003, T004, T005 em paralelo após T001–T002.
- **Fundação**: T006, T008, T009, T010, T012, T013, T014 em paralelo; T007, T011, T015, T017 em paralelo com os módulos seguintes; T022, T023, T024 em paralelo após T021.
- **US1**: T026/T027 em paralelo com T028–T030; T034 em paralelo com T031–T033; T035, T037, T038 em paralelo após T033.
- **US2/US3/US4**: as três histórias podem ser implementadas em paralelo após US1.

## Implementation Strategy

1. **MVP = Phase 1 + Phase 2 + US1**: os nove comandos deste repositório rodam no Maestro com qualquer provedor, scripts executados nativamente, preflight, `display`, sugestões e `-p`. Verificável pelos cenários 1–4 e 6 do quickstart.
2. **Incremento 2 = US3 + US4**: projeto novo do zero (`init`/`status`) e contexto do projeto.
3. **Incremento 3 = US2 + Polish**: perguntas como diálogos, README, CLAUDE.md, verificação final. **Não fazer merge sem T003/T005**: os assets copiados exigem o aviso MIT.

## Notes

- Os passos nativos nunca iniciam processos de shell; o único executável externo é `git` via `execFile`.
- Nenhum arquivo de `.claude/commands/` ou `.specify/` deste repositório é alterado pela implementação (FR-017); só `assets/speckit/` traz comandos modificados, com NOTICE.
- Textos de templates nunca vão para o `--debug`; só nomes de passos, tempos e caminhos.
- Commit da feature: prefixo `fix:` salvo pedido explícito em contrário.
