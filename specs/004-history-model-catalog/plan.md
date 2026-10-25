# Implementation Plan: Histórico de Entradas e Catálogo de Modelos por Provedor

**Branch**: `004-history-model-catalog` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-history-model-catalog/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Duas melhorias de uso diário. (1) **Histórico de entradas persistente** no estilo Claude Code: cada envio do prompt (mensagens e comandos `/`) vai para `~/.maestro/history.jsonl`; ↑/↓ navegam do mais recente ao mais antigo com rascunho preservado; a lógica é um store injetável + navegador puro em `src/session/history.ts`, ligado ao `SessionController`. (2) **Catálogo de modelos por provedor**: `providers.<id>.models` no `settings.json` (com padrões), seletor `/model` agrupado por provedor, "Digitar outro modelo…" passa a pedir o provedor e grava o nome digitado no catálogo. Nenhuma dependência nova. Detalhes em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.  
**Primary Dependencies**: existentes — `ink` 8 (`useInput`), `zod` 4 (esquema de `models`), `node:fs` (append/rename). Nenhuma nova.  
**Storage**: novo `~/.maestro/history.jsonl` (JSON Lines, append por envio, ≤ 1.000 entradas); `settings.json` ganha `providers.<id>.models` (gravado via `config/writer.ts`).  
**Testing**: `vitest` + `renderSized`/`appHarness`/`tempHome` existentes; store de histórico em memória para testes de reducer; `MAESTRO_HOME` temporário para persistência.  
**Target Platform**: Windows, macOS, Linux (mesmas garantias de escrita atômica do writer).  
**Project Type**: CLI (mesmo pacote).  
**Performance Goals**: carga do histórico < 50 ms para 1.000 entradas; ↑/↓ respondem no mesmo frame; append síncrono de uma linha por envio (sem fsync).  
**Constraints**: campos de diálogo e `-p` nunca entram no histórico; falhas de E/S nunca interrompem a sessão; ↑/↓ simples nunca rolam a transcrição; `settings.json` continua validado antes de gravar.  
**Scale/Scope**: 1 arquivo novo em `session/`, 1 em `config/`, 1 teste de UI novo; ~10 arquivos alterados.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constituição ainda não ratificada (template); gates contra os princípios adotados nas features anteriores.

| Gate | Pré‑Phase 0 | Pós‑Phase 1 |
|---|---|---|
| **Simplicidade / YAGNI** | PASS — JSONL append‑only, sem busca Ctrl+R, sem histórico por projeto | PASS — uma tela nova (provedor) reutilizando `SelectList`; sem metadados de modelo |
| **CLI texto I/O** | PASS — `-p` não toca no histórico; `/model` textual lista catálogos | PASS — contrato em [contracts/model-catalog.md § 3](./contracts/model-catalog.md) |
| **Testabilidade** | PASS — navegador e reducer puros; store injetável | PASS — research R9 |
| **Segurança de credenciais** | PASS — campos de diálogo excluídos do histórico; `noSecrets` estendido | PASS — contrato [history.md § 2](./contracts/history.md) |
| **Observabilidade mínima** | PASS — `history.error` no `--debug`, sem texto da entrada | PASS |

**Violações a justificar**: nenhuma.

## Project Structure

### Documentation (this feature)

