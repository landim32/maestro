# Implementation Plan: Spec Kit Nativo no Maestro

**Branch**: `006-native-spec-kit` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-native-spec-kit/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

O Maestro passa a hospedar o Spec Kit (GitHub, MIT) sem Claude Code, CLI `specify` ou shell: (1) **comandos de prompt** descobertos em `.maestro/commands/`, na pasta da integração registrada (`.claude/commands/` neste repositório) ou embutidos (v1.2.3), injetados no turno com argumentos e um preâmbulo que direciona perguntas ao `ask_user`; (2) **passos determinísticos nativos** (criar feature com branch, configurar plano/tarefas, verificar pré‑requisitos, resolver templates em camadas, atualizar contexto do agente) acionados por um interceptor do turno que reconhece as três grafias de script (PowerShell 0.4.x, bash e Python 1.x) e devolve o mesmo JSON, sem confirmação; (3) `/speckit.init [--upgrade]` e `/speckit.status` com assets embutidos e manifesto de hashes; (4) `MAESTRO.md`/`CLAUDE.md` no prompt de sistema. Nenhuma dependência nova. Detalhes em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.  
**Primary Dependencies**: existentes — `node:fs`, `node:child_process` (`execFileSync('git', …)` para branches), `node:crypto` (sha256 do manifesto), `zod` (chave `speckit`), `ink` (sugestões no prompt). Parser YAML mínimo próprio para frontmatter e manifestos. Nenhuma nova.  
**Storage**: novos `assets/speckit/` no pacote (templates, comandos e scripts v1.2.3 + NOTICE); por projeto, `.specify/` (templates, scripts, `memory/`, `feature.json`, `init-options.json`, `integration.json`, `integrations/maestro.manifest.json`), `.maestro/commands/`, `MAESTRO.md`; `settings.json` ganha `speckit.createBranch`.  
**Testing**: `vitest`; repositórios git temporários reais nos testes de passos; `FakeProvider` que emite `run_command` dos scripts nos testes de fluxo; UI com `mountApp`.  
**Target Platform**: Windows, macOS, Linux (caminhos absolutos no JSON seguem o SO; git via `execFile`, sem shell).  
**Project Type**: CLI (mesmo pacote).  
**Performance Goals**: preflight e passos nativos < 200 ms; `init` < 2 s; descoberta de comandos na abertura < 50 ms.  
**Constraints**: zero processos de shell para os passos do Spec Kit; arquivos de comando e templates existentes funcionam sem alteração; passos nativos nunca pedem confirmação, o resto obedece ao modo; `-p` completo; assets MIT atribuídos.  
**Scale/Scope**: 1 módulo novo `src/speckit/` (~12 arquivos), `assets/speckit/` (~40 arquivos), ~10 arquivos alterados em `src/`, ~12 arquivos de teste novos.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constituição v1.0.0 (ratificada na feature 005).

| Gate | Pré‑Phase 0 | Pós‑Phase 1 |
|---|---|---|
| **I. Simplicidade / YAGNI** | PASS — sem extensões/presets/MCP da CLI; parser YAML mínimo em vez de dependência | PASS — camadas de template só até onde os scripts 1.x vão |
| **II. CLI texto I/O** | PASS — todo comando funciona em `-p` | PASS — [contracts/speckit-commands.md § 2](./contracts/speckit-commands.md) |
| **III. Testabilidade** | PASS — passos puros sobre `StepContext` injetável (git, assets, clock) | PASS — research R13 |
| **IV. Segurança de credenciais** | PASS — nada novo lê chaves; logs sem conteúdo de templates | PASS |
| **V. Observabilidade mínima** | PASS — `speckit.step`, `context.loaded` no `--debug` | PASS |
| **VI. Open-source permanente** | PASS | PASS |
| **VII. Atribuição de terceiros** | PASS — assets MIT com NOTICE, seção no `THIRD_PARTY_NOTICES.md`, modificações listadas, teste estendido | PASS — [contracts/init-and-context.md § 2](./contracts/init-and-context.md) |

**Violações a justificar**: nenhuma.

## Project Structure

### Documentation (this feature)

```text
specs/006-native-spec-kit/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── speckit-commands.md     # descoberta, execução, preâmbulo, sugestões, /help, init/status
│   ├── native-steps.md         # interceptação, opções, resolução de feature, JSON de cada passo
│   └── init-and-context.md     # /speckit.init, assets, MAESTRO.md, configuração
├── checklists/requirements.md
└── tasks.md                    # /speckit.tasks
```

