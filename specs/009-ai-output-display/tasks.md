# Tasks: Exibição da IA no estilo do Claude Code (progresso, transcrição e diff)

**Input**: Design documents from `specs/009-ai-output-display/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: incluídos, porque a constituição (§III) exige testes unitários, de contrato e de integração em toda feature. Testes de UI usam `tests/helpers/renderSized.ts` com `waitFor`/`waitForFrame`, nunca `sleep` fixo. O relógio da linha de atividade é injetado (`clock`) e avançado com `vi.useFakeTimers()`/`vi.advanceTimersByTime`.

**Organization**: as tarefas estão agrupadas por user story (US1, linha de atividade; US2, transcrição; US3, diff). Cada story pode ser entregue e testada sozinha depois da fase Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivo diferente, sem dependência de tarefa incompleta)
- **[Story]**: US1, US2 ou US3, conforme o spec.md

---

## Phase 1: Setup

**Purpose**: nenhuma dependência nova nem estrutura nova de projeto. Só a linha de base.

- [X] T001 Rodar `npm run typecheck`, `npm run lint` e `npm test` na branch `009-ai-output-display` e anotar o total de testes (esperado: 778) na seção Notes de `specs/009-ai-output-display/tasks.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: os tipos compartilhados pelas três stories. Os metadados de exibição precisam existir antes de qualquer componente consumi-los.

**⚠️ CRITICAL**: nenhuma story começa antes desta fase.

- [X] T002 Em `src/tools/types.ts`:
  - acrescentar `ToolResultDisplay` (`{ diff?: FileDiff; autoMode?: ApprovalMode; declined?: boolean; speckitStep?: string; summary?: string }`);
  - acrescentar `ToolResult.display?: ToolResultDisplay`, `ToolDefinition.diff?: (input: I, ctx: ToolContext) => Promise<FileDiff>` e `PendingToolAction.diff?: FileDiff`;
  - importar o tipo `FileDiff` de `./diff.js` (o arquivo é criado em T003).
- [X] T003 Criar `src/tools/diff.ts` só com os tipos `FileDiff`, `DiffHunk` e `DiffLine` (data-model.md § 4) e com `export const DIFF_MAX_BYTES = 1024 * 1024`. A implementação de `fileDiff` vem em T029. Isso deixa T002 compilar sem esperar a US3.
- [X] T004 Em `src/providers/types.ts`, acrescentar `display?: ToolResultDisplay` à parte `tool_result` de `ContentPart`, importando de `../tools/types.js`. Acrescentar um comentário: "exibição apenas; nunca enviado ao modelo".
- [X] T005 Em `src/session/session.ts`, fazer `pushToolResults` aceitar e gravar `display` em cada resultado (`{ callId, output, isError, display? }`).
- [X] T006 Em `src/session/turn.ts`:
  - o `executeTool` devolve `display` em todos os caminhos:
    - recusa: `{ declined: true }`;
    - ação automática: `{ autoMode: mode }`;
    - interceptado: preserva o `display` do resultado interceptado;
  - os dois caminhos de turno (laço embutido e `runProviderDrivenTurn`) passam `display` adiante em `session.pushToolResults`.
- [X] T007 [P] Criar `tests/contract/display.test.ts`. Para cada conversor (`toAnthropicMessages` em `src/providers/anthropicProtocol.ts`, o conversor OpenAI em `src/providers/qwen.ts` e `buildUserMessage` em `src/providers/claudeCodeStream.ts`), verificar que um `tool_result` com `display: { diff, autoMode: 'auto', declined: true, speckitStep: 'x' }` produz a mesma saída que o mesmo resultado sem `display`. Isso fixa a regra "nunca enviado ao modelo".
- [X] T008 [P] Estender `tests/integration/session/toolLoop.test.ts` e `tests/integration/session/providerDrivenTurn.test.ts`:
  - escrita recusada grava `display.declined`;
  - escrita em `auto-edit` grava `display.autoMode = 'auto-edit'`;
  - `intercept` que devolve `display.speckitStep` chega ao `tool_result` do histórico.

**Checkpoint**: tipos e fluxo de metadados prontos, e as stories podem começar.

---

