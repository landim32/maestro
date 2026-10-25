# Implementation Plan: Modos de Aprovação (TAB), Ferramenta `ask_user` e Créditos ao qwen-code

**Branch**: `005-approval-modes-ask-user` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-approval-modes-ask-user/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Três entregas. (1) **Modos de aprovação** `default | auto-edit | auto | yolo` (valores do qwen-code), ciclados com TAB/Shift+TAB, visíveis na barra de status, configuráveis por `--approval-mode`/`--yolo`/`tools.approvalMode` e `/approval-mode`, nunca gravados pela troca; a decisão "pede ou executa" sai de `requiresConfirmation` e vai para um módulo puro `src/tools/approval.ts` (classe da ação × modo, com lista de padrões destrutivos), consultado por `turn.ts` a cada chamada de ferramenta — também no `-p`. (2) **Ferramenta `ask_user`** (esquema, descrição e formato de resposta adaptados de `ask_user_question` do qwen-code), com diálogo de múltipla escolha acima do prompt (reducer puro `askUserFlow.ts`, estado `awaiting_answer` na sessão, promessa resolvida pela UI), sempre exibida em qualquer modo e disponível com `--no-tools`. (3) **Créditos e open-source**: cabeçalho de atribuição nos arquivos adaptados, `THIRD_PARTY_NOTICES.md` com a Apache-2.0, `LICENSE`/`package.json`/README atualizados, constituição ratificada com os princípios de open-source permanente e atribuição, e um teste que trava tudo isso. Nenhuma dependência nova. Detalhes em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.  
**Primary Dependencies**: existentes — `ink` 8 (`useInput` com `key.tab`/`key.shift`), `zod` 4 (`z.strictObject` + `z.toJSONSchema` para o esquema de `ask_user`), `yargs` (novos argumentos). Nenhuma nova.  
**Storage**: `settings.json` ganha `tools.approvalMode` (lido; a troca por TAB não grava). Novos arquivos de repositório: `THIRD_PARTY_NOTICES.md`; `LICENSE`, `package.json`, `README.md`, `.specify/memory/constitution.md` alterados.  
**Testing**: `vitest` + `renderSized`/`appHarness` (`FakeProvider` emitindo `tool_call`), `tempHome`; reducers e política testados por tabela; teste de atribuição lê o repositório.  
**Target Platform**: Windows, macOS, Linux (padrões destrutivos cobrem `cmd`/PowerShell e `sh`).  
**Project Type**: CLI (mesmo pacote).  
**Performance Goals**: TAB reflete na barra no mesmo frame; `isDestructiveCommand` em < 1 ms por comando (regex sobre segmentos); diálogo de `ask_user` abre no frame seguinte ao `tool_call`.  
**Constraints**: confinamento à pasta independe do modo; `ask_user` nunca é respondida automaticamente; texto de "Outro…" nunca entra em `history.jsonl`/logs; `-p` continua recusando por padrão; atribuição Apache-2.0 completa antes do merge.  
**Scale/Scope**: 4 arquivos novos em `src/` (`tools/approval.ts`, `tools/askUser.ts`, `setup/askUserFlow.ts`, `ui/dialogs/AskUserDialog.tsx`), 1 na raiz (`THIRD_PARTY_NOTICES.md`), ~16 alterados; 6 arquivos de teste novos, ~7 estendidos.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constituição ainda é o template; esta feature a **ratifica** (FR-024, contracts/attribution.md § 7). Gates contra os princípios adotados nas features anteriores mais os dois novos.

| Gate | Pré‑Phase 0 | Pós‑Phase 1 |
|---|---|---|
| **I. Simplicidade / YAGNI** | PASS — sem modo `plan`, sem classificador LLM, lista de regex para destrutivos | PASS — `ask_user` reutiliza `DialogFrame`/`SelectList`/`TextField`; sem abas |
| **II. CLI texto I/O** | PASS — `-p` obedece ao modo por argumento; `ask_user` responde "sem usuário" | PASS — [contracts/approval-modes.md § 6](./contracts/approval-modes.md) |
| **III. Testabilidade** | PASS — política e reducer puros; `ask` injetável como `confirm` | PASS — research R11 |
| **IV. Segurança de credenciais** | PASS — "Outro…" fora do histórico e dos logs | PASS — [contracts/ask-user.md § 5](./contracts/ask-user.md) |
| **V. Observabilidade mínima** | PASS — `ask_user.answered/declined`, `approval.auto` no `--debug` sem conteúdo | PASS |
| **VI. Open-source permanente** | PASS — `license: MIT`, nunca `private`, declaração no README | PASS — [contracts/attribution.md § 5–7](./contracts/attribution.md) |
| **VII. Atribuição de terceiros** | PASS — cabeçalho + `THIRD_PARTY_NOTICES.md` + teste | PASS — research R9/R10 |