```text
specs/004-history-model-catalog/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── history.md          # arquivo, o que entra, teclas, testes
│   └── model-catalog.md    # settings.models, telas do /model, forma textual e -p
├── checklists/requirements.md
└── tasks.md                # /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── config/
│   ├── paths.ts              # + historyPath(env)
│   ├── defaults.ts           # + DEFAULTS.<id>.models; INITIAL_SETTINGS com models
│   ├── schema.ts             # + models (preprocess [] → undefined, ^\S+$, sem repetidos)
│   └── models.ts             # NOVO: modelCatalog(settings, id), learnModelPatch(globalRaw, id, model)
├── session/
│   ├── history.ts            # NOVO: HistoryStore (file/memory), InputHistory (dedupe+limite), historyNavigate (puro)
│   ├── controller.ts         # + history?: InputHistory; submit() registra antes de executeSlash; rememberModel(); persistActive() aprende
│   └── commands.ts           # /model <id> <modelo> → rememberModel; describeProviders lista catálogos
├── setup/
│   ├── modelFlow.ts          # ModelEntry por modelo; step customProvider; applying.learn; done.warning
│   └── driver.ts             # apply: patch com models quando learn; falha de gravação → applied+warning
├── index.ts                  # modo interativo: cria fileHistoryStore(historyPath) + InputHistory e passa ao controller (-p não)
└── ui/
    ├── hooks/useSession.ts   # historyItems ← controller.history
    ├── components/InputPrompt.tsx  # usa historyNavigate (rascunho preservado; digitar sai do histórico)
    └── dialogs/ModelDialog.tsx     # grupos por provedor; tela customProvider

tests/
├── unit/session/history.test.ts            # NOVO
├── unit/config/models.test.ts              # NOVO
├── unit/setup/modelFlow.test.ts            # estendido
├── contract/config-schema.test.ts          # models
├── contract/dialog-flows.test.ts           # teclas do /model; isScrollKey sem ↑/↓ simples
├── integration/ui/history.test.tsx         # NOVO (MAESTRO_HOME temporário)
├── integration/ui/dialogs.model.test.tsx   # grupos, provedor, aprendizado
├── integration/cli/nonInteractive.test.ts  # -p sem history.jsonl; /model lista Models:
└── unit/security/noSecrets.test.ts         # history.jsonl sem a chave
```

**Structure Decision**: histórico fica em `src/session/` (é estado da sessão interativa, não da UI nem da conversa), com persistência atrás de uma interface injetável, como os efeitos da feature 003. O catálogo fica em `src/config/` porque é derivação pura de `Settings` + geração de patch para o writer existente. O `/model` continua um reducer puro em `src/setup/modelFlow.ts`; a única tela nova reutiliza `SelectList`.

## Complexity Tracking

Nenhuma violação. Tabela intencionalmente vazia.

## Phase 0 — Research (concluída)

[research.md](./research.md): R0 estado atual (histórico só de mensagens e volátil; ↑/↓ já não rolam); R1 formato JSONL como o Claude Code; R2 limite 1.000 + compactação em 2.000; R3 o que entra; R4 store injetável + navegador puro; R5 esquema `models`; R6 precedência e gravação no global; R7 fluxo `/model` com etapa de provedor; R8 saída textual; R9 testes. Sem `NEEDS CLARIFICATION`.

## Phase 1 — Design (concluída)

- [data-model.md](./data-model.md) — `HistoryEntry`, `InputHistory`, `HistoryStore`, `HistoryCursor` + tabela de transições, esquema `models`, `modelCatalog`/`learnModelPatch`, `ModelFlowState` revisado, mudanças no controller.
- [contracts/history.md](./contracts/history.md), [contracts/model-catalog.md](./contracts/model-catalog.md).
- [quickstart.md](./quickstart.md).
- `CLAUDE.md` atualizado pelo script de contexto.

## Phase 2 — Próximo passo

`/speckit.tasks`. Ordem sugerida: fundação (paths/defaults/schema `models`, `config/models.ts`, `session/history.ts`) → US1 (controller + interactive + InputPrompt + testes de histórico) → US2 (catálogo no `/model`, texto e `-p`) → US3 (etapa de provedor + aprendizado) → polish (README, `noSecrets`, quickstart).

## Riscos

| Risco | Mitigação |
|---|---|
| Duas instâncias gravando ao mesmo tempo | Append de linha única; compactação só na carga; linhas inválidas ignoradas |
| Chave colada no prompt acaba no `history.jsonl` | Mesma proteção do `settings.json`; documentado; campos de diálogo excluídos |
| `settings.json` de projeto com `models` esconde o aprendizado global | Aviso `overriddenByProject` já existente |
| Lista do seletor maior que a altura do terminal | `DialogFrame` já limita altura; `SelectList` ganha janela de rolagem em torno do item selecionado se ultrapassar `rows − 8` |
| Teste de UI flaky por E/S | `tempHome` + `waitFor`, como na feature 003 |