## Phase 3: User Story 1 — Linha de atividade com tempo e tokens (Priority: P1) 🎯 MVP

**Goal**: durante o turno, uma linha `✻ Contemplando… (13s · ↓ 304 tokens · Esc para interromper)` fixa acima do prompt. No fim, um resumo `✻ 13s · ↓ 304 tokens` na transcrição.

**Independent Test**: com um provedor falso que emite texto aos poucos e `usage` no fim, a linha aparece antes do primeiro token, o tempo avança com o relógio falso, os tokens crescem com `~` e o resumo aparece no fim (contracts/activity-line.md).

### Tests for User Story 1

- [X] T009 [P] [US1] Criar `tests/unit/session/activity.test.ts`, com o reducer de data-model.md § 1:
  - `start` → `waiting` com o verbo sorteado pelo `random` injetado;
  - `delta` → `responding`, com `estChars` somando;
  - `usage` zera `estChars` e liga `anyReal`;
  - `toolStart`/`toolEnd`, `confirm` e `question` mudam a fase e voltam;
  - `outTokens` = real + `ceil(estChars / 4)`;
  - `summarize`, com e sem cancelamento;
  - `formatElapsed`: `0s`, `59s`, `1m 05s`, `12m 00s`;
  - `formatSummary`: `✻ 13s · ↓ 304 tokens`, `✻ interrompido · 4s · ↓ ~20 tokens` e o trecho de tokens omitido quando o valor é 0.
- [X] T010 [P] [US1] Criar `tests/unit/ui/ActivityLine.test.tsx`, usando `renderSized` com 100 e com 40 colunas, `clock` injetado e fake timers:
  - formato completo;
  - frase por fase (`Executando Bash…`, `Aguardando sua confirmação…`, `Aguardando sua resposta…`);
  - `~` antes do primeiro valor real;
  - encurtamento (sai a dica, depois os tokens; abaixo de 20 colunas, `✻ <tempo>`);
  - sem cor: símbolo fixo `✻`;
  - com cor: o símbolo muda depois de 200 ms.
- [X] T011 [P] [US1] Criar `tests/integration/ui/activity.test.tsx`, com `mountApp` de `tests/helpers/appHarness.tsx` e um provedor falso com `delayMs`:
  - a linha aparece em `waitForFrame` antes do texto;
  - some no fim;
  - o aviso `✻ … · ↓ N tokens` fica na transcrição com o `N` igual a `usage.outputTokens`;
  - Esc durante o turno gera `✻ interrompido`;
  - `/help` não mostra a linha;
  - o cursor `▍` não existe mais.

### Implementation for User Story 1

- [X] T012 [US1] Criar `src/session/activity.ts`, puro:
  - `Activity`, `ActivityEvent`, `WAIT_VERBS` (research R3) e `initialActivity(at, random)`;
  - `activityReducer(state, event)`, `outTokens(state)`, `isApproximate(state)` e `phraseOf(state)`;
  - `summarize(state, { at, cancelled })`, `formatElapsed(ms)`, `formatTokens(n, approx)` e `formatSummary(summary)`.
- [X] T013 [US1] Em `src/session/turn.ts`, acrescentar `TurnCallbacks.onUsage?: (inputTokens: number, outputTokens: number) => void` e chamá-lo em `collect` a cada evento `usage`, nos dois caminhos de turno.
- [X] T014 [US1] Em `src/session/controller.ts`:
  - acrescentar `activity?: Activity` e as opções injetáveis `clock` e `random` em `ControllerOptions`, com padrão `Date.now`/`Math.random`;
  - em `submit`, iniciar a atividade antes de `runTurn`, alimentá-la em `onDelta` (caracteres), `onUsage`, `onToolStart` (rótulo de `describeCall` de `src/ui/toolDisplay.ts`; até a US2 existir, usar o nome da ferramenta) e `onToolEnd`, e emitir `change` só quando a fase muda ou o texto chega;
  - observar `session.setPendingConfirmation`/`setPendingQuestion` pelas transições de estado já emitidas para as fases `confirm`/`question`;
  - no fim, com `this.interactive` verdadeiro, emitir o aviso `formatSummary(summarize(…))` (cancelado = `result.stopReason === 'cancelled'`), zerar `activity` e registrar `outTokensShown`/`approximate` em `turn.end`.
