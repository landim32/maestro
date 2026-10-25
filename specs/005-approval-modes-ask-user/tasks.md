---

description: "Task list for Modos de Aprovação (TAB), Ferramenta ask_user e Créditos ao qwen-code"
---

# Tasks: Modos de Aprovação (TAB), Ferramenta `ask_user` e Créditos ao qwen-code

**Input**: Design documents from `/specs/005-approval-modes-ask-user/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (approval-modes.md, ask-user.md, attribution.md), quickstart.md

**Tests**: O plano define a estratégia (research R11 e § "Testes que fixam este contrato" de cada contrato): política e reducer testados por tabela sem UI; integração com `mountApp` + `FakeProvider` emitindo `tool_call`; `-p` com `runNonInteractive`; teste de atribuição lendo o repositório. As tarefas de teste abaixo implementam exatamente esses casos. Nenhum teste acessa rede.

**Organization**: Tarefas por história de usuário. Nenhuma dependência nova de runtime. Arquivos marcados **[attrib]** nascem com o cabeçalho de atribuição de contracts/attribution.md § 2 (commit `1c9cdd234fd9a391cac146e2d4c834d603afd045`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: História a que a tarefa pertence (US1, US2, US3)
- Caminhos exatos em cada descrição

## Path Conventions

Projeto único: `src/` e `tests/` na raiz, conforme plan.md § Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Teclas novas no harness de UI e um helper para montar eventos de `tool_call` nos testes de UI.

- [x] T001 Em `tests/helpers/appHarness.tsx`, adicionar a `KEYS`: `tab: '\t'`, `shiftTab: '\u001b[Z'`, `space: ' '` e `digit(n)`; expor em `HarnessOptions` um `events?: ProviderEvent[][]` que alimenta o `FakeProvider` com roteiros por requisição (reusar `createFakeProvider` de `tests/helpers/fakeProvider.ts`) e exportar helpers `toolCall(callId, name, input)` / `answer(text)` iguais aos de `tests/integration/session/toolLoop.test.ts`
- [x] T002 [P] Em `tests/helpers/context.ts`, garantir que `makeSettings()` inclui `tools.approvalMode: 'default'` (ajustar a fábrica para aceitar `overrides.tools.approvalMode`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Política de aprovação pura, classe (`kind`) nas ferramentas, e a chave/argumentos do modo inicial. Bloqueia US1 e US2.

- [x] T003 **[attrib]** Criar `src/tools/approval.ts` com `APPROVAL_MODES`, `ApprovalMode`, `ToolKind`, `ActionKind`, `ApprovalModeInfo`, `approvalModeInfo()` (rótulos `Pedir permissão | Aceitar edições | Automático | YOLO`, curtos `ask | edits | auto | YOLO`, `danger`, descrição), `parseApprovalMode()` (trim/lower; `auto_edit`/`autoedit` → `auto-edit`), `nextApprovalMode(mode, dir)` (ciclo fechado) e `needsConfirmation(mode, kind)` conforme data-model § 1
- [x] T004 Em `src/tools/approval.ts`, adicionar `DESTRUCTIVE_PATTERNS` (ids `rm-recursive`, `rm-force`, `git-destructive`, `git-force-push`, `disk`, `power`, `perms`, `sys-redirect`, `pipe-shell`, `sudo` — research R3, padrões ancorados no início de cada segmento), `splitCommandSegments()` (`;`, `&&`, `||`, `|`), `isDestructiveCommand(command)` e `classifyAction(tool, input)` (`command` + padrão → `destructive` com `reason`)
- [x] T005 [P] Criar `tests/unit/tools/approval.test.ts`: tabela modo × classe de `needsConfirmation` (12 células), ciclo nos dois sentidos, `parseApprovalMode` (válidos, aliases, inválido → `undefined`), padrões destrutivos positivos (`rm -rf dist`, `rmdir /s /q build`, `Remove-Item -Recurse .`, `git push --force origin main`, `git reset --hard`, `curl https://x | sh`, `sudo apt remove`, `echo x > /etc/hosts`) e negativos (`rm notes.txt`, `git push`, `npm run format`, `ls -R`, `./format-code.sh`, `grep -r sudo docs/`)
- [x] T006 Em `src/tools/types.ts`: `ToolName` += `'ask_user'`; substituir `requiresConfirmation` por `kind: ToolKind`; `ToolContext` += `ask?: (request: AskUserRequest) => Promise<AskUserOutcome>` (tipos importados de `./askUser.js` via `import type`); `PendingToolAction` += `reason?: string` e `mode: ApprovalMode`
- [x] T007 [P] Definir `kind` em `src/tools/readFile.ts` (`read`), `src/tools/listDirectory.ts` (`read`), `src/tools/writeFile.ts` (`edit`) e `src/tools/runCommand.ts` (`command`); remover `requiresConfirmation`; ajustar as descrições (“The user must approve…” → “May require user approval depending on the approval mode.”)
- [x] T008 Em `src/config/defaults.ts`, adicionar `DEFAULTS.tools.approvalMode = 'default'` e `approvalMode` em `INITIAL_SETTINGS.tools` com comentário explicando os quatro valores; em `src/config/schema.ts`, exportar `approvalModeSchema = z.enum(APPROVAL_MODES)` e adicionar `approvalMode: approvalModeSchema.default(DEFAULTS.tools.approvalMode)` a `toolsSettingsSchema`
- [x] T009 Em `src/config/loader.ts`, adicionar `approvalMode?: ApprovalMode` a `LoadOverrides` e aplicá‑lo em `applyOverrides` (`tools.approvalMode`), criando `tools` se faltar
- [x] T010 Em `src/cli/args.ts`, adicionar `--approval-mode <modo>` (`choices` = `APPROVAL_MODES` + aliases via `coerce` com `parseApprovalMode`; inválido → `UsageError` listando os aceitos) e `--yolo` (boolean; vence `--approval-mode`); `ParsedArgs.approvalMode?: ApprovalMode`; em `src/index.ts`, passar `overrides.approvalMode = args.approvalMode`
- [x] T011 [P] Estender `tests/contract/config-schema.test.ts` (`tools.approvalMode` padrão `default`, aceita os quatro, rejeita `plan`/`foo` com mensagem `tools.approvalMode: …`), `tests/unit/config/loader.test.ts` (override `approvalMode` vence projeto/global) e `tests/unit/cli/args.test.ts` (`--approval-mode auto`, `--approval-mode auto_edit` → `auto-edit`, `--yolo`, `--yolo --approval-mode default` → `yolo`, `--approval-mode foo` → `UsageError`)