**Violações a justificar**: nenhuma.

## Project Structure

### Documentation (this feature)

```text
specs/005-approval-modes-ask-user/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── approval-modes.md   # modos, teclas, barra, transcrição, args, -p, /approval-mode
│   ├── ask-user.md         # esquema, descrição, diálogo, saída, histórico
│   └── attribution.md      # referência, cabeçalho, THIRD_PARTY_NOTICES, LICENSE, package.json, README, constituição, teste
├── checklists/requirements.md
└── tasks.md                # /speckit.tasks
```

### Source Code (repository root)

```text
THIRD_PARTY_NOTICES.md          # NOVO (contracts/attribution.md § 3)
LICENSE                         # + parágrafo final
package.json                    # + license, files
README.md                       # + Modos de aprovação, ask_user, Licença, Créditos
.specify/memory/constitution.md # ratificada v1.0.0

src/
├── tools/
│   ├── approval.ts           # NOVO [attrib]: APPROVAL_MODES, parseApprovalMode, nextApprovalMode, DESTRUCTIVE_PATTERNS,
│   │                         #   isDestructiveCommand, classifyAction, needsConfirmation, approvalModeInfo
│   ├── askUser.ts            # NOVO [attrib]: askUserInputSchema, askUserTool (kind 'question'), formatAnswers, textos fixos
│   ├── types.ts              # ToolName + 'ask_user'; kind substitui requiresConfirmation; ToolContext.ask; PendingToolAction.reason/mode
│   ├── readFile.ts, listDirectory.ts, writeFile.ts, runCommand.ts  # kind
│   └── registry.ts           # ALL + askUserTool; toolsFor → [askUserTool] quando desabilitado
├── session/
│   ├── turn.ts               # approvalMode() getter; classify → confirm | onAutoApproved; ask_user via ctx.ask; onAutoApproved
│   ├── session.ts            # 'awaiting_answer'; pendingQuestion; setPendingQuestion; endGeneration limpa
│   ├── controller.ts         # approvalMode, cycle/set, transient, questionFlow, dispatchQuestion, ask callback, logs
│   ├── commands.ts           # /approval-mode; /help com TAB, modos, ask_user
│   └── systemPrompt.ts       # parágrafo sobre ask_user e modos
├── setup/
│   └── askUserFlow.ts        # NOVO [attrib]: AskUserFlowState, AskUserKey, initialAskUserFlow, askUserReducer
├── config/
│   ├── schema.ts             # tools.approvalMode (approvalModeSchema)
│   ├── defaults.ts           # DEFAULTS.tools.approvalMode = 'default'; INITIAL_SETTINGS
│   └── loader.ts             # overrides.approvalMode → tools.approvalMode
├── cli/
│   └── args.ts               # --approval-mode, --yolo; help text
├── index.ts                  # passa overrides.approvalMode
└── ui/
    ├── hooks/useKeyboard.ts  # TAB/Shift+TAB → onCycleMode; awaiting_answer → onQuestionKey (↑↓ Enter Esc Espaço dígitos)
    ├── hooks/useSession.ts   # approvalMode, question, transient
    ├── App.tsx               # AskUserDialog no slot do ConfirmationDialog; transient do controller; placeholder
    ├── components/InputPrompt.tsx     # ignora key.tab
    ├── components/StatusBar.tsx       # [attrib] modo + cores; dica "Tab modo"
    ├── components/ConfirmationDialog.tsx  # linha "Confirmação exigida: <motivo>"
    └── dialogs/AskUserDialog.tsx      # NOVO [attrib]: pergunta N de M, opções, [x], Outro… (TextField), erros

tests/
├── unit/tools/approval.test.ts             # NOVO
├── unit/tools/askUser.test.ts              # NOVO
├── unit/setup/askUserFlow.test.ts          # NOVO
├── unit/license/attribution.test.ts        # NOVO
├── integration/ui/approvalMode.test.tsx    # NOVO
├── integration/ui/dialogs.askUser.test.tsx # NOVO
├── contract/keys.test.ts                   # + TAB
├── contract/config-schema.test.ts          # + tools.approvalMode
├── unit/cli/args.test.ts (ou existente)    # + --approval-mode/--yolo
├── unit/session/turn.test.ts (ou existente)# + modo × classe no executeTool
├── integration/cli/nonInteractive.test.ts  # + -p com modos; ask_user sem usuário
├── unit/security/noSecrets.test.ts         # + Outro… fora do histórico/log
└── helpers/appHarness.tsx                  # FakeProvider com tool_call programável; KEYS.tab/shiftTab/space
```