### Source Code (repository root)

```text
assets/speckit/                      # NOVO: VERSION, NOTICE, templates/, templates/commands/, scripts/{bash,powershell,python}/
THIRD_PARTY_NOTICES.md               # + seção spec-kit (MIT)
README.md                            # + seção Spec Kit nativo; créditos
package.json                         # files += assets; (sem deps novas)

src/
├── speckit/                         # NOVO módulo
│   ├── assets.ts                    # bundledAssets(): AssetsPort (resolve ../../assets/speckit)
│   ├── frontmatter.ts               # parseFrontmatter (YAML mínimo: mapas, listas, escalares)
│   ├── discovery.ts                 # discoverCommands(cwd): precedência .maestro → integração → embutidos; preflightFor
│   ├── prompt.ts                    # renderCommandBody, buildPromptTurn (display + preâmbulo + corpo)
│   ├── preamble.ts                  # texto fixo (contracts/speckit-commands.md § 3)
│   ├── invocation.ts                # parseInvocation (três grafias) → StepRequest
│   ├── feature.ts                   # findSpecifyRoot, resolveFeaturePaths (R3), feature.json
│   ├── naming.ts                    # cleanBranchName, generateBranchName (stop words), fitBranchName (244 bytes)
│   ├── numbering.ts                 # próximo número (branches + specs), timestamp, init-options
│   ├── templates.ts                 # resolveTemplatePath/Content (overrides → presets → extensions → core → embutido)
│   ├── git.ts                       # GitPort (execFile): hasGit, currentBranch, branches (local+remote), checkoutNew, isDirty
│   ├── steps/
│   │   ├── index.ts                 # runStep(req, ctx)
│   │   ├── createFeature.ts         # + branch git (R4)
│   │   ├── setupPlan.ts, setupTasks.ts, checkPrerequisites.ts, resolveTemplate.ts
│   │   └── agentContext.ts          # parsePlanFacts, updateAgentFile, AGENT_FILES (+ maestro)
│   ├── init.ts                      # initSpecKit (criar/idempotente/upgrade), manifesto sha256, integration.json merge
│   ├── status.ts                    # texto do /speckit.status
│   └── service.ts                   # SpecKitService: commands(), interceptor(), preflight(), init(); injeção de GitPort/AssetsPort/clock
├── session/
│   ├── commands.ts                  # SlashCommand.origin, PromptTurn; executeSlash devolve { handled, turn? }; /speckit.init, /speckit.status; /help com seção Spec Kit
│   ├── controller.ts                # specKit, commands dinâmicos, submitPrompt(turn), intercept no runTurn, avisos ⚙ speckit
│   ├── turn.ts                      # TurnOptions.intercept (após validação, antes de classifyAction)
│   └── systemPrompt.ts              # projectContext
├── providers/types.ts               # Message.display
├── config/
│   ├── schema.ts, defaults.ts       # speckit.createBranch
│   └── projectContext.ts            # NOVO: loadProjectContext (MAESTRO.md → CLAUDE.md), limite 24 KB
├── cli/args.ts, version.ts, index.ts  # --version com spec-kit vX; passa projectContext e SpecKitService
└── ui/
    ├── components/InputPrompt.tsx   # sugestões ao digitar "/", → completa
    ├── components/MessageList.tsx   # usa message.display
    └── hooks/useSession.ts, App.tsx # commands para o prompt

tests/
├── unit/speckit/{frontmatter,discovery,prompt,invocation,feature,naming,numbering,templates,steps,agentContext,init,assets}.test.ts   # NOVOS
├── unit/config/projectContext.test.ts, unit/session/systemPrompt.test.ts     # NOVOS
├── contract/speckit.test.ts                                                 # NOVO (JSON = scripts 0.4.x/1.x; comandos deste repo)
├── integration/speckit/flow.test.ts                                         # NOVO (specify→plan→tasks com FakeProvider; FR-005; -p)
├── integration/ui/speckit.test.tsx                                          # NOVO (sugestões, →, display, ask_user)
├── unit/session/commands.test.ts, integration/cli/nonInteractive.test.ts    # estendidos
├── contract/config-schema.test.ts, unit/license/attribution.test.ts         # estendidos
└── helpers/tempRepo.ts                                                      # NOVO: repositório git temporário + .specify opcional
```

