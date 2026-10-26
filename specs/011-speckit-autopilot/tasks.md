# Tasks: Modo autopiloto (Spec Kit de ponta a ponta, sem interação)

**Input**: Design documents from `specs/011-speckit-autopilot/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: incluídos, porque a constituição (§III) exige testes unitários, de contrato e de integração. Os testes do autopiloto usam:
- um provedor falso roteirizado por passo (`tests/helpers/fakeProvider.ts`);
- os portões Git, remoto e verificação em memória (`tests/helpers/autopilotPorts.ts`, criado em T009);
- para a integração de ponta a ponta, um repositório temporário real (`tests/helpers/tempRepo.ts`) com git de verdade e sem rede.

**Organization**: as tarefas estão agrupadas pelas user stories da spec. US1, US2 e US3 são P1 e formam o MVP juntas. US4 é P2 e US5 é P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivo diferente, sem dependência pendente)
- **[Story]**: US1–US5, conforme o spec.md

---

## Phase 1: Setup

- [X] T001 Criar a pasta `src/autopilot/` e `tests/unit/autopilot/`. Rodar `npm run typecheck` e `npm test` e anotar a linha de base (esperado: 827 testes) na seção Notes deste arquivo.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tipos, configuração, portões de git e ganchos do controller usados por todas as stories.

**⚠️ CRITICAL**: nenhuma story começa antes desta fase.

- [X] T002 Criar `src/autopilot/types.ts` com os tipos de data-model.md § 1–7:
  - `Story`, `StepName`, `STEPS` (a ordem fixa specify → verify);
  - `StepRun`, `StoryRun`, `Run`, `Decision`;
  - `AutopilotEvent`, `AutopilotEffect`, `AutopilotState`.
- [X] T003 Em `src/config/schema.ts` e `src/config/defaults.ts`:
  - criar `autopilotSettingsSchema` (`z.strictObject`), com:
    - `verify.command?: string[]`, `verify.maxAttempts` (0–10, padrão 3) e `verify.timeoutMs` (≥ 1000, padrão 600000);
    - `limits.turns` (≥ 7, padrão 60), `limits.minutes` (≥ 1, padrão 120) e `limits.tokens` (≥ 0, padrão 0);
    - `commitPrefix` (`'fix:' | 'feat:'`, padrão `'fix:'`), `push` (padrão `false`), `merge` (padrão `false`, com `superRefine` que exige `push`) e `prBase?: string`;
  - acrescentar `autopilot: autopilotSettingsSchema.prefault({})` em `settingsSchema` e o tipo `AutopilotSettings`;
  - não acrescentar a seção em `INITIAL_SETTINGS` (YAGNI; ela é documentada no README).
- [X] T004 Em `src/speckit/git.ts`, acrescentar ao `GitPort`:
  - `headSha(root)`, `addAll(root)`, `commit(root, message)` (via `-F` com arquivo temporário, retornando o SHA), `push(root, branch)` (`push -u origin <branch>`) e `isAncestor(root, sha, branch)` (`merge-base --is-ancestor`);
  - as implementações em `systemGit` e as versões vazias em `nullGit`.

  Tudo via `execFile`, nunca shell.
- [X] T005 Em `src/session/controller.ts`:
  - acrescentar `runOverrides(o: { ask?: (r: AskUserRequest) => Promise<AskUserOutcome>; confirm?: () => Promise<boolean>; approvalMode?: ApprovalMode }): () => void`. Ele guarda o modo anterior, aplica o forçado, faz o `submit` usar `o.ask` no lugar de `this.askUser` e `o.confirm` como `confirm` padrão, e devolve a função que restaura tudo;
  - acrescentar `autopilotStatus?: { story: number; total: number; step: StepName }`, com `setAutopilotStatus(s | undefined)`, que emite `change`;
  - acrescentar `clearConversation()`, que limpa a sessão e os chips, igual ao `/clear` mas sem aviso.
- [X] T006 Em `src/routes/catalog.ts`, acrescentar a rota de propósito `autopilot.decide` (segue `chat`, sem atalho `/autopilot.decide`, sem `ROUTE_GUIDANCE`). Ela tem que aparecer em `/routes` como as rotas `github`/`infra`.
- [X] T007 [P] Criar `src/autopilot/stories.ts` com `parseStories(markdown) → Story[] | { error }`, seguindo contracts/stories-file.md: `##` por história, contexto antes do primeiro `##` anexado, arquivo sem `##` é uma história só, descrição vazia é recusada e o `hash` é sha256.
- [X] T008 [P] Criar `src/autopilot/state.ts`:
  - `runStateSchema` (zod, `version: 1`);
  - `readRunState(root) → Run | undefined | { error }`;
  - `writeRunState(root, run)` atômico (`.tmp` + `rename`) em `.specify/autopilot.json`;
  - `isPidAlive(pid)`.