- [X] T015 [US1] Em `src/ui/hooks/useSession.ts`, expor `activity: controller.activity` no snapshot.
- [X] T016 [US1] Criar `src/ui/components/ActivityLine.tsx`:
  - props `{ activity, width, color, clock?, frameMs? }`;
  - `setInterval` local (200 ms com cor, 1000 ms sem cor) que só atualiza um contador de quadro;
  - símbolos `· ✢ ✳ ✶ ✻ ✽` em ida e volta;
  - texto montado com as funções de `src/session/activity.ts`;
  - encurtamento por largura com `string-width` (contracts/activity-line.md § 3);
  - `flexShrink={0}`; limpar o intervalo no unmount.
- [X] T017 [US1] Em `src/ui/App.tsx`, renderizar `ActivityLine` entre `Transcript` e `InputPrompt` quando `snap.activity` existir, e descontar a linha (1) da altura disponível para a transcrição, como já é feito com as outras regiões fixas.
- [X] T018 [US1] Em `src/ui/components/MessageList.tsx`, remover o cursor `▍` do bloco `generating`, mantendo o texto parcial.
- [X] T019 [US1] Rodar `npm run test:perf` e confirmar que `tests/integration/ui/perf.test.tsx` passa com a linha de atividade ativa (SC-006). Se não passar, subir `frameMs` para 300 e registrar o motivo em research.md R2.

**Checkpoint**: a US1 funciona sozinha, e a transcrição continua no formato antigo.

---

## Phase 4: User Story 2 — Transcrição no formato do Claude Code (Priority: P1)

**Goal**: `⏺` no texto do assistente, `⏺ Rótulo(argumento)` em cada chamada com `⎿ resumo` logo abaixo, e nenhum aviso `⚙` duplicado na sessão interativa.

**Independent Test**: um turno falso com leitura, listagem, comando de saída longa, comando com falha, escrita automática, escrita recusada e um passo do Spec Kit gera a transcrição de contracts/transcript.md. O `-p` gera o mesmo stdout de antes.

### Tests for User Story 2

- [X] T020 [P] [US2] Criar `tests/unit/ui/toolDisplay.test.ts`, cobrindo `describeCall` e `describeResult` para cada linha da tabela de research.md R9:
  - `Read`/`Leu N linhas` a partir do cabeçalho `(N lines…)`;
  - `List`/`N itens`;
  - `Bash` no POSIX e `Cmd` no win32, com 5 linhas, `… +N linhas` e sem a linha `exit code`;
  - `Write` com `display.diff`;
  - `Pergunta`;
  - `Speckit(passo)`;
  - formato genérico;
  - erro com 20 linhas e `… +N`, `recusado pelo usuário`, `cancelado` e o sufixo `· auto (Aceitar edições)`;
  - corte de argumento longo (no meio para caminhos, no fim para comandos).
- [X] T021 [P] [US2] Criar `tests/integration/ui/transcript.test.tsx`, com `mountApp` e um provedor falso roteirizado (`createFakeProvider`):
  - frame com `⏺ ` antes do texto;
  - `⏺ Read(notes.txt)` seguido de `⎿  Leu`;
  - nenhuma linha começando com `⚙` ou `✓`;
  - resultado de erro em uma chamada falha;
  - `⇢ rota · provedor` acima do `⏺` numa resposta de rota diferente de `chat`.
- [X] T022 [P] [US2] Estender `tests/integration/cli/nonInteractive.test.ts`:
  - o stdout de um turno com ferramentas é igual ao de antes (fixar a string esperada);
  - o stderr continua com `⚙ read_file …`;
  - o stderr não traz `✻` (SC-007, contracts/transcript.md § 5).

### Implementation for User Story 2

- [X] T023 [US2] Criar `src/ui/toolDisplay.ts`, puro:
  - `describeCall(name, input, platform)` → `{ label, arg }`;
  - `describeResult(name, input, part)` → `{ tone, lines, diff?, more? }`, com as constantes `COMMAND_LINES = 5`, `ERROR_LINES = 20` e `ARG_MAX` relativo à largura (recebida como parâmetro);
  - `truncateMiddle`/`truncateEnd` com `string-width`.

  O rótulo do comando vem de `shellFor(platform)` em `src/tools/runCommand.ts` (`cmd.exe` → `Cmd`, senão `Bash`).
