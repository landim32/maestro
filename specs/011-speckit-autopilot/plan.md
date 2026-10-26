# Implementation Plan: Modo autopiloto (Spec Kit de ponta a ponta, sem interação)

**Branch**: `011-speckit-autopilot` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/011-speckit-autopilot/spec.md`

## Summary

Um orquestrador novo (`src/autopilot/`) conduz cada história pelos passos do Spec Kit. Ele usa o `SessionController` existente como motor de turnos e não cria um caminho paralelo.

- **Fluxo**: um reducer puro (`flow.ts`) guarda a máquina de estados da execução, com histórias, passos, portões, rodadas de "continue" e correção, e tetos. Um driver (`driver.ts`) executa os efeitos: limpar a sessão, chamar `controller.submit('/speckit.<passo> …')`, avaliar o portão, commitar e salvar o estado.
- **Decisor**: `decider.ts` monta o pedido e interpreta a resposta, como funções puras. Ele faz uma chamada sem ferramentas ao provedor da rota `autopilot.decide` e devolve `{ escolha, justificativa }` validados.
- **Sem interação**: durante a execução, o controller recebe três substituições.
  - `askOverride`: o `ask_user` vai para o decisor.
  - `confirm`: tudo o que pediria confirmação é recusado, o que no modo `auto` só atinge comandos destrutivos.
  - modo de aprovação `auto` forçado.

  As perguntas em texto no fim do turno são detectadas por `questions.ts` (puro) e respondidas pelo decisor como novo turno do mesmo passo.
- **Portões**: `gates.ts` (puro sobre um snapshot do disco) decide avançar, repetir (continue, correção) ou parar.
- **Registros**: `log.ts` escreve `decisions.md` e o `.jsonl` da execução, e `state.ts` lê e grava `.specify/autopilot.json`. Os três arquivos são regravados pelo driver depois de cada passo, antes do commit (FR-020).
- **Git e remoto**: o `GitPort` ganha `headSha`, `addAll`, `commit` e `push`. Um `RemotePort` usa `gh` por `execFile` para abrir o PR e fazer o merge, e só é chamado com as opções ligadas.
- **Entrada**: `/autopilot <arquivo> [--resume]` como comando local, `maestro -p --autopilot <arquivo> [--resume]` e a seção `autopilot` no `settings.json`.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.
**Primary Dependencies**: existentes. `zod` 4 (seção `autopilot`, resposta do decisor), `node:child_process` (`execFile` para git, `gh` e o comando de verificação), `node:fs`, `yargs` (`--autopilot`, `--resume`). Nenhuma nova.
**Storage**:
- `.specify/autopilot.json`, com o estado da execução;
- `.maestro/autopilot/<id>.jsonl`, com as decisões e eventos, no `.gitignore` porque `.maestro/` já é ignorado;
- `specs/NNN-nome/decisions.md`, versionado;
- `settings.json`, que ganha a seção `autopilot`.
**Testing**: vitest. O provedor falso é roteirizado por passo. O `GitPort` e o `RemotePort` em memória e o executor de verificação são injetáveis. O fluxo inteiro também roda num repositório temporário real (`tests/helpers/tempRepo.ts`) com git de verdade e sem rede.
**Target Platform**: as mesmas do Maestro (Windows, macOS, Linux). Push e PR exigem `gh` autenticado.
**Project Type**: CLI/TUI, um pacote npm.
**Performance Goals**: o custo do orquestrador é desprezível frente aos turnos do modelo. O estado é salvo a cada transição, num arquivo de menos de 50 KB.
**Constraints**:
- nenhuma ação remota sem opção;
- nenhum comando destrutivo;
- o `-p` continua respeitando stdout e stderr;
- nada do conteúdo das histórias, perguntas ou respostas vai para o log de depuração.
**Scale/Scope**: dezenas de histórias por arquivo, de 7 a 30 turnos por história.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Simplicidade**: a feature reaproveita o controller, o Spec Kit nativo, as rotas e os modos de aprovação, sem dependência nova. A sequência é fixa, sem "plugins de passo". A configuração tem padrões para tudo. Passa.
- **II. CLI texto**: `maestro -p --autopilot` tem progresso no stderr, relatório no stdout e os códigos 0, 1 e 2. Passa.
- **III. Testabilidade**: fluxo, portões, detecção de perguntas e decisor são puros. Git, `gh`, verificação, relógio e provedor são injetáveis. Há testes unitários, de contrato e de integração em repositório temporário. Passa.
- **IV. Credenciais**: o decisor usa o provedor da rota e não lida com chaves. Push e PR usam o `gh` já autenticado do usuário. O log não registra conteúdo. Passa.
- **V. Observabilidade**: os eventos `autopilot.start`, `autopilot.step`, `autopilot.gate`, `autopilot.decision` (só contagens) e `autopilot.end` vão para o log. As mensagens ao usuário são em português, e o relatório inclui o comando de retomada. Passa.
- **VI–VII**: o código é escrito do zero, sem terceiros. Passa.
- **Fluxo de desenvolvimento**: o autopiloto segue a mesma regra de uma branch por feature e um commit por passo. O PR só acontece com opção. Passa.

**Reavaliação pós-design**: passa. A substituição do `ask` e do `confirm` é por execução e é desfeita no fim, mesmo em erro (`try/finally`), e não altera a sessão interativa normal.

## Project Structure

### Documentation (this feature)

```text
specs/011-speckit-autopilot/
├── spec.md
├── plan.md
├── research.md            # R1–R12
├── data-model.md          # Run, StoryRun, StepRun, Decision, AutopilotSettings, eventos do reducer
├── quickstart.md
├── contracts/
│   ├── autopilot-cli.md   # comando, -p, argumentos, códigos de saída, relatório
│   ├── stories-file.md    # formato do arquivo de histórias
│   ├── gates.md           # portão de cada passo, rodadas e parada
│   ├── decisions.md       # pedido e resposta do decisor, formato dos dois registros
│   └── state-file.md      # .specify/autopilot.json e regras de retomada
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/autopilot/
├── stories.ts        # puro: parseStories(markdown) → Story[]
├── flow.ts           # puro: reducer da execução (estados, transições, tetos, rodadas)
├── gates.ts          # puro: avaliação de cada portão sobre um snapshot (artefatos, tarefas, saída)
├── questions.ts      # puro: detecção de pergunta em texto no fim do turno
├── decider.ts        # puro (prompt/parse) + chamada ao provedor da rota autopilot.decide
├── log.ts            # decisions.md (Markdown) e <id>.jsonl
├── state.ts          # .specify/autopilot.json: ler, validar (zod), gravar atomicamente
├── report.ts         # puro: relatório final (texto)
├── remote.ts         # RemotePort (gh pr create / merge) via execFile
└── driver.ts         # efeitos: liga flow + controller + git + verificação + registros
src/speckit/git.ts    # GitPort ganha headSha, addAll, commit, push
src/session/controller.ts  # askOverride / confirmOverride / forcedApprovalMode por execução; autopilotStatus
src/session/commands.ts    # comando /autopilot
src/cli/args.ts, src/index.ts, src/cli/nonInteractive.ts  # --autopilot, --resume
src/config/schema.ts, src/config/defaults.ts               # seção autopilot
src/routes/catalog.ts       # rota de propósito autopilot.decide
src/ui/components/StatusBar.tsx  # "autopiloto · história n/N · <passo>"
tests/unit/autopilot/*.test.ts, tests/contract/autopilot.test.ts,
tests/integration/autopilot/run.test.ts (repositório temporário real), tests/integration/cli/autopilot.test.ts
```

**Structure Decision**: um módulo novo `src/autopilot/` segue o padrão de `src/setup/` (reducers puros mais um driver de efeitos) e de `src/speckit/` (portas injetáveis). O controller só ganha os ganchos por execução.

## Complexity Tracking

Nenhuma violação a justificar.