- [X] T009 [P] Criar `tests/helpers/autopilotPorts.ts`:
  - `memoryGit()`, um `GitPort` em memória com branches, commits, árvore suja ou limpa e a lista de chamadas;
  - `fakeRemote()`, que registra `createPr`/`merge` e devolve URLs falsas;
  - `fakeVerify(results: number[])`, que devolve os códigos de saída em sequência com uma saída fixa.
- [X] T010 [P] Criar `tests/unit/autopilot/stories.test.ts`, cobrindo todos os casos de contracts/stories-file.md, e `tests/unit/autopilot/state.test.ts`, com ida e volta, versão desconhecida, gravação atômica e um campo extra recusado.
- [X] T011 [P] Estender `tests/contract/config-schema.test.ts` com:
  - os padrões da seção `autopilot`;
  - `merge: true` sem `push` recusado, com a mensagem no caminho `autopilot.merge`;
  - limites fora da faixa recusados.

  Estender também `tests/unit/session/controller.dialog.test.ts` (ou criar `tests/unit/session/controller.overrides.test.ts`): `runOverrides` troca o `ask`, o `confirm` e o modo, e a função devolvida restaura os três, mesmo se chamada depois de um erro.

**Checkpoint**: tipos, configuração, git e ganchos prontos.

---

## Phase 3: User Story 1 — Uma história vira uma feature pronta (Priority: P1) 🎯 MVP

**Goal**: `/autopilot historias.md` com uma história percorre os sete passos, com um commit por passo e um relatório no fim, sem interação.

**Independent Test**: com o provedor falso criando os artefatos esperados a cada passo e os portões em memória, os sete passos rodam em ordem, cada passo começa com a sessão limpa, há seis commits (o verify não gera commit se nada mudar) e o relatório lista os passos.

### Tests for User Story 1

- [X] T012 [P] [US1] Criar `tests/unit/autopilot/flow.test.ts`, com o reducer de data-model.md § 7:
  - `start` → `clearSession`, `runTurn('/speckit.specify <título>\n\n<descrição>')`;
  - `turnDone` → `evaluateGate`;
  - `gate advance` → `commit` → `saveState` → próximo passo com `clearSession`;
  - depois do `implement` vem `runVerify`, e no fim `report`;
  - `cancelled` deixa o passo `interrupted` e a execução `interrupted`;
  - um `gate stop` deixa o passo `failed` e a história e a execução `stopped`.
- [X] T013 [P] [US1] Criar `tests/unit/autopilot/gates.test.ts` com os portões de artefato de contracts/gates.md § 2:
  - specify sem feature nova falha;
  - specify com `spec.md` e branch certa passa;
  - plan sem `plan.md` falha;
  - tasks sem nenhuma `- [ ] T` falha;
  - verify com código 0 passa;
  - `stopReason: 'error'` falha;
  - `rate_limit` vira `interrupted`.
- [X] T014 [P] [US1] Criar `tests/unit/autopilot/report.test.ts`: o texto de contracts/autopilot-cli.md § 3, com história concluída, história parada (passo, portão e últimas linhas) e as linhas de decisões, registro e retomada.
- [X] T015 [P] [US1] Criar `tests/integration/autopilot/run.test.ts`, de ponta a ponta num repositório temporário real (`tempRepo`) com o Spec Kit instalado (`/speckit.init`) e um provedor falso que, a cada passo, escreve o artefato com `write_file` e marca as tarefas no implement. Ele confere:
  - a branch `001-*` foi criada;
  - `git log` tem um commit por passo, com a mensagem `fix: autopilot(001): <passo>`;
  - `.specify/autopilot.json` termina com `status: 'done'`;
  - as recusas de contracts/autopilot-cli.md § 4 acontecem (árvore suja, sem git, sem Spec Kit, arquivo sem histórias, execução ativa).