- [X] T024 [US2] Em `src/ui/components/MessageList.tsx`:
  - montar `resultsById: Map<string, tool_result>` a partir de `history`;
  - no assistente, prefixar o primeiro bloco de texto com `⏺` (cinza; no bloco `generating`, branco), recuando o markdown 2 colunas;
  - desenhar cada `tool_call` como `⏺ <label em negrito>(<arg>)` com o resultado pareado em `  ⎿  <linhas>` (tom ok/erro/muted) e, quando houver `diff`, um placeholder com `⎿  +A −R linhas`, que vira `DiffView` em T034;
  - não desenhar mensagens `role: 'tool'` cujos resultados estão pareados (órfãos usam o formato genérico);
  - incluir as referências dos resultados das chamadas no comparador do `memo`;
  - manter a linha `⇢` da rota.
- [X] T025 [US2] Em `src/session/controller.ts`, só quando `this.interactive` for verdadeiro, parar de emitir os avisos `⚙ <tool> <arg>` (`onToolStart`), `⚙ … · auto (…)` (`onAutoApproved`, mantendo o log `approval.auto`), `⚠ <tool>: …` (`onToolEnd`) e `⚙ speckit …`/`⚠ speckit …` (`specKit.onStep`). No `-p` tudo continua como hoje. Os avisos de `result.warnings` dos passos continuam em ambos.
- [X] T026 [US2] Em `src/speckit/service.ts` (função `intercept`), anexar `display: { speckitStep: <passo>, summary: <resumo do passo> }` ao `ToolResult` devolvido, para que a transcrição mostre `⏺ Speckit(passo)` com `⎿ resumo`. Em `src/ui/toolDisplay.ts`, um `run_command` com `display.speckitStep` usa o rótulo `Speckit` e o argumento do passo.
- [X] T027 [US2] Atualizar os testes existentes que procuram `⚙`/`✓` no frame da sessão interativa, como `tests/integration/ui/approvalMode.test.tsx` e `tests/integration/ui/speckit.test.tsx`. Para encontrá-los, rodar `grep -rln "⚙\|✓" tests/integration/ui`. Eles devem passar a esperar o formato novo (`⏺ Write(…)` + `· auto (…)`; `⏺ Speckit(…)`), sem afrouxar as asserções.

**Checkpoint**: a US1 e a US2 funcionam juntas, e o diff ainda aparece só como resumo.

---

## Phase 5: User Story 3 — Diff de escrita como no Claude Code (Priority: P2)

**Goal**: o diálogo de confirmação e a transcrição mostram o mesmo diff, com caminho, `+A −R`, números de linha, 3 linhas de contexto e cores. Arquivo novo, sem mudança, só fim de linha e binário ou grande têm resumos próprios.

**Independent Test**: uma alteração de 3 linhas num arquivo de 200 linhas mostra os números corretos no diálogo e, depois de aprovada, na transcrição. Arquivo novo, escrita idêntica e troca CRLF/LF mostram os resumos de contracts/diff-view.md.

### Tests for User Story 3

- [X] T028 [P] [US3] Criar `tests/unit/tools/diff.test.ts`, cobrindo cada linha da tabela de contracts/diff-view.md § 1:
  - `new` numera de 1;
  - `unchanged`;
  - `eol` (CRLF ↔ LF);
  - `binary` (NUL);
  - `large` (> `DIFF_MAX_BYTES`);
  - `edit` com dois trechos distantes, números antigos e novos corretos, no máximo 3 linhas de contexto, `added`/`removed` iguais à contagem das linhas;
  - falta de quebra de linha no fim sem gerar a linha `\ No newline`;
  - `formatDiffText` com números e prefixos.
- [X] T029 [P] [US3] Criar `tests/unit/ui/DiffView.test.tsx`, com `renderSized` e com e sem cor:
  - cabeçalho por `kind` (contracts/diff-view.md § 2);
  - coluna de número com a largura do maior número;
  - `-` com número antigo e `+` com número novo;
  - `⋮` entre trechos;
  - limite `maxLines` com `… +N linhas`;
  - linha longa quebra sem estourar a largura.
