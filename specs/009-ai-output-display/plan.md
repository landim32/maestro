# Implementation Plan: Exibição da IA no estilo do Claude Code (progresso, transcrição e diff)

**Branch**: `009-ai-output-display` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/009-ai-output-display/spec.md`

## Summary

A sessão interativa ganha três coisas, todas só de exibição:

1. **Linha de atividade.** Fica fixa entre a conversa e o prompt e mostra `✻ Contemplando… (13s · ↓ 304 tokens · Esc para interromper)`. O estado vem de um reducer puro (`src/session/activity.ts`) que o controller alimenta com os eventos do turno. O relógio e a animação são locais ao componente, para não redesenhar a transcrição.
2. **Transcrição estruturada.** O texto do assistente começa com `⏺`. Cada `tool_call` é desenhado como `⏺ Rótulo(argumento)`, com o próprio resultado logo abaixo em `⎿ resumo`. O resultado é encontrado pelo `callId`, e a mensagem `tool` deixa de ser desenhada à parte. Os avisos `⚙ …` que o controller emitia na sessão interativa saem, porque a transcrição passa a mostrar a mesma informação. No `-p` eles continuam indo para o stderr.
3. **Diff estruturado.** Um módulo puro (`src/tools/diff.ts`) calcula trechos com números de linha antigos e novos e 3 linhas de contexto, usando o `diff` que já é dependência. Ele também detecta arquivo novo, ausência de mudança, troca só de fim de linha e conteúdo binário ou grande demais. O `write_file` passa a expor `diff(input, ctx)`. O `executeTool` calcula o diff uma vez, antes da escrita, e o anexa ao pedido de confirmação e ao `tool_result`, num campo de exibição que nunca vai ao modelo. Um único componente `DiffView` desenha o diff no diálogo e na transcrição.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.
**Primary Dependencies**: existentes. `ink` 8 (`Text`, `Box`, `useEffect`/`setInterval` no componente), `diff` (`structuredPatch`), `react` 19 (`memo`). Nenhuma nova.
**Storage**: nada persistido. O campo de exibição do `tool_result` vive só na memória da sessão e não vai ao `history.jsonl` nem ao modelo.
**Testing**: vitest e ink-testing-library (`renderSized`, `waitForFrame`). O relógio da linha de atividade é injetável (`clock`), e os testes avançam o tempo com fake timers do vitest dentro de `waitFor`, sem `sleep` fixo.
**Target Platform**: terminais com e sem cor (Windows Terminal, iTerm2, GNOME Terminal…). `NO_COLOR` desliga a animação.
**Project Type**: CLI/TUI, um pacote npm.
**Performance Goals**: a animação não pode piorar `tests/integration/ui/perf.test.tsx`. O quadro do símbolo muda a cada 200 ms e o tempo a cada 1 s, e só a linha de atividade é redesenhada.
**Constraints**: `-p` com stdout idêntico byte a byte (SC-007). Nenhum conteúdo no log de depuração (FR-022). Layout de altura fixa, então a linha de atividade é uma região `flexShrink={0}`.
**Scale/Scope**: as cinco ferramentas atuais, os passos nativos do Spec Kit e o formato genérico para as ferramentas futuras.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Simplicidade**: nenhuma dependência nova e nenhuma chave nova em `settings.json`. Os limites são constantes. O formato de exibição de cada ferramenta fica numa tabela pura, sem abstração de "renderizadores". Passa.
- **II. CLI texto**: o `-p` não muda, e os avisos `⚙` continuam no stderr. Passa.
- **III. Testabilidade**: o reducer de atividade, a tabela de exibição das ferramentas e o diff são puros. A UI recebe um relógio injetável. Há testes unitários, de contrato e de integração. Passa.
- **IV. Credenciais**: nada novo é exibido além do que o diálogo de confirmação já mostra. O diff não vai para logs nem para o histórico de entradas. Passa.
- **V. Observabilidade**: o log ganha `turn.activity`, com fase e contagens, sem texto. Passa.
- **VI–VII. Open source e atribuição**: o OpenClaude é referência de comportamento visual, sem código copiado, e por isso não exige cabeçalho de atribuição. Ele será creditado no README. Passa.

**Reavaliação pós-design**: passa. O campo de exibição no `tool_result` é opcional e os conversores de provedor o ignoram, porque copiam campos explicitamente. Isso está verificado em contrato.

## Project Structure

### Documentation (this feature)

```text
specs/009-ai-output-display/
├── spec.md
├── plan.md              # este arquivo
├── research.md          # R1–R9
├── data-model.md        # Activity, TurnSummary, ToolDisplay, FileDiff
├── quickstart.md        # cenários manuais
├── contracts/
│   ├── activity-line.md # fases, frases, formato, encurtamento, resumo
│   ├── transcript.md    # ⏺/⎿, rótulos, resumos por ferramenta, -p
│   └── diff-view.md     # FileDiff, limites, cores, casos especiais
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/session/activity.ts            # NOVO, puro: reducer da atividade do turno, verbos, formatação de tempo/tokens, resumo
src/session/controller.ts          # alimenta a atividade; avisos ⚙ só fora do interativo; resumo do turno como aviso
src/session/turn.ts                # TurnCallbacks.onUsage; executeTool calcula diff e anexa display ao resultado
src/providers/types.ts             # ContentPart tool_result ganha `display?` (não enviado ao modelo)
src/tools/types.ts                 # ToolDefinition.diff?; ToolResult.display?; PendingToolAction.diff?
src/tools/diff.ts                  # NOVO, puro: fileDiff(old, next) → FileDiff (structuredPatch, contexto 3)
src/tools/writeFile.ts             # diff(); preview passa a usar fileDiff
src/ui/toolDisplay.ts              # NOVO, puro: rótulo/argumento/resumo por ferramenta
src/ui/components/ActivityLine.tsx # NOVO: símbolo animado, frase, tempo, tokens, dica
src/ui/components/DiffView.tsx     # NOVO: desenha FileDiff (números, cores, limite)
src/ui/components/MessageList.tsx  # ⏺ no assistente, tool_call + resultado pareados, mensagens tool não desenhadas
src/ui/components/ConfirmationDialog.tsx  # usa DiffView quando houver diff
src/ui/App.tsx                     # ActivityLine entre Transcript e InputPrompt
src/ui/hooks/useSession.ts         # snapshot com activity
README.md                          # seção da exibição + crédito ao OpenClaude
tests/unit/session/activity.test.ts, tests/unit/tools/diff.test.ts, tests/unit/ui/toolDisplay.test.ts,
tests/unit/ui/DiffView.test.tsx, tests/integration/ui/activity.test.tsx, tests/integration/ui/transcript.test.tsx,
tests/contract/display.test.ts
```

**Structure Decision**: o projeto continua sendo um pacote único. A lógica nova fica em módulos puros (`session/activity.ts`, `tools/diff.ts`, `ui/toolDisplay.ts`) e os componentes só desenham.

## Complexity Tracking

Nenhuma violação a justificar.