### Implementation for User Story 1

- [X] T016 [US1] Criar `src/autopilot/flow.ts`:
  - `initialAutopilot(run)` e `autopilotReducer(state, event) → { state, effects: AutopilotEffect[] }`, puros;
  - a sequência `STEPS`, o cursor (história e passo) e as transições de passo e de execução de data-model.md § 7;
  - os textos de turno de contracts/gates.md § 1.
- [X] T017 [US1] Criar `src/autopilot/gates.ts`:
  - `GateSnapshot { step, before, after, branch, openTasks, doneTasks, text, stopReason, errorCategory?, verify? }`;
  - `evaluateGate(snapshot, ctx) → { verdict: 'advance' | 'stop' | 'interrupted' | …, reason }` para os portões de artefato e de verify simples;
  - `countTasks(markdown)` (`- [ ] T`, `- [X] T`).
- [X] T018 [US1] Criar `src/autopilot/report.ts`, com `formatReport(run, paths)` puro, conforme contracts/autopilot-cli.md § 3.
- [X] T019 [US1] Criar `src/autopilot/driver.ts`:
  - `AutopilotDriver` com `deps { controller, git: GitPort, verify: VerifyPort, remote: RemotePort, clock, fs, log }`;
  - `start(file)`, que faz as conferências de início (§ 4), monta o `Run`, aplica `controller.runOverrides({ confirm: async () => false, approvalMode: 'auto' })` e força `speckit.createBranch`;
  - o laço que consome os efeitos do reducer:
    - `clearSession` → `controller.clearConversation()`;
    - `runTurn` → `controller.submit(text)`;
    - `evaluateGate` → snapshot do disco (`resolveFeaturePaths` do Spec Kit) + `evaluateGate`;
    - `runVerify` → `VerifyPort`;
    - `commit` → `git.addAll` + `git.commit` (pulando quando não houver mudança);
    - `saveState` → `writeRunState`;
    - `report`;
  - `controller.setAutopilotStatus` a cada passo;
  - a restauração dos overrides num `finally`;
  - `VerifyPort` padrão sobre `shellFor` com timeout, com o comando derivado do `package.json` quando não configurado (research R10).
- [X] T020 [US1] Em `src/session/commands.ts`, criar o comando local `/autopilot <arquivo> [--resume] [--status]` (`kind` local, sem rota):
  - resolve o arquivo com `resolveInsideCwd`;
  - recusa fora do estado `idle`;
  - chama `AutopilotDriver.start`;
  - mostra o relatório como aviso ao fim.

  Acrescentá-lo a `DEFAULT_COMMANDS` e ao `/help`.
- [X] T021 [US1] Em `src/ui/App.tsx` e `src/ui/components/InputPrompt.tsx` (placeholder), ligar o Esc durante o autopiloto a `controller.cancel()` (o turno atual), que o driver trata como `cancelled`, e desativar o prompt enquanto `snap.autopilotStatus` existir, com o placeholder `autopiloto em execução — Esc para interromper`.

**Checkpoint**: o pipeline de uma história funciona, com perguntas ainda sem resposta automática.

---

## Phase 4: User Story 2 — Decisões automáticas, justificadas e registradas (Priority: P1)

**Goal**: cada `ask_user` e cada pergunta em texto no fim do turno são respondidos pelo decisor (recomendada; senão a mais conservadora) e registrados em `decisions.md` e no `.jsonl`.

**Independent Test**: um provedor falso que faz um `ask_user` com uma opção recomendada no clarify e termina o implement com "(yes/no)" segue sem interação, e as duas decisões aparecem nos dois registros com escolha e justificativa.

### Tests for User Story 2