**Checkpoint**: `npm test` verde com `requiresConfirmation` eliminado (turn.ts ainda usa a regra antiga via `kind !== 'read'`, ajustado em US1).

---

## Phase 3: User Story 1 — Alternar o modo de aprovação com TAB (Priority: P1) 🎯 MVP

**Goal**: TAB/Shift+TAB ciclam o modo; barra de status mostra modo e cor; ações seguem a tabela de FR-003; aviso na transcrição para ações automáticas; `/approval-mode`; `-p` obedece ao modo.

**Independent Test**: `tests/integration/ui/approvalMode.test.tsx` + `tests/contract/keys.test.ts` + `tests/integration/cli/nonInteractive.test.ts` (seções § 2–7 de contracts/approval-modes.md).

- [x] T012 [US1] Em `src/session/turn.ts`: `TurnOptions.approvalMode: () => ApprovalMode`; `TurnCallbacks.onAutoApproved?(name, summary, mode)`; em `executeTool`, `const { kind, reason } = classifyAction(tool, input)`; `kind === 'read'` executa direto; `kind === 'question'` executa direto (US2 injeta `ctx.ask`); demais: `needsConfirmation(mode, kind)` → fluxo de confirmação atual com `reason`/`mode` no `PendingToolAction` (sem `cb.confirm` → erro `confirmation required (<modo>); not available in non-interactive mode`), senão calcular `previewText` e chamar `cb.onAutoApproved(tool.name, firstLine(previewText), mode)` antes de `run`
- [x] T013 [US1] Em `src/session/controller.ts`: campo `approvalMode` (inicial `ctx.settings.tools.approvalMode`), `cycleApprovalMode(dir)`, `setApprovalMode(mode)`, `transient?: { text: string; seq: number }` (`modo: <rótulo>`), passar `approvalMode: () => this.approvalMode` a `runTurn`, `onAutoApproved` → `notice('⚙ <name> <alvo> · <summary> · auto (<rótulo>)', 'info')` + `logger.log('approval.auto', { tool, mode })`; `applySettings` não altera o modo da sessão
- [x] T014 [P] [US1] Em `src/session/commands.ts`: comando `approval-mode` (`usage: '/approval-mode [default|auto-edit|auto|yolo]'`; sem argumento → aviso com modo atual e lista com descrições; com argumento → `parseApprovalMode` + `setApprovalMode`, ou aviso `Modo desconhecido 'x'. Opções: …`; em `-p` só informa) e atualizar `/help` (atalho `Tab / Shift+Tab   next / previous approval mode`, linha dos modos) — contracts/approval-modes.md § 7
- [x] T015 [US1] Em `src/ui/hooks/useKeyboard.ts`: nova prop `onCycleMode?: (dir: 1 | -1) => void`; após o bloco `dialogOpen` e antes dos tratamentos por estado, `if (key.tab) { onCycleMode?.(key.shift ? -1 : 1); return; }` (vale em `idle`, `generating`, `awaiting_confirmation`); atualizar o comentário do hook
- [x] T016 [P] [US1] Em `src/ui/components/InputPrompt.tsx`, ignorar `key.tab` e filtrar `\t` do `input` antes de inserir caracteres
- [x] T017 [P] [US1] **[attrib]** Em `src/ui/components/StatusBar.tsx`: props `approvalMode: ApprovalMode` e `transient?: string`; lado esquerdo `<estado> · <rótulo|curto>`; cores (`auto-edit`/`auto` amarelo, `yolo` vermelho + negrito, `YOLO!` sem cor); dica `Tab modo` quando não compacto; `transient` substitui/compõe o `transientNotice` existente — contracts/approval-modes.md § 3
- [x] T018 [P] [US1] Em `src/ui/components/ConfirmationDialog.tsx`, exibir `Confirmação exigida: <reason>` (amarelo) abaixo do título quando `action.reason` existir, e o modo atual no rodapé (`modo: <rótulo>`)
- [x] T019 [US1] Em `src/ui/hooks/useSession.ts` expor `approvalMode: controller.approvalMode` e `transient: controller.transient`; em `src/ui/App.tsx` passar `onCycleMode: (d) => controller.cycleApprovalMode(d)` ao `useKeyboard`, `approvalMode`/`transient` à `StatusBar` (o `transientNotice` local de alt screen continua; o do controller tem prioridade e expira em 3 s por `seq`)
- [x] T020 [P] [US1] Em `src/cli/nonInteractive.ts`, atualizar o comentário (“confirmations required by the approval mode are declined”) e garantir que `⚙ … auto (<modo>)` vai para stderr pelo `flush` existente; em `src/index.ts`, logar `approvalMode` no evento `start`
- [x] T021 [P] [US1] Estender `tests/integration/session/toolLoop.test.ts` (ou `turn.test.ts`): `auto-edit` executa `write_file` sem `confirm` e emite `onAutoApproved`; `auto` executa `run_command` comum e pede confirmação para `rm -rf x` com `reason`; `yolo` executa tudo; `default` sem `confirm` → erro `confirmation required (default)`; getter trocado entre duas chamadas da mesma iteração muda o comportamento
- [x] T022 [P] [US1] Estender `tests/contract/keys.test.ts`: TAB chama `onCycleMode(1)`, Shift+TAB `onCycleMode(-1)`, TAB com `dialogOpen` não chama, TAB em `awaiting_confirmation` chama `onCycleMode` e **não** chama `onConfirm`
- [x] T023 [US1] Criar `tests/integration/ui/approvalMode.test.tsx` com `mountApp`: (a) barra mostra `Pedir permissão`; quatro TABs percorrem os rótulos e voltam; Shift+TAB volta; texto `abc` sobrevive ao TAB; (b) `events` com `tool_call write_file` em `auto-edit` → nenhum `[y]` na tela, aviso `⚙ write_file … auto (Aceitar edições)`, arquivo criado no cwd temporário; (c) em `default` com diálogo pendente, TAB muda a barra e `[y] approve` continua; `n` → `user declined`; (d) `/approval-mode yolo` muda a barra; `/approval-mode foo` avisa; (e) `/model` aberto + TAB não muda o modo
- [x] T024 [P] [US1] Estender `tests/integration/cli/nonInteractive.test.ts`: `tools.approvalMode: 'auto'` executa `write_file` e emite `⚙ … auto (Automático)` em stderr; `default` recusa com `confirmation required (default)`; `auto` recusa `rm -rf` com motivo; `yolo` executa
- [x] T025 [P] [US1] Estender `tests/unit/session/commands.test.ts` (ou criar `tests/unit/session/commands.approval.test.ts`): `/approval-mode` lista, troca, rejeita; `/help` contém `Tab` e `/approval-mode`; `tests/unit/session/controller.dialog.test.ts` ou novo `controller.approval.test.ts`: `cycleApprovalMode` emite `change` e `transient`; `applySettings` preserva o modo da sessão