`[attrib]` = arquivo com cabeçalho de atribuição ao qwen-code (research R10).

**Structure Decision**: a política de aprovação fica em `src/tools/` porque classifica ferramentas e não conhece UI; o modo vivo fica no `SessionController` (política da sessão) e chega ao turno por getter, para que a troca por TAB valha no meio de um turno. `ask_user` segue o molde de `pendingConfirmation`: a sessão guarda a pergunta pendente, a UI resolve a promessa, e o fluxo de teclas é um reducer puro em `src/setup/` como `/auth` e `/model`. Licenciamento é tratado como contrato com teste, não como tarefa de documentação solta.

## Complexity Tracking

Nenhuma violação. Tabela intencionalmente vazia.

## Phase 0 — Research (concluída)

[research.md](./research.md): R0 estado atual; R1 modos do qwen-code (referência fixada no commit `1c9cdd23…`, Tab no Windows, `tools.approvalMode`, `/approval-mode`); R2 onde vive a decisão (`kind` + `approval.ts` + getter no turno); R3 padrões destrutivos; R4 `ask_user_question` do qwen-code; R5 caminho ida‑e‑volta do `ask_user`; R6 TAB; R7 modo no controller; R8 `--no-tools`; R9 atribuição e licença; R10 arquivos atribuídos; R11 testes. Sem `NEEDS CLARIFICATION`.

## Phase 1 — Design (concluída)

- [data-model.md](./data-model.md) — `ApprovalMode`/política, `ToolDefinition.kind`, `ask_user` (esquema, respostas), `AskUserFlowState` + transições, Session/Controller, configuração/argumentos, `/approval-mode`, avisos de terceiros.
- [contracts/approval-modes.md](./contracts/approval-modes.md), [contracts/ask-user.md](./contracts/ask-user.md), [contracts/attribution.md](./contracts/attribution.md).
- [quickstart.md](./quickstart.md).
- `CLAUDE.md` atualizado pelo script de contexto.

## Phase 2 — Próximo passo

`/speckit.tasks`. Ordem sugerida: fundação (`approval.ts` + testes de tabela; `kind` nas ferramentas; `tools.approvalMode` em schema/defaults/loader/args) → US1 (turno com getter + `onAutoApproved`; controller `approvalMode`/`transient`; `useKeyboard` TAB; `InputPrompt`; `StatusBar`; `ConfirmationDialog` motivo; `/approval-mode`; `-p`; testes de UI/CLI) → US2 (`askUser.ts`; `Session.pendingQuestion`; `askUserFlow.ts`; `AskUserDialog`; roteamento de teclas; `registry`/`systemPrompt`; testes) → US3 (cabeçalhos, `THIRD_PARTY_NOTICES.md`, `LICENSE`, `package.json`, README, constituição, teste de atribuição) → polish (`/help`, quickstart, CLAUDE.md).

## Riscos

| Risco | Mitigação |
|---|---|
| Terminal não reporta Shift+TAB (chega como TAB) | TAB sozinho alcança qualquer modo em ≤ 3 toques; Shift+TAB é extra |
| Ink entrega `\t` como texto em algum terminal | `InputPrompt` ignora `key.tab` **e** filtra `\t` do `input` |
| Falso positivo da lista destrutiva (`format-code.sh`) | Padrões ancorados no início do segmento/comando (`^\s*format\b`), testes negativos; só pede confirmação, nunca bloqueia |
| Falso negativo (comando destrutivo não listado em `auto`) | Documentado como conveniência; `default` continua o padrão; lista extensível |
| `ask_user` chamada em paralelo com outras ferramentas no mesmo `tool_use` | `executeTool` é sequencial; a pergunta bloqueia as seguintes até ser respondida |
| Cancelamento (Esc duplo/Ctrl+C) durante `ask_user` | `endGeneration` limpa `pendingQuestion`; `abort` resolve `{ answered: false }`; teste de UI |
| JSON Schema de `ask_user` com `default`/`maxLength` rejeitado por algum endpoint OpenAI‑compatível | Teste de contrato valida o schema gerado; se necessário, `z.toJSONSchema` com `io: 'input'` e sem `default` |
| Atribuição esquecida em arquivo novo | Teste § 8.3 falha para qualquer `SPDX … Apache-2.0` fora da tabela e para arquivo da tabela sem cabeçalho |
| Referência do qwen-code mudar (usuário fornece outra) | Commit em um só lugar por arquivo + tabela; busca‑e‑substitui simples |
