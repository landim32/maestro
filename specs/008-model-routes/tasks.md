---

description: "Task list for Rotas por Modelo (chat, Spec Kit, GitHub, infra e comandos)"
---

# Tasks: Rotas por Modelo (chat, Spec Kit, GitHub, infra e comandos)

**Input**: Design documents from `/specs/008-model-routes/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (routes-config.md, route-resolution.md, routes-dialog.md), quickstart.md

**Tests**: O plano define a estratégia (research R11 e § "Testes que fixam este contrato" de cada contrato): reducers puros testados por tabela (`resolveRoute`, `routeEntries`, `routesFlowReducer`), contrato de configuração e de resolução ↔ requisição com `FakeProvider` por id, integração de UI com `mountApp({ providers: { claude, qwen } })` e `settingsWriter` injetado, `noSecrets` estendido. As tarefas de teste abaixo implementam exatamente esses casos. Nenhum teste acessa a rede.

**Organization**: Tarefas por história de usuário. Nenhuma dependência nova de runtime.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: História a que a tarefa pertence (US1, US2, US3, US4)
- Caminhos exatos em cada descrição

## Path Conventions

Projeto único: `src/` e `tests/` na raiz, conforme plan.md § Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Seams de teste para dois provedores e para o diálogo.

- [X] T001 Em `tests/helpers/appHarness.tsx`, documentar e garantir que `providers: { claude, qwen }` cria um `FakeProvider` por id com `requests` separados (já existe `providerOverride`); adicionar o helper `twoProviders(opts?)` que devolve `{ claude: createFakeProvider(...,{id:'claude'}), qwen: createFakeProvider(...,{id:'qwen'}) }` com respostas identificáveis (`from claude`, `from qwen`)
- [X] T002 [P] Em `tests/helpers/context.ts`, aceitar `settings.routes` em `makeSettings`/`makeCtx` (já passa pelo `settingsSchema`; só confirmar com um teste rápido em `tests/unit/config/loader.test.ts` ou equivalente que `routes` sobrevive ao merge global/projeto)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema, catálogo e resolução puros; provedores e turno aceitando modelo/ajustes/rota; comandos marcados como de prompt. Bloqueia todas as histórias.

- [X] T003 Em `src/config/schema.ts`: `ROUTE_NAME_RE`, `routeNameSchema`, `routeTargetSchema` (`provider`, `model` token único, `effort?`, `maxTokens?` int ≥ 1, `_comment`), `routesSettingsSchema` (record com `_comment` permitido e `superRefine` validando nome e alvo por chave), `settings.routes` com `prefault({})`, tipos `RouteTarget` e `RoutesSettings`; em `src/config/defaults.ts`, `INITIAL_SETTINGS.routes` com `_comment` (data-model § 1)
- [X] T004 [P] Estender `tests/contract/config-schema.test.ts` (contracts/routes-config.md § 1): exemplo completo aceito; nome inválido (`Rota`, `a b`, `/x`), provedor desconhecido, modelo com espaço, chave extra no alvo, `maxTokens: 0` rejeitados com o caminho `routes.<nome>…`; `_comment` permitido; `{}` → `routes: {}`; `INITIAL_SETTINGS` continua válido
- [X] T005 [P] Criar `src/routes/catalog.ts` conforme data-model § 2: `PURPOSE_ROUTES`, `ROUTE_GUIDANCE` (github: fluxo de branch/PR/issues/revisão; infra: deploy/CI/containers/servidores, em inglês curto), `RouteEntry`, `routeEntries(input)` (ordem chat/github/infra/usuário/comandos; `follows`, `origin` por `rawGlobal`/`projectKeys`, `available` pelos `statuses`, `missingCommand`, `alias` ok/colisão), `isPurposeRoute`, `aliasCommands(entries, existing)` devolvendo `SlashCommand[]` `kind: 'prompt'` que produzem `PromptTurn { display, prompt, route }`, `routeNamesText(entries)` para avisos
- [X] T006 [P] Criar `tests/unit/routes/catalog.test.ts`: entradas padrão sem configuração (chat segue ativo, comandos seguem chat), rota configurada global × projeto, rota do usuário, rota de comando ausente, `available` falso para provedor não configurado/desabilitado, ordem das entradas, atalhos e colisão com comando existente (`/help`)
- [X] T007 [P] Criar `src/routes/resolve.ts` conforme data-model § 3: `resolveRoute(input)` com ordem forçada → comando → chat → ativo, `fallbacks` com `reason` (`unconfigured` | `disabled` | `unknown`), `via`, nunca lança; exportar `fallbackText(route, reason, providerId)` com os textos de contracts/route-resolution.md § 2
- [X] T008 [P] Criar `tests/unit/routes/resolve.test.ts`: tabela (sem rotas → ativo; comando com rota; forçada vence comando; forçada desconhecida → fallback `unknown` e segue; alvo com provedor não configurado → fallback e próximo passo; chat indisponível → ativo com `via: 'active'`; `effort`/`maxTokens` repassados)
- [X] T009 Em `src/providers/types.ts`: `ProviderRequest.overrides?: { effort?: Effort; maxTokens?: number }` e `Message.route?: string`; em `src/providers/anthropicProtocol.ts`, `streamAnthropicProtocol` aplica `req.overrides?.maxTokens ?? o.maxTokens` e `req.overrides?.effort ?? o.effort`; em `src/providers/qwen.ts`, protocolo OpenAI aplica `req.overrides?.maxTokens` (effort ignorado, comentado); em `src/providers/claude.ts` nada além de repassar `req`
- [X] T010 [P] Estender `tests/unit/providers/claude.test.ts` e `tests/unit/providers/qwen.test.ts` (mocks existentes): `overrides.maxTokens`/`effort` chegam em `max_tokens`/`output_config.effort` no Claude; só `max_tokens` no Qwen
- [X] T011 Em `src/session/session.ts`, `pushAssistant(parts, providerId, model?, route?)` grava `route`; em `src/session/turn.ts`, `TurnOptions.model?`, `overrides?`, `route?` → `provider.stream({ …, model: opts.model ?? session.modelOverride, overrides: opts.overrides })` e `pushAssistant(parts, provider.id, opts.model ?? session.modelOverride, opts.route)` em todos os pontos; estender `tests/unit/session/session.test.ts` e `tests/unit/session/turn.test.ts` (modelo/overrides na requisição, `route` na mensagem)
- [X] T012 Em `src/session/commands.ts`, `SlashCommand.kind?: 'prompt'`; em `src/speckit/prompt.ts`, `PromptTurn.route?: string`; em `src/speckit/service.ts`, `promptCommands()` com `kind: 'prompt'`; em `src/session/controller.ts`, `providers = new Map<ProviderId, ModelProvider>()`, `providerFor(id)` (usa `providerOverride` ou `createProvider`), `activeProvider` → `providerFor(session.activeProviderId)`, `applySettings`/`switchProvider` limpam o mapa; `executeSlash` passa a devolver também `command?: SlashCommand` (nome e `kind`) em `src/session/commands.ts`

**Checkpoint**: esquema, catálogo, resolução e provedores verdes; comportamento da UI ainda igual ao atual.

---

## Phase 3: User Story 1 — Configurar as rotas numa tela e ver os comandos seguirem o mapeamento (Priority: P1) 🎯 MVP

**Goal**: `submit` resolve a rota por comando e roda no provedor dela; transcrição e barra mostram a rota; `/routes` abre o diálogo que grava a configuração.

**Independent Test**: `tests/integration/ui/dialogs.routes.test.tsx` + `tests/integration/ui/routes.test.tsx` (quickstart 1–3).

- [X] T013 [US1] Em `src/session/controller.ts`, `submit(input, opts & { route?: string })`: após `executeSlash`, `resolveRoute({ forced: slash.turn?.route ?? opts.route, command: slash.command?.kind === 'prompt' ? slash.command.name : undefined, routes: settings.routes, statuses: this.statuses(), active })`; avisos `warn` por fallback (`fallbackText`), aviso da `chat` indisponível uma vez por sessão (`chatWarned`); `currentRoute = resolved.route` (undefined para `chat`) durante o turno e `emit('change')`; `runTurn(session, providerFor(target.provider), { …, system: this.system + guidance, model: target.model, overrides, route: resolved.route })`; log `route.resolve { route, provider, model, via, fallbacks }`; `refreshCommands()` também após `applySettings` (recalcula atalhos)
- [X] T014 [P] [US1] Em `src/ui/hooks/useSession.ts`, expor `currentRoute`; em `src/ui/components/StatusBar.tsx`, prop `route?: string` → `thinking…  ·  rota: <nome>` (só ≠ chat; contado na largura do lado esquerdo); em `src/ui/components/MessageList.tsx`, linha dim `⇢ ${route} · ${providerId} / ${model}` acima de respostas com `route && route !== 'chat'`; em `src/ui/App.tsx`, passar `route={snap.currentRoute}`
- [X] T015 [US1] Criar `src/setup/routesFlow.ts` conforme data-model § 6: `RoutesFlowContext`, `RoutesFlowState` (`list`, `action`, `provider`, `model`, `custom`, `newRoute`, `applying`, `done`, `failed`, `closed`), `RoutesFlowEvent`, `initialRoutesFlow`, `routesFlowReducer` (navegação com cabeçalhos pulados; ações por tipo: `reset` só para fixas/comando com valor, `remove` só para rotas do usuário e comandos ausentes; `newRoute` valida formato/vazio/colisão com rotas e comandos e segue para `provider`; `custom` valida modelo não vazio; `applying` ← `applied`/`applyError`), `routesEffectsFor`, `describeRouteResult(state)` para a mensagem de `done`
- [X] T016 [P] [US1] Criar `tests/unit/setup/routesFlow.test.ts` (contracts/routes-dialog.md § 2–4): ordem e navegação pulando cabeçalhos, Enter em rota fixa sem valor (sem "Voltar ao padrão"), com valor (com), rota do usuário (com "Remover"), comando ausente (com "Remover"); fluxo provedor → modelo → `applying` com `learn`; "Digitar outro modelo…" → `custom` vazio → erro; "Nova rota…" com nome inválido/colisão/válido; `back` em cada passo; `cancel` sempre fecha; `applied`/`applyError`
- [X] T017 [US1] Em `src/setup/dialog.ts`, `DialogState += { type: 'routes'; flow: RoutesFlowState }`; em `src/setup/driver.ts`, `routesCtx()` (entries via `routeEntries` com `readRawSettings(globalPath).routes` e `projectOverrides`), `openRoutes()`, `dispatch` roteando `routes`, `dispatchRoutes(event)`, `runRoutesEffect(next)` (`writeSettings([{ path: 'routes.<rota>', value: target | undefined }, ...rememberModel])` → `reloadSettings()` → `refreshCommands()` → `applied` com mensagem; aviso `sobrescrita por ./.maestro/settings.json` quando `overriddenByProject` inclui a rota; `applyError` com a mensagem do `MaestroError`; log `routes.write { route, action }`)
- [X] T018 [US1] Criar `src/ui/dialogs/RoutesDialog.tsx` (`DialogFrame` "Rotas por modelo"; `SelectList` com cabeçalhos "Rotas"/"Comandos", linha `nome  provedor / modelo [· effort]  status` com `padrão (segue o ativo|chat)`/`global`/`projeto`/`indisponível`/`comando ausente`/`atalho /x`/`atalho em colisão`, entrada "+ Nova rota…"; passo `action` como `SelectList`; `provider`/`model` como no `ModelDialog` (credenciais mascaradas); `TextField` para `custom` e `newRoute` com erro; `ProgressView` em `applying`; `ResultView` em `done`/`failed`); em `src/ui/dialogs/DialogHost.tsx`, rotear `type === 'routes'`
- [X] T019 [US1] Em `src/session/commands.ts`, comando `/routes` (interativo: `ctl.setup.openRoutes()`; `-p`: `ctl.notice(routesTableText(entries))` com colunas nome / provedor-modelo / origem / disponibilidade); `/help` lista `/routes`; estender `tests/unit/session/commands.test.ts` (`/routes` em `-p` imprime a tabela; interativo abre o diálogo `type: 'routes'`)
- [X] T020 [US1] Criar `tests/integration/ui/dialogs.routes.test.tsx` com `mountApp({ providers: twoProviders(), controller: { settingsWriter, settingsLoader } })`: `/routes` → lista com `chat`, `github`, `infra` e comandos de prompt (usar `specKit` de `tests/helpers/tempRepo` ou comandos injetados via `controller.commands` com `kind: 'prompt'`); selecionar `speckit.specify` → provedor `qwen` → modelo → `settingsWriter` recebe `{ path: 'routes.speckit.specify', value: { provider: 'qwen', model } }`; "Voltar ao padrão" grava `value: undefined`; Esc na lista fecha sem gravar; `failed` quando o writer lança
- [X] T021 [US1] Criar `tests/integration/ui/routes.test.tsx` (quickstart 2): `settings.routes['speckit.specify'] = { provider: 'qwen', model: 'qwen3-coder-plus' }` com `specKit` real de `tempRepo` (ou comando `kind: 'prompt'` injetado); enviar o comando → `qwen.requests[0]` tem o prompt e `model: 'qwen3-coder-plus'`; transcrição mostra `⇢ speckit.specify · qwen / qwen3-coder-plus`; barra mostra `rota: speckit.specify` durante a geração (provider com `delayMs`); mensagem comum em seguida → `claude.requests[0].messages` contém a resposta do Qwen; `session.history` tem `route` só na resposta do Qwen

**Checkpoint**: US1 completa (quickstart 1–3).

---

## Phase 4: User Story 2 — Cada comando do Maestro tem a sua rota, incluindo todos os do Spec Kit (Priority: P1)

**Goal**: Todos os comandos de prompt aparecem como rotas; comandos sem modelo não; comandos novos aparecem sem reinício.

**Independent Test**: `tests/unit/routes/catalog.test.ts` (comandos) + cenário de `/speckit.init` em `tests/integration/ui/routes.test.tsx`.

- [X] T022 [US2] Em `src/speckit/service.ts` e `src/session/commands.ts`, garantir que **apenas** comandos que devolvem `PromptTurn` têm `kind: 'prompt'` (`/speckit.init`, `/speckit.status`, `/help`, `/clear`, `/model`, `/auth`, `/approval-mode`, `/mouse`, `/routes`, `/exit` ficam sem); em `src/session/controller.ts`, `refreshCommands()` recalcula a lista base + Spec Kit + atalhos de rotas (`aliasCommands`) e é chamado por `/speckit.init`, `applySettings` e após gravar rotas
- [X] T023 [US2] Estender `tests/integration/ui/routes.test.tsx`: com `tempRepo({ specify: '1.x' })`, `/routes` lista uma rota por `/speckit.*` de prompt e nenhuma para `/speckit.init`/`/speckit.status`; após criar `.maestro/commands/revisar.md` e `/speckit.init --upgrade` (ou `controller.refreshCommands()`), reabrir `/routes` mostra `revisar`; rota configurada para comando ausente (`routes['speckit.old']`) aparece como `comando ausente` e "Remover rota" grava `value: undefined`

**Checkpoint**: US2 completa (quickstart 4).

---

## Phase 5: User Story 3 — Rotas de propósito: chat, github, infra e `/ask` (Priority: P2)

**Goal**: `/ask <rota> <pedido>`, atalhos `/<rota>`, orientação de `github`/`infra`, criação e remoção de rotas do usuário.

**Independent Test**: `tests/unit/session/commands.test.ts` (`/ask`, atalhos) + cenários em `tests/integration/ui/routes.test.tsx`.

- [X] T024 [US3] Em `src/session/commands.ts`, comando `ask` (`usage: '/ask <rota> <pedido>'`, `kind: 'prompt'`): valida rota conhecida via `routeEntries` (aviso `Uso: /ask <rota> <pedido>. Rotas: …` sem enviar) e devolve `PromptTurn { display: linha digitada, prompt: pedido, route }`; `/help` lista `/ask` e os atalhos como `/<rota> <pedido>  (atalho da rota <rota>)`
- [X] T025 [US3] Em `src/session/controller.ts`, `guidanceFor(route)` anexa `ROUTE_GUIDANCE[route]` ao `system` do turno (bloco `# Route: github` …) só para `github`/`infra`; atalhos de `aliasCommands` entram em `commands` (colisão → comando vence; `routeEntries` marca `alias: 'collides'`)
- [X] T026 [P] [US3] Estender `tests/unit/session/commands.test.ts`: `/ask github resuma` → `PromptTurn` com `route: 'github'` e `display` igual à linha; `/ask` sozinho e `/ask nada x` → aviso com a lista e `fake.requests` vazio; `/github …` equivale a `/ask github …`; rota do usuário `review` em `settings.routes` gera `/review`; rota chamada `help` não gera atalho e a entrada marca colisão
- [X] T027 [US3] Estender `tests/integration/ui/routes.test.tsx`: `routes.github = { provider: 'qwen', … }` → `/ask github resuma o PR #6` chega ao Qwen com o `system` contendo o bloco de orientação e `messages` com o histórico completo; o cabeçalho continua `claude / …`; `/infra …` pelo atalho; em `dialogs.routes.test.tsx`, "Nova rota…" `review` → provedor/modelo → `settingsWriter` recebe `routes.review` e `/review` aparece nas sugestões do prompt; "Remover rota" em `review` grava `undefined`; `chat`/`github`/`infra` não oferecem "Remover"