- [X] T030 [P] [US3] Criar `tests/integration/ui/diff.test.tsx`, com `mountApp` num diretório temporário com um arquivo de 200 linhas e um provedor falso que pede `write_file` alterando as linhas 100–102:
  - no modo `default`, o diálogo mostra `· +3 −3` e o número 100;
  - depois de aprovar, a transcrição mostra `⏺ Write(…)`, `⎿  +3 −3 linhas` e as mesmas linhas;
  - uma escrita recusada mostra `recusado pelo usuário` sem números;
  - em `auto-edit`, o diff aparece com `· auto (Aceitar edições)`.

### Implementation for User Story 3

- [X] T031 [US3] Em `src/tools/diff.ts`, implementar:
  - `fileDiff(oldText: string | null, newText: string, path: string): FileDiff`, com `structuredPatch` do pacote `diff`, `context: 3`, numeração a partir de `oldStart`/`newStart` e linhas `\ No newline` descartadas;
  - os casos `new`, `unchanged`, `eol`, `binary` e `large`;
  - `formatDiffText(diff, maxLines?)`, em texto puro, para o formato genérico.
- [X] T032 [US3] Em `src/tools/writeFile.ts`:
  - implementar `diff(input, ctx)`: `resolveInsideCwd`, ler o arquivo atual (`null` se não existir) e chamar `fileDiff`;
  - manter o `preview` em texto como está, porque a primeira linha dele é o anúncio do `-p` (decisão tomada na implementação; ver contracts/diff-view.md § 5).

  Conferir que os testes existentes de `tests/unit/tools/writeFile.test.ts` continuam passando. Atualizar só as strings de cabeçalho que mudarem e registrar a mudança no commit.
- [X] T033 [US3] Em `src/session/turn.ts`, no `executeTool`, depois da validação e da interceptação e antes da política de aprovação, chamar `tool.diff?.(input, ctx)` uma vez, protegido por `try/catch`. O resultado vai para `PendingToolAction.diff` e para `result.display.diff` quando a ferramenta rodar. Uma escrita recusada não leva o `diff`.
- [X] T034 [US3] Criar `src/ui/components/DiffView.tsx`:
  - props `{ diff, width, color, maxLines, header: 'dialog' | 'transcript' }`;
  - cabeçalho conforme o `kind`;
  - linhas com coluna de número, prefixo e cor (vermelho para `-`, verde para `+`, cinza para o contexto);
  - `⋮` entre trechos;
  - limite com `… +N linhas`;
  - `Text wrap="wrap"` com recuo após a coluna de número.
- [X] T035 [US3] Em `src/ui/components/ConfirmationDialog.tsx`, quando `action.diff` existir, renderizar `DiffView` com `header: 'dialog'` e o `maxLines` atual no lugar das linhas de `previewText`. Sem diff, o comportamento continua como hoje.
- [X] T036 [US3] Em `src/ui/components/MessageList.tsx`, trocar o placeholder de T024 por `DiffView` com `header: 'transcript'` e `maxLines = 40` sob o `⎿` das chamadas `write_file` que tenham `display.diff`.

**Checkpoint**: as três stories funcionam juntas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T037 [P] Em `tests/unit/security/noSecrets.test.ts`, acrescentar um caso: um turno interativo com `write_file` cujo conteúdo é um segredo não grava esse conteúdo em `~/.maestro/debug.log` (`turn.end` e `turn.activity` só com contagens) nem em `history.jsonl` (FR-022).
- [X] T038 [P] Em `README.md`, documentar:
  - a linha de atividade (frase, tempo, tokens e `~` para estimativa);
  - o novo formato da transcrição (`⏺`/`⎿`);
  - o diff de escrita.

  Acrescentar em "Créditos": "O formato da exibição segue o comportamento visual do Claude Code e do OpenClaude (https://github.com/Twigpine/openclaude), usado como referência; nenhum código dele foi incorporado".