**Checkpoint**: US1 completa e demonstrável (quickstart 1–7).

---

## Phase 4: User Story 2 — O modelo pergunta ao usuário com `ask_user` (Priority: P2)

**Goal**: Ferramenta `ask_user` com diálogo de múltipla escolha (uma pergunta por vez, "Outro…", múltipla com Espaço, dígitos), resposta formatada ao modelo, cancelamento, disponível em qualquer modo e com `--no-tools`; `-p` responde "sem usuário".

**Independent Test**: `tests/unit/tools/askUser.test.ts`, `tests/unit/setup/askUserFlow.test.ts`, `tests/integration/ui/dialogs.askUser.test.tsx` (contracts/ask-user.md § 1–7).

- [x] T026 [US2] **[attrib]** Criar `src/tools/askUser.ts`: `askUserInputSchema` (data-model § 3, `z.strictObject`, `header` 1–12, `options` 2–4 com rótulos únicos, `multiSelect` default false, `.describe()` em cada campo com os textos de contracts/ask-user.md § 1), tipos `AskUserRequest`/`Answer`/`AskUserOutcome`, `formatAnswers()` (`User has provided the following answers:\n\n**<header>**: <valor>`), constantes `DECLINED_TEXT`/`NO_USER_TEXT`, descrição ao modelo (§ 2) e `askUserTool` (`kind: 'question'`; `run`: sem `ctx.ask` → `{ isError: false, output: NO_USER_TEXT }`; com → aguarda e formata; `{ answered: false }` → `DECLINED_TEXT`)
- [x] T027 [P] [US2] Criar `tests/unit/tools/askUser.test.ts`: `z.toJSONSchema(askUserInputSchema)` tem `minItems/maxItems` e `additionalProperties: false`; validação rejeita 1 opção, 5 opções, `header` de 13 chars, rótulos repetidos, pergunta em branco; `formatAnswers` para única, múltipla (`a, b`) e Outro; `run` sem `ctx.ask` devolve `NO_USER_TEXT` sem erro; `run` com `ctx.ask` resolvendo `{ answered: false }` devolve `DECLINED_TEXT`
- [x] T028 [US2] Em `src/session/session.ts`: `SessionState` += `'awaiting_answer'`; `pendingQuestion?: PendingQuestion` (`{ request: AskUserRequest; resolve(outcome: AskUserOutcome) }`); `setPendingQuestion()` (estado ↔ `awaiting_answer`/`generating`); `endGeneration()` limpa `pendingQuestion`; `cancel()` resolve a pergunta pendente com `{ answered: false }` antes de abortar
- [x] T029 [US2] **[attrib]** Criar `src/setup/askUserFlow.ts` com `AskUserFlowState`, `AskUserKey`, `initialAskUserFlow(questions)` e `askUserReducer(state, key)` seguindo a tabela de transições de data-model § 4 (dígitos, Espaço só em múltipla, Outro vazio → erro, nenhum marcado → erro, `cancel` descarta tudo, reset por pergunta, `done` com `answers` alinhadas às perguntas)
- [x] T030 [P] [US2] Criar `tests/unit/setup/askUserFlow.test.ts`: única por ↑/↓+Enter e por dígito; múltipla com Espaço/dígitos e erro sem marcação; Outro vazio → erro, com texto → resposta `other`; duas perguntas → `done` só após a segunda, `selected`/`checked`/`other` zerados entre elas; `cancel` na segunda → `cancelled` sem respostas; `input` ignorado fora de Outro; dígito fora do intervalo ignorado
- [x] T031 [US2] **[attrib]** Criar `src/ui/dialogs/AskUserDialog.tsx`: `DialogFrame` com título `Pergunta N de M · [<header>]`, texto da pergunta (quebra de linha por `wrap="wrap"`), `SelectList` com itens `n. <label>` + descrição, prefixo `[x]`/`[ ]` em múltipla, item final `Outro…` com `TextField` inline quando ativo (placeholder `Digite sua resposta`), linha de erro, dicas por modo (`↑↓ navegar · 1-9 escolher · Espaço marcar · Enter confirmar · Esc cancelar`), `maxVisible` por `rows`; `flexShrink={0}` no contêiner
- [x] T032 [US2] Em `src/session/controller.ts`: `questionFlow?: AskUserFlowState`; callback `ask` passado a `runTurn` quando `interactive` (cria `PendingQuestion`, `session.setPendingQuestion`, inicializa `questionFlow`, devolve promessa); `dispatchQuestion(key: AskUserKey)` reduz e, em `done`/`cancelled`, resolve a promessa, limpa `questionFlow`/`pendingQuestion`, adiciona à transcrição as linhas `› [<header>] <resposta>` (como `pushUser`? **não** — usar um `notice` de nível `info` com prefixo `› ` para não alterar o histórico enviado ao modelo além do `tool_result`), e loga `ask_user.answered { questions, other }` ou `ask_user.declined`; em `-p` não passa `ask`
- [x] T033 [US2] Em `src/ui/hooks/useKeyboard.ts`: props `questionOpen?: boolean` e `onQuestionKey?: (key: AskUserKey) => void`; quando `state === 'awaiting_answer'`, rotear ↑/↓/Enter/Esc/Espaço/dígitos 1–9 para `onQuestionKey` (Ctrl+C: `cancel` + `onCancel`, segunda vez sai), ignorar o restante (texto vai pelo `TextField`); TAB continua ciclando o modo antes desse bloco; atualizar `tests/contract/keys.test.ts` com esses casos
- [x] T034 [US2] Em `src/ui/App.tsx` e `src/ui/hooks/useSession.ts`: expor `question: controller.questionFlow` e `pendingQuestion`; renderizar `AskUserDialog` no slot do `ConfirmationDialog` quando `state === 'awaiting_answer'`; `onInput` do `TextField` → `controller.dispatchQuestion({ type: 'input', value })`; placeholder do prompt `responda à pergunta acima`
- [x] T035 [P] [US2] Em `src/tools/registry.ts`: incluir `askUserTool` em `ALL`; `toolsFor(settings)` devolve `[askUserTool]` quando `enabled === false`; em `src/session/systemPrompt.ts`, adicionar as linhas sobre `ask_user` (quando usar; não usar para aprovações; o usuário sempre pode escolher Outro) e sobre os modos de aprovação (“some actions may run without asking depending on the user's approval mode”); ajustar `toolsEnabled` para refletir só as ferramentas de workspace
- [x] T036 [US2] Criar `tests/integration/ui/dialogs.askUser.test.tsx` com `mountApp` e `events`: (a) `tool_call ask_user` com uma pergunta → diálogo `Pergunta 1 de 1 · [Banco]`; `↓`+Enter envia; segunda requisição ao `FakeProvider` contém `tool_result` com `**Banco**: SQLite`; transcrição mostra `› [Banco] SQLite`; (b) múltipla + duas perguntas: Espaço, Enter sem marcar → erro, marcar dois, Enter, segunda pergunta Outro com texto → `tool_result` com `a, b` e o texto; (c) Esc → `DECLINED_TEXT` sem `isError`, turno termina; (d) em `yolo` o diálogo aparece igual; (e) TAB durante a pergunta muda a barra e mantém o diálogo; (f) com `tools.enabled: false` a ferramenta ainda é oferecida ao provedor (verificar `request.tools`)
- [x] T037 [P] [US2] Estender `tests/integration/cli/nonInteractive.test.ts`: `tool_call ask_user` em `-p` → `tool_result` com `NO_USER_TEXT`, sem erro, saída final impressa; `tests/unit/security/noSecrets.test.ts`: texto digitado em Outro (`segredo-xyz`) não aparece em `history.jsonl` nem no `debug.log`; `tests/unit/session/session.test.ts`: `setPendingQuestion` ↔ `awaiting_answer`, `cancel()` resolve `{ answered: false }`, `endGeneration` limpa

**Checkpoint**: US2 completa (quickstart 8–11).

---

## Phase 5: User Story 3 — Créditos ao qwen-code e compromisso open-source (Priority: P3)

**Goal**: Cabeçalhos em todos os arquivos adaptados, `THIRD_PARTY_NOTICES.md`, `LICENSE`, `package.json`, README, constituição ratificada, e teste que trava tudo.

**Independent Test**: `tests/unit/license/attribution.test.ts` (contracts/attribution.md § 8) + `npm pack --dry-run`.

- [x] T038 [US3] Criar `THIRD_PARTY_NOTICES.md` na raiz conforme contracts/attribution.md § 3: seção qwen-code (repositório, commit `1c9cdd234fd9a391cac146e2d4c834d603afd045`, release v0.26.1, Apache-2.0, copyrights Qwen Team e Google LLC, tabela `Maestro → Origin` com os cinco arquivos de research R10), seção gemini-cli, e o texto integral da Apache License 2.0 (copiar de https://www.apache.org/licenses/LICENSE-2.0.txt)
- [x] T039 [P] [US3] Verificar/ajustar o cabeçalho **[attrib]** em `src/tools/approval.ts`, `src/tools/askUser.ts`, `src/setup/askUserFlow.ts`, `src/ui/dialogs/AskUserDialog.tsx` e `src/ui/components/StatusBar.tsx` (formato exato de contracts/attribution.md § 2, caminho de origem correto em cada um; se algum arquivo acabou sem material adaptado, removê‑lo da tabela do `THIRD_PARTY_NOTICES.md` em vez de manter um cabeçalho falso)
- [x] T040 [P] [US3] Em `LICENSE`, acrescentar o parágrafo final de contracts/attribution.md § 4; em `package.json`, adicionar `"license": "MIT"` e `LICENSE`, `THIRD_PARTY_NOTICES.md` a `files`; confirmar com `npm pack --dry-run` que os dois arquivos entram no tarball
- [x] T041 [P] [US3] Em `README.md`, adicionar as seções **Licença** (MIT; “é e continuará sendo open-source”) e **Créditos** (qwen-code com link e o que foi adaptado; gemini-cli; Claude Code como inspiração de UX) — contracts/attribution.md § 6
- [x] T042 [P] [US3] Ratificar `.specify/memory/constitution.md` v1.0.0 (Ratified/Last Amended 2026-10-25) com os princípios I–VII de contracts/attribution.md § 7, seção “Restrições” (stack, sem rede em testes, segredos) e “Governança” (emendas por PR; versão semântica da constituição); remover todos os placeholders do template
- [x] T043 [US3] Criar `tests/unit/license/attribution.test.ts` implementando os cinco passos de contracts/attribution.md § 8 (ler a tabela `Files in Maestro` por regex `^\| \x60(src/[^\x60]+)\x60 \|`, verificar cabeçalho nas 12 primeiras linhas, varrer `src/**/*.ts(x)` por `SPDX-License-Identifier: Apache-2.0` fora da tabela, `package.json`, `LICENSE`, `README.md`)

**Checkpoint**: US3 completa (quickstart 12).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T044 [P] Em `README.md`, adicionar a seção **Modos de aprovação** (tabela dos quatro modos, TAB/Shift+TAB, `--approval-mode`/`--yolo`/`tools.approvalMode`/`/approval-mode`, lista de padrões destrutivos com a frase “conveniência, não barreira de segurança”), a linha de `ask_user` na tabela de comandos/teclas e as teclas do diálogo; atualizar a lista de argumentos em “Uso”
- [x] T045 [P] Em `CLAUDE.md` (seção Code Style), registrar: política de aprovação em `src/tools/approval.ts` (puro; `kind` nas ferramentas; `turn.ts` recebe getter); `ask_user` nunca passa por `needsConfirmation` e nunca entra em `history.jsonl`/logs; arquivos adaptados do qwen-code precisam do cabeçalho e da entrada em `THIRD_PARTY_NOTICES.md` (teste `attribution.test.ts`); atualizar a árvore de `src/` com os arquivos novos
- [x] T046 Rodar `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm pack --dry-run`; corrigir o que falhar; conferir que `dist/version.json` continua sendo gerado
- [ ] T047 Executar o quickstart (`specs/005-approval-modes-ask-user/quickstart.md`, cenários 1–12) em terminal real com `MAESTRO_HOME` e pasta de trabalho temporários; registrar divergências como tarefas

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → US1 → US2 → US3 → Polish**. US1 depende da fundação (política, `kind`, `approvalMode` em settings/args). US2 depende de US1 apenas em `turn.ts` (T012 já trata `kind === 'question'`) e em `useKeyboard` (T015 antes de T033). US3 depende de US1/US2 só para os cabeçalhos existirem (T039); `THIRD_PARTY_NOTICES.md`, `LICENSE`, `package.json`, README e constituição (T038, T040–T042) podem ser feitos a qualquer momento após a fundação.
- Dentro de US1: T012 → T013 → (T014, T015, T016, T017, T018 em paralelo) → T019 → T020; testes T021–T025 após o código que cobrem.
- Dentro de US2: T026 → T028 → T029 → T031 → T032 → T033 → T034 → T035; T027/T030 em paralelo com o código seguinte; T036/T037 ao final.

## Parallel Execution Examples

- **Fundação**: T005 (teste de política) em paralelo com T006–T010; T011 em paralelo com T010.
- **US1**: T014, T016, T017, T018 em paralelo após T013; T021, T022, T024, T025 em paralelo após T019.
- **US2**: T027 e T030 em paralelo com T028–T031; T035 em paralelo com T032–T034; T037 em paralelo com T036.
- **US3**: T039–T042 em paralelo após T038.
- **Polish**: T044 e T045 em paralelo.

## Implementation Strategy

1. **MVP = Phase 1 + Phase 2 + US1**: modos com TAB, barra de status, política no turno, `/approval-mode`, `-p` por argumento. Já entrega o pedido principal e pode ser verificado pelos cenários 1–7 do quickstart.
2. **Incremento 2 = US2**: `ask_user` completa, inclusive `--no-tools` e `-p`.
3. **Incremento 3 = US3 + Polish**: atribuição, licença, constituição, README, CLAUDE.md, verificação final. **Não fazer merge sem US3**: a cópia de código do qwen-code exige os avisos.

## Notes

- Nenhuma dependência nova. `z.toJSONSchema` já é usado nos provedores; o esquema de `ask_user` é validado em T027.
- Nunca gravar o modo em `settings.json` a partir de TAB ou `/approval-mode` (FR-007).
- O confinamento à pasta (`resolveInsideCwd`) não depende do modo; YOLO não o relaxa.
- Textos de "Outro…" nunca passam por `InputHistory` nem por `logger.log` com conteúdo.
- Commit da feature: prefixo `fix:` salvo pedido explícito em contrário.