**Structure Decision**: tudo do Spec Kit fica em `src/speckit/`, com os passos como funções puras sobre um `StepContext` injetável (git, assets, relógio), seguindo o padrão dos reducers/efeitos das features anteriores. O ponto de contato com o resto é mínimo: um tipo de comando "prompt" em `commands.ts`, um `intercept` em `turn.ts`, `display` em `Message` e o contexto do projeto no prompt de sistema. Os assets ficam fora de `src/` para que o `tsc` não precise copiá‑los e para que o tarball os inclua tal como estão.

## Complexity Tracking

Nenhuma violação. Tabela intencionalmente vazia.

## Phase 0 — Research (concluída)

[research.md](./research.md): R0 estado atual; R1 versão embutida v1.2.3 (commit `8ac9e810…`, MIT); R2 três dialetos de script + interceptor; R3 resolução de feature (união 0.4.x/1.x); R4 passo de criar feature com branch; R5 preflight; R6 templates em camadas; R7 contexto do agente; R8 descoberta; R9 prompt e `display`; R10 init/upgrade; R11 contexto do projeto; R12 sugestões; R13 testes. Sem `NEEDS CLARIFICATION`.

## Phase 1 — Design (concluída)

- [data-model.md](./data-model.md) — `PromptTurn`/`SlashCommand`, `SpecKitCommandFile`, `StepRequest`/`StepResult`/`StepContext`, `FeaturePaths`, camadas de template, `InitReport`/`AssetsPort`/manifesto, contexto do agente e do projeto, mudanças em controller/turno/UI.
- [contracts/speckit-commands.md](./contracts/speckit-commands.md), [contracts/native-steps.md](./contracts/native-steps.md), [contracts/init-and-context.md](./contracts/init-and-context.md).
- [quickstart.md](./quickstart.md).
- `CLAUDE.md` atualizado pelo script de contexto.

## Phase 2 — Próximo passo

`/speckit.tasks`. Ordem sugerida: assets + atribuição (baixar v1.2.3 para `assets/speckit/`, NOTICE, `THIRD_PARTY_NOTICES.md`, `package.json files`) → fundação (`frontmatter`, `feature`, `naming`, `numbering`, `templates`, `git`, `invocation`, `steps/*`, testes unitários e de contrato) → US1 (descoberta, `PromptTurn`, `display`, interceptor no turno, preflight, `/help`, sugestões no prompt, testes de fluxo/UI/`-p`) → US2 (preâmbulo com `ask_user`, teste de clarificação) → US3 (`init`/`status`, manifesto, upgrade, `--version`) → US4 (`projectContext`, `systemPrompt`, `update-agent-context` com `MAESTRO.md`) → polish (README, CLAUDE.md, quickstart).

## Riscos

| Risco | Mitigação |
|---|---|
| Modelo "executa" o script com uma grafia inesperada (ex. `& '.specify/…ps1'`, caminho absoluto, `cd x && …`) | Parser tolerante (prefixos `&`, `pwsh -File`, aspas, caminho absoluto sob a raiz); segmentos `cd` ignorados; teste com amostras reais dos comandos 0.4.x e 1.x |
| Modelo cria a pasta/branch "à mão" (write_file/run_command git) em vez de chamar o script | Preâmbulo instrui a usar o script; o comando `specify` embutido chama o script explicitamente; em `default` o git por `run_command` pede confirmação, como qualquer comando |
| Diferenças de caminho Windows/POSIX no JSON (`\` vs `/`) | Caminhos no formato nativo do SO, como os scripts; testes rodam nos dois formatos via `path` |
| `git checkout -b` com working tree sujo e conflito de arquivos | Aviso prévio; falha do git vira `ok: false` com a mensagem; a pasta/spec já criada permanece |
| Parser YAML mínimo não cobre um manifesto exótico | Erro claro com o caminho do arquivo; só o subconjunto usado pelo spec-kit é suportado (documentado) |
| Assets desatualizados em relação ao upstream | `VERSION` fixa a tag; `/speckit.status` mostra embutida × instalada; atualização por release do Maestro |
| `CLAUDE.md` grande no prompt de sistema aumenta custo | Aviso acima de 24 KB; `MAESTRO.md` permite um contexto enxuto próprio |
| Sugestões no prompt disputam espaço com a transcrição | Máximo de 6 linhas, só enquanto o texto começa com `/`; `flexShrink={0}` |