- [X] T022 [P] [US2] Criar `tests/unit/autopilot/decider.test.ts`:
  - `buildDecisionRequest` (contracts/decisions.md § 1) para opções, múltipla escolha e texto livre;
  - `parseDecision` aceita JSON puro e bloco ```` ```json ````, ignora maiúsculas e espaços no rótulo e recusa rótulo inexistente, `choices` vazio e `rationale` vazio ou com mais de 600 caracteres;
  - `recommendedOf(options)` detecta `(Recommended)` e `(Recomendado)`;
  - duas falhas seguidas → erro `decider_failed`.
- [X] T023 [P] [US2] Criar `tests/unit/autopilot/questions.test.ts` com cada padrão de contracts/gates.md § 3:
  - `(yes/no)`, `(sim/não)`, `[y/N]`;
  - perguntas com "Do you want", "Deseja", "Quer que";
  - "Your choice";
  - negativos: uma pergunta retórica no meio do texto e um parágrafo final que não termina em `?` sem os padrões.
- [X] T024 [P] [US2] Criar `tests/unit/autopilot/log.test.ts`:
  - `renderDecisions(feature, run, decisions)` produz o Markdown de contracts/decisions.md § 3, incluindo a linha "Atenção" quando `followedRecommendation` é falso;
  - `appendJsonl` grava uma linha por evento;
  - a regravação descarta conteúdo alterado no disco.
- [X] T025 [P] [US2] Estender `tests/integration/autopilot/run.test.ts`:
  - o clarify chama `ask_user` com uma opção recomendada, e o decisor falso a escolhe;
  - o implement termina com "Do you want to proceed with implementation anyway? (yes/no)", e o próximo turno é a resposta do decisor;
  - `specs/001-*/decisions.md` e o `.jsonl` contêm as duas decisões;
  - o `debug.log` não contém a pergunta nem a resposta.

### Implementation for User Story 2

- [X] T026 [US2] Criar `src/autopilot/decider.ts`:
  - funções puras `buildDecisionRequest(ctx)`, `parseDecision(text, options)` e `recommendedOf(options)`;
  - `createDecider({ controller, routes })`, que resolve a rota `autopilot.decide` com `resolveRoute`, chama `provider.stream` sem ferramentas com os textos do contrato, coleta o texto, valida, tenta de novo uma vez e devolve `Decision`;
  - `asAskUserHandler(decider, context)`, que converte `AskUserRequest` em pedidos e as escolhas em `AskUserOutcome`.
- [X] T027 [US2] Criar `src/autopilot/questions.ts` com `detectQuestion(text): string | undefined` (o parágrafo da pergunta), pura, conforme contracts/gates.md § 3.
- [X] T028 [US2] Criar `src/autopilot/log.ts`:
  - `renderDecisions` (Markdown);
  - `appendJsonl(root, id, event)` em `.maestro/autopilot/<id>.jsonl`, que cria a pasta;
  - `rewriteProtected(root, run, decisions)`, que regrava `decisions.md` da feature e `.specify/autopilot.json` a partir da memória (FR-020).
- [X] T029 [US2] Em `src/autopilot/flow.ts`, o `turnDone` com pergunta detectada (o driver passa `question` no evento) gera `runTurn(answer)` depois da decisão, em no máximo 3 rodadas de resposta por passo. Em `src/autopilot/driver.ts`:
  - passar `ask: asAskUserHandler(...)` em `runOverrides`;
  - chamar `detectQuestion` no texto final de cada turno;
  - registrar cada decisão (`appendJsonl`, lista em memória);
  - chamar `rewriteProtected` antes de cada commit;
  - registrar só `autopilot.decision { story, step, kind, followedRecommendation }` no logger.

**Checkpoint**: o pipeline roda sem travar em perguntas e deixa o registro.

---

## Phase 5: User Story 3 — Portões e correções limitadas (Priority: P1)

**Goal**: analyze com CRITICAL tem uma correção; o implement repete "continue" enquanto houver progresso; a verificação tem até N correções; o preflight bloqueado para a história; toda parada vai para o relatório.

**Independent Test**: cada falha simulada isoladamente produz o veredito de contracts/gates.md § 2 (advance, continue, fix ou stop), e o relatório cita o passo, o portão e a saída.

### Tests for User Story 3

- [X] T030 [P] [US3] Estender `tests/unit/autopilot/gates.test.ts`:
  - analyze com `Critical Issues Count: 2` → `fix`, e depois da correção, ainda `2` → `stop`;
  - a tabela `| A1 | … | CRITICAL | …` sem a métrica → `fix`;
  - a legenda "CRITICAL: Violates…" não conta;
  - implement com tarefas abertas e progresso → `continue`, sem progresso → `stop`, zero abertas → `advance`;
  - verify falhando com `attempts < max` → `fix`, e com `attempts == max` → `stop`;
  - `CommandBlocked` → `stop` com a mensagem do preflight.
- [X] T031 [P] [US3] Estender `tests/unit/autopilot/flow.test.ts`:
  - `fix` do analyze gera `runTurn(<prompt de correção>)` e depois `runTurn('/speckit.analyze')` sem limpar a sessão;
  - `continue` gera `runTurn('continue')`;
  - o `fix` da verificação volta ao histórico do implement (`runTurn(<falha + saída>)`) e depois `runVerify`;
  - as contagens `rounds` e `attempts` em `StepRun`.
- [X] T032 [P] [US3] Estender `tests/integration/autopilot/run.test.ts` com `fakeVerify([1, 1, 0])`: duas correções, a terceira verificação passa e a história fica `done`, com `attempts: 2`. Com `fakeVerify([1, 1, 1, 1])` e `maxAttempts: 3`, a história fica `stopped` em `verify` e o relatório traz as últimas linhas.

### Implementation for User Story 3

- [X] T033 [US3] Em `src/autopilot/gates.ts`, implementar:
  - `criticalCount(text)` (research R7);
  - o portão do analyze, com uma correção;
  - o do implement, com progresso medido por `doneTasks` antes e depois da rodada;
  - o do verify, com `attempts`;
  - a detecção de `CommandBlocked` a partir de `controller.lastCommandBlocked`, passada no snapshot.
- [X] T034 [US3] Em `src/autopilot/flow.ts`, implementar os veredictos `continue` e `fix`, com os prompts de contracts/gates.md § 2 (correção do analyze; "continue"; falha da verificação com as últimas 200 linhas), e a contagem de `rounds`/`attempts`.
- [X] T035 [US3] Em `src/autopilot/driver.ts`, implementar:
  - o snapshot com `doneTasks` antes e depois de cada turno;
  - o `runVerify`, que guarda a saída (últimas 200 linhas) para o prompt de correção e para o relatório;
  - o turno de correção da verificação no histórico do passo implement, sem `clearSession`.

**Checkpoint**: o MVP (US1 a US3) está completo.

---

## Phase 6: User Story 4 — Várias histórias, limites e retomada (Priority: P2)

**Goal**: várias histórias em sequência com branches empilhadas, tetos por história e `--resume` do primeiro passo não concluído.

**Independent Test**: com duas histórias, interromper no plan da segunda, retomar, e verificar que a primeira não é refeita e que a segunda continua do plan. Um teto estourado para a execução.

### Tests for User Story 4

- [X] T036 [P] [US4] Estender `tests/unit/autopilot/flow.test.ts`:
  - depois do último passo da história 1 vem `clearSession` + specify da história 2, sem checkout de base;
  - `limitExceeded` (turnos, minutos, tokens) → a história e a execução ficam `stopped` com o motivo;
  - `resume` posiciona o cursor no primeiro passo diferente de `done` e zera as tentativas de um passo `failed`.
- [X] T037 [P] [US4] Criar `tests/unit/autopilot/resume.test.ts`, com as conferências de contracts/state-file.md § 3:
  - status `active` com `pid` vivo é recusado, e com `pid` morto vira `interrupted`;
  - árvore suja é recusada;
  - branch ausente é recusada;
  - SHA que não é ancestral é recusado;
  - história iniciada com hash alterado é recusada;
  - história nova no fim é acrescentada.
- [X] T038 [P] [US4] Estender `tests/integration/autopilot/run.test.ts`:
  - duas histórias, e a branch `002-*` contém os commits da `001-*` (`isAncestor`);
  - um cancelamento no plan da história 2, depois `--resume`: o provedor falso recebe de novo só os passos plan em diante da história 2.

### Implementation for User Story 4

- [X] T039 [US4] Em `src/autopilot/flow.ts`, implementar:
  - a passagem entre histórias;
  - a contabilidade de `usage` por história, com turnos, ms e tokens vindos do `TurnResult`;
  - o evento `limitExceeded` checado a cada `turnDone`;
  - `resumeFrom(run)`.
- [X] T040 [US4] Criar `src/autopilot/resume.ts` com `checkResume(run, { git, root, inputHash, stories, isPidAlive }) → { ok, run } | { error }` puro sobre os portões, e ligá-lo em `AutopilotDriver.resume()`. A retomada faz checkout da branch da história atual (`git.checkoutExisting`) antes de continuar.
- [X] T041 [US4] Em `src/autopilot/driver.ts`, tratar o erro `rate_limit` do turno como `interrupted` (FR-023) e gravar `pid` e `status: 'active'` no início e `interrupted` no cancelamento.

---

## Phase 7: User Story 5 — `-p`, push/PR e barra de status (Priority: P3)

**Goal**: `maestro -p --autopilot <arquivo> [--resume]` com progresso no stderr, relatório no stdout e os códigos 0, 1 e 2; push e PR só com opção; a barra de status mostra a história e o passo.

**Independent Test**: no `-p` com provedor falso, conferir o stderr, o stdout e os códigos. Com `push: true` e `fakeRemote`, push e PR acontecem por história (o PR de cada história aponta para a anterior). Com o padrão, nenhuma chamada remota.

### Tests for User Story 5

- [X] T042 [P] [US5] Criar `tests/integration/cli/autopilot.test.ts`, que roda `runAutopilotNonInteractive` com um controller falso e as portas em memória:
  - as linhas de progresso no stderr de contracts/autopilot-cli.md § 2;
  - o relatório só no stdout;
  - os códigos 0 (tudo `done`), 1 (história parada) e 2 (arquivo sem histórias, árvore suja, `--autopilot` com prompt posicional).
- [X] T043 [P] [US5] Criar `tests/unit/autopilot/remote.test.ts`:
  - com `push: false` não há nenhuma chamada a `git.push` nem a `remote`;
  - com `push: true`, cada história `done` gera push e PR com `--base` igual à branch anterior (a primeira usa `prBase` ou `baseBranch`);
  - `merge: true` chama o merge só depois do PR;
  - uma história `stopped` não gera PR.
- [X] T044 [P] [US5] Estender `tests/unit/ui` com a barra de status (`StatusBar` com `autopilot={{ story: 2, total: 3, step: 'plan' }}` mostra `autopiloto · história 2/3 · plan`).

### Implementation for User Story 5

- [X] T045 [US5] Criar `src/autopilot/remote.ts` com `RemotePort { createPr({ base, head, title, body }) → { url, number }; merge(number) }` sobre `gh` via `execFile` (corpo do PR em arquivo temporário). No `driver.ts`, executar o efeito `pushAndPr` depois do último passo de cada história, só com `autopilot.push`, e o merge só com `autopilot.merge`.
- [X] T046 [US5] Em `src/cli/args.ts`, acrescentar `--autopilot <arquivo>` e `--resume` (este só com `--autopilot`), validando as combinações proibidas com o código 2. Em `src/index.ts`, desviar para `runAutopilotNonInteractive`. Criar `runAutopilotNonInteractive` em `src/cli/nonInteractive.ts`, com o progresso do driver no stderr, os avisos dos turnos no stderr, o relatório no stdout e os códigos de saída.
- [X] T047 [US5] Em `src/ui/components/StatusBar.tsx` e `src/ui/hooks/useSession.ts`, expor `controller.autopilotStatus` e mostrar `autopiloto · história n/N · <passo>` no lugar do estado `thinking`/`ready` enquanto a execução estiver ativa.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T048 [P] Em `tests/unit/security/noSecrets.test.ts`, acrescentar uma execução com uma história, uma pergunta e uma resposta contendo um segredo. O `debug.log` só tem eventos e contagens; o segredo aparece só no `decisions.md` e no `.jsonl`, que são os lugares do conteúdo.
- [X] T049 [P] Em `README.md`, acrescentar a seção "Autopiloto":
  - formato do arquivo;
  - comando e `-p`;
  - decisões e registros;
  - portões;
  - segurança (modo `auto`, sem ações remotas por padrão);
  - retomada;
  - a configuração `autopilot`.
- [X] T050 [P] Em `CLAUDE.md`, trocar a linha "011-speckit-autopilot (planned)" pelo estado final e acrescentar um parágrafo de arquitetura sobre `src/autopilot/` (reducer, driver, decisor, `runOverrides`, arquivos protegidos).
- [X] T051 Rodar `npm run typecheck`, `npm run lint`, `npm test` (que inclui o perf) e `npm run build`. Todos devem ficar verdes, e o total de testes tem que ser maior que a linha de base de T001.
- [ ] T052 Executar os 9 cenários de `specs/011-speckit-autopilot/quickstart.md` num repositório descartável e registrar cada divergência como nova tarefa neste arquivo.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)**. A ordem é T002 → T003, T004 e T005, em paralelo por arquivo → T006. T007 a T011 podem correr em paralelo depois de T002.
- **US1 (3)** depende só da fase 2.
- **US2 (4)** depende da US1 (o driver e o fluxo existem).
- **US3 (5)** depende da US1. Ela pode correr em paralelo com a US2, com cuidado em `flow.ts`/`driver.ts`, que são os mesmos arquivos: fazer em sequência.
- **US4 (6)** depende da US1 a US3.
- **US5 (7)** depende da US1. T045 depende de T040 (estado por história).
- **Polish (8)** vem depois de todas.

### Within Each User Story

Os testes vêm primeiro e devem falhar antes da implementação. Depois os módulos puros (`flow`, `gates`, `decider`, `questions`, `log`, `resume`, `report`), depois o `driver` e por fim a interface e a CLI.

### Parallel Opportunities

- Fase 2: T007, T008, T009, T010 e T011.
- US1: T012, T013, T014 e T015. T017 e T018 rodam em paralelo com T016.
- US2: T022, T023 e T024. T026, T027 e T028 também, por serem arquivos diferentes.
- US3: T030, T031 e T032.
- US4: T036, T037 e T038.
- US5: T042, T043 e T044. T045, T046 e T047 também.

---

## Parallel Example: User Story 2

```bash
Task: "T022 tests/unit/autopilot/decider.test.ts"
Task: "T023 tests/unit/autopilot/questions.test.ts"
Task: "T024 tests/unit/autopilot/log.test.ts"
Task: "T026 src/autopilot/decider.ts"
Task: "T027 src/autopilot/questions.ts"
Task: "T028 src/autopilot/log.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3)