**Checkpoint**: US3 completa (quickstart 5).

---

## Phase 6: User Story 4 — Contexto compartilhado, indisponibilidade e visibilidade (Priority: P2)

**Goal**: Fallbacks com aviso, aviso único da `chat`, `--route` e `/routes` em `-p`, contrato resolução ↔ requisição.

**Independent Test**: `tests/contract/routes.test.ts` + cenários de fallback em `tests/integration/ui/routes.test.tsx`.

- [X] T028 [US4] Em `src/cli/args.ts`, `--route <rota>` (string, `describe`); em `src/index.ts`, após montar o controller, validar `args.route` contra `routeEntries(...)` (desconhecida → stderr `maestro: rota desconhecida '<nome>'. Rotas: …` e `EXIT.USAGE`) e passar `route` a `runNonInteractive`; em `src/cli/nonInteractive.ts`, `NonInteractiveOptions.route?` → `controller.submit(prompt, { route })`
- [X] T029 [P] [US4] Criar `tests/contract/routes.test.ts` (contracts/route-resolution.md § 3–5) com `SessionController` + dois `FakeProvider`s: comando com rota → provedor e `model` da rota, `overrides` repassados; `Message.route` gravado; histórico completo (mensagens de ambos) na requisição seguinte; `submit(prompt, { route: 'infra' })` força; `runNonInteractive({ route })` idem; `/routes` em `-p` imprime a tabela; `--route` desconhecida sai com 2 (via `runCli`/`main` existente em `tests/integration/cli/*`)
- [X] T030 [US4] Estender `tests/integration/ui/routes.test.tsx`: rota de comando para `qwen` com `providers.qwen.enabled: false` → aviso `Rota speckit.plan indisponível (provedor qwen desabilitado); usando chat.` e o Claude responde; `routes.chat` para provedor não configurado → aviso uma vez por sessão e o ativo responde (segunda mensagem sem novo aviso); `/routes` marca `indisponível`; `--debug` com logger injetado grava `route.resolve` com `fallbacks` e sem conteúdo
- [X] T031 [P] [US4] Estender `tests/unit/security/noSecrets.test.ts`: com chaves configuradas, abrir `/routes` e navegar até a escolha de provedor: nenhum frame contém as chaves (só `****xxxx`); o log `route.resolve`/`routes.write` não contém chaves