- [X] T039 [P] Em `CLAUDE.md`, trocar a linha "009-ai-output-display (planned)" de "Active Technologies" pelo estado final e acrescentar um parágrafo curto em "Architecture" sobre `session/activity.ts`, `ui/toolDisplay.ts`, `tools/diff.ts` e o campo `tool_result.display`, mais a regra de que os avisos `⚙` são só do `-p`.
- [X] T040 Rodar `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` (que inclui o `test:perf`) e `npm run build`. Todos devem ficar verdes, e o total de testes tem que ser maior que a linha de base de T001.
- [ ] T041 Executar os 12 cenários de `specs/009-ai-output-display/quickstart.md` na sessão interativa e registrar cada divergência como nova tarefa neste arquivo.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: não depende de nada.
- **Foundational (Phase 2)**: depende do Setup e bloqueia todas as stories. A ordem é T003 → T002 → T004 → T005 → T006. T007 e T008 rodam em paralelo depois de T006.
- **US1 (Phase 3)**: depende só da Foundational.
- **US2 (Phase 4)**: depende só da Foundational. T014 usa `describeCall`, e se a US2 ainda não existir, usa o nome da ferramenta.
- **US3 (Phase 5)**: depende da Foundational. T036 depende de T024 (US2), e o restante da US3 é independente.
- **Polish (Phase 6)**: depende das stories que forem entregues.

### User Story Dependencies

- **US1**: independente.
- **US2**: independente. Ela refina o rótulo da fase `tool` da US1.
- **US3**: T031–T035 são independentes, e T036 precisa da transcrição da US2.

### Within Each User Story

- Os testes vêm antes e devem falhar antes da implementação.
- Primeiro os módulos puros (`activity.ts`, `toolDisplay.ts`, `diff.ts`), depois a ligação no controller e no turno, depois os componentes e por fim `App`/`MessageList`.

### Parallel Opportunities

- Phase 2: T007 e T008.
- US1: T009, T010 e T011, que são arquivos de teste diferentes. T012 também roda em paralelo com T013.
- US2: T020, T021 e T022. T023 roda em paralelo com T025 e T026.
- US3: T028, T029 e T030. T031 e T034 rodam em paralelo, desde que T034 use só os tipos.
- As stories US1 e US2 podem ser tocadas em paralelo por pessoas diferentes depois da Phase 2.

---

## Parallel Example: User Story 1

```bash
# Testes da US1 em paralelo:
Task: "T009 tests/unit/session/activity.test.ts"
Task: "T010 tests/unit/ui/ActivityLine.test.tsx"
Task: "T011 tests/integration/ui/activity.test.tsx"

# Módulos independentes:
Task: "T012 src/session/activity.ts"
Task: "T013 TurnCallbacks.onUsage em src/session/turn.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T028 tests/unit/tools/diff.test.ts"
Task: "T029 tests/unit/ui/DiffView.test.tsx"
Task: "T031 fileDiff em src/tools/diff.ts"
Task: "T034 src/ui/components/DiffView.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 e Phase 2.
2. Phase 3 (US1). Validar com o teste independente e com os cenários 1, 2 e 9 do quickstart.
3. Parar e validar: a linha de atividade sozinha já resolve "parece travado".

### Incremental Delivery

1. Incremento 1: US1, a linha de atividade e o resumo.
2. Incremento 2: US2, a transcrição `⏺`/`⎿` sem os `⚙` duplicados (cenários 3, 4 e 10).
3. Incremento 3: US3, o diff no diálogo e na transcrição (cenários 5 a 8).
4. Polish: README, CLAUDE.md, segredos e quickstart completo.

Cada incremento passa por `typecheck`/`lint`/`test` antes do próximo. O commit de cada incremento é `fix:`, conforme o CLAUDE.md.

---

## Notes

- Linha de base de testes (T001): 778 na `main` (964a08a). Depois da feature: 823 na suíte principal mais 1 de desempenho. A T032 manteve o `preview` em texto do `write_file`, e a implementação corrigiu a contagem do `read_file` para não contar a linha vazia depois da última quebra.
- `[P]` indica arquivo diferente sem dependência pendente.
- Nenhuma tarefa adiciona dependência nova nem chave nova em `settings.json` (constituição §I).
- O `-p` não pode mudar o stdout. T022 é a guarda.
- O OpenClaude é só referência. Nenhuma tarefa copia código dele (constituição §VII).