1. Fases 1 e 2.
2. US1: o pipeline de uma história com portões de artefato e commits. Validar com o cenário 1 do quickstart, que deve travar só se houver pergunta.
3. US2: o decisor e os registros (cenários 1 e 2).
4. US3: as correções e paradas (cenário 5).
5. **Parar e validar**: uma história vai do arquivo à feature verificada sem interação (SC-001).

### Incremental Delivery

1. MVP (US1 a US3).
2. US4: várias histórias e retomada (cenário 4).
3. US5: `-p`, PR e barra de status (cenários 7 e 9).
4. Polish.

O commit de cada incremento é `fix:`, salvo pedido explícito de `feat:`.

---

## Notes

- Linha de base de testes (T001): 827. Depois da feature: 873 na suíte principal mais 1 de desempenho.
- Testes consolidados: T010, T012–T014, T022–T024, T030–T031, T036–T037 e T043 ficaram em `tests/unit/autopilot/pure.test.ts`, `flow.test.ts` e `wiring.test.tsx`. T015, T025, T032, T038, T042, T043 e T048 ficaram em `tests/integration/autopilot/run.test.ts`, que usa git de verdade num repositório temporário. O T048 (log sem conteúdo) está lá, e não em `noSecrets.test.ts`.
- T009: os dublês são `speckitModel` (modelo roteirizado que segue os comandos do Spec Kit), `fakeVerify` e `fakeRemote`. Não foi preciso um `memoryGit`, porque a integração usa git real.
- Decisões tomadas na implementação, registradas em research.md R8, R12 e R13 e nos contratos:
  - o estado e o `.jsonl` são locais, via `.git/info/exclude`;
  - um passo interrompido vai para um `git stash` nomeado;
  - um passo sem mudança não gera commit;
  - o preflight do clarify foi corrigido, porque exigia `plan.md`; o defeito vinha da feature 006.
- O autopiloto nunca usa `yolo`. As confirmações são sempre recusadas. Ações remotas só acontecem com opção.
- `decisions.md` e `.specify/autopilot.json` só são escritos pelo autopiloto, que os regrava antes de cada commit.
- Nenhuma tarefa adiciona dependência nova.