**Checkpoint**: US4 completa (quickstart 6–9).

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T032 [P] Em `README.md`: seção **Rotas por modelo** (o que é uma rota, padrões, `/routes`, `/ask`, atalhos, `github`/`infra`, fallback, `--route`), linhas novas na tabela de comandos (`/routes`, `/ask <rota> <pedido>`, `/<rota> <pedido>`), exemplo de `routes` na configuração e nota sobre o projeto sobrescrever rota a rota
- [X] T033 [P] Em `CLAUDE.md` (Code Style e árvore): `src/routes/` puro (`routeEntries`, `resolveRoute`), `SlashCommand.kind: 'prompt'` como critério de rota, `PromptTurn.route`, `providerFor(id)` e provedor ativo intocado, `Message.route`, diálogo `routesFlow` + `SetupDriver`, logs `route.resolve`/`routes.write` sem conteúdo
- [X] T034 Rodar `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` na raiz (`package.json`); corrigir o que falhar em `src/` e `tests/`
- [ ] T035 Executar o quickstart (`specs/008-model-routes/quickstart.md`, cenários 1–10) com Claude e Qwen configurados; registrar divergências como tarefas

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → US1 → US2 → US3 → US4 → Polish**. US2 depende de US1 (lista do diálogo e `refreshCommands`). US3 depende da fundação e de T013 (resolução no `submit`); pode correr em paralelo com o diálogo (T015–T020). US4 depende de T013 e do catálogo; T028/T029 podem começar após a fundação.
- Dentro da fundação: T003→T004; T005→T006; T007→T008; T009→T010; T011 e T012 após T009. T005/T007/T009 são independentes entre si.
- Dentro de US1: T013 → T014 (paralelo com T015/T016) → T017 → T018 → T019 → (T020, T021).

## Parallel Execution Examples

- **Fundação**: T003, T005, T007, T009 em paralelo; depois T004, T006, T008, T010 em paralelo; T011 e T012 em seguida.
- **US1**: T014, T015 e T016 em paralelo após T013.
- **US3 e diálogo (US1 T015–T020)** em paralelo após T013.
- **US4**: T028 e T029 em paralelo após a fundação; T030/T031 após T013.
- **Polish**: T032 e T033 em paralelo.

## Implementation Strategy

1. **MVP = Phase 1 + Phase 2 + US1**: rotas por comando em arquivo e pela tela, com transcrição e barra marcando a rota. Verificável pelos cenários 1–3 do quickstart.
2. **Incremento 2 = US2 + US3**: cobertura de todos os comandos, `/ask`, atalhos, rotas do usuário.
3. **Incremento 3 = US4 + Polish**: fallbacks, `-p`, documentação, verificação final.

## Notes

- Sem `routes` configuradas o comportamento é idêntico ao atual: a suíte existente precisa continuar verde a cada checkpoint (SC-006).
- O provedor ativo da sessão nunca muda por causa de uma rota; `/model` continua controlando a `chat` padrão.
- Logs registram só nome da rota, provedor, modelo, `via` e fallbacks; nunca conteúdo nem credenciais.
- Commit da feature: prefixo `fix:` salvo pedido explícito em contrário.
