# Research — Spec Kit Nativo no Maestro

**Branch**: `006-native-spec-kit` · **Date**: 2026-10-25

Levantamento do Spec Kit upstream (versão a embutir), do que este repositório tem instalado e das decisões técnicas. Nenhum `NEEDS CLARIFICATION` ficou aberto.

## R0. Estado atual

| Aspecto | Hoje | Lacuna frente à spec |
|---|---|---|
| Comandos `/` | `DEFAULT_COMMANDS` fixos em `src/session/commands.ts`; `run(ctl, args)` só emite avisos ou abre diálogos; nenhum comando injeta prompt num turno | Falta um tipo de comando "prompt": lê um arquivo, substitui argumentos e roda um turno |
| Descoberta de arquivos de comando | Nenhuma; os `/speckit.*` só existem para o Claude Code em `.claude/commands/` | Falta descoberta em `.maestro/commands/`, pasta da integração e embutidos |
| Scripts do Spec Kit | O modelo os executaria via `run_command` (PowerShell), pedindo confirmação em `default`/`auto-edit` | Falta interceptar a invocação e executar o passo nativamente, sem confirmação |
| Spec Kit instalado neste repo | CLI `specify` 0.4.5.dev0: `.specify/{memory,templates,scripts/powershell,integrations}`, `.claude/commands/speckit.*.md` com caminhos `.specify/scripts/powershell/*.ps1`; feature = branch git | Precisa continuar funcionando sem alteração (FR-017) |
| Spec Kit upstream | v1.2.3 (2026-10-22, MIT): feature rastreada por `.specify/feature.json`; `{SCRIPT}`/`{ARGS}`/`__SPECKIT_COMMAND_X__` nos templates de comando; `setup-tasks`, `resolve-template` com camadas (overrides → presets → extensions → core); criação de branch e atualização de contexto do agente movidas para extensões | A versão embutida é esta; o Maestro precisa falar os dois dialetos (0.4.x e 1.x) |
| Transcrição | Mensagem do usuário é exibida literalmente | O prompt composto (comando + argumentos) não deve aparecer inteiro; falta um rótulo de exibição |
| Prompt de sistema | Fixo (`buildSystemPrompt`) | Falta incluir o arquivo de contexto do projeto (`MAESTRO.md`/`CLAUDE.md`) |
| Autocompletar | Inexistente; TAB é dos modos de aprovação | Falta lista de sugestões ao digitar `/` e tecla de completar |

## R1. Versão embutida e licença

**Decision**: embutir o Spec Kit **v1.2.3** (tag `v1.2.3`, commit `8ac9e8103319d98099cfc274a2517bb2b621626c`, 2026-10-22, licença MIT, Copyright (c) GitHub, Inc.) em `assets/speckit/`: `templates/{spec,plan,tasks,checklist,constitution}-template.md`, `templates/commands/*.md` (10 comandos: analyze, checklist, clarify, constitution, converge, implement, plan, specify, tasks, taskstoissues), `scripts/{bash,powershell,python}/*`, mais `agent-file-template.md` (presente no 0.4.x deste repositório, retirado do core no 1.x) e `VERSION`. `THIRD_PARTY_NOTICES.md` ganha a seção spec-kit (MIT) com a lista de arquivos e as modificações feitas pelo Maestro (R4).

**Rationale**: é o último release estável; MIT é compatível. Os scripts são copiados para o projeto no `init` apenas para que outros agentes (Claude Code, Copilot…) continuem funcionando no mesmo repositório; o Maestro nunca os executa.

**Alternatives considered**: embutir só templates (quebra projetos compartilhados com outros agentes); baixar na hora (`init` offline é requisito implícito de "nativo").

## R2. Dois dialetos de invocação de scripts

Os arquivos de comando referenciam scripts de três formas:

| Dialeto | Exemplo | Onde aparece |
|---|---|---|
| PowerShell 0.4.x | `.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks`, `create-new-feature.ps1 -Json -ShortName "x" "desc"`, `setup-plan.ps1 -Json`, `update-agent-context.ps1 -AgentType claude` | `.claude/commands/` deste repositório |
| bash 1.x | `scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks`, `setup-plan.sh --json`, `setup-tasks.sh --json`, `create-new-feature.sh --json --short-name x --number N --timestamp --dry-run --allow-existing-branch "desc"`, `resolve-template.sh NAME --json` | `{SCRIPT}` dos templates v1.2.3 (`scripts.sh`) |
| python 1.x | `scripts/python/check_prerequisites.py --json …` | `scripts.py` |

**Decision**: um parser único (`src/speckit/invocation.ts`) reconhece as três grafias (caminho terminando em `.specify/scripts/<bash|powershell|python>/<nome>.<sh|ps1|py>` ou `scripts/<…>` relativo), normaliza as opções (`-Json`/`--json`, `-RequireTasks`/`--require-tasks`, `-RequireSpec`, `-IncludeTasks`, `-PathsOnly`, `-Template X`/`--template X`, `-ShortName`/`--short-name`, `-Number`, `-Timestamp`, `-DryRun`, `-AllowExistingBranch`, `-AgentType X`, posicional = descrição) e devolve um `StepRequest`. Quem o aciona é um **interceptor** do turno (`TurnOptions.intercept`): toda chamada de `run_command` cujo primeiro segmento é um script do Spec Kit vira um passo nativo, executado antes da classificação de aprovação (FR-006) e anunciado na transcrição como `⚙ speckit <passo> · <resumo>`.

**Rationale**: os arquivos de comando não precisam de nenhuma alteração (FR-017); o modelo continua "rodando o script" como o texto manda, e o resultado JSON é idêntico.

**Alternatives considered**: ferramenta própria `speckit_step` e reescrita dos prompts (exige alterar comandos de projetos existentes); executar os scripts de verdade (viola o requisito de não depender de shell).

## R3. Resolução de feature: união dos dois modelos

**Decision**: ordem de resolução do diretório da feature: (1) `SPECIFY_FEATURE_DIRECTORY` no ambiente; (2) `SPECIFY_FEATURE` no ambiente (nome → `specs/<nome>`); (3) `.specify/feature.json` → `feature_directory` (1.x); (4) branch git atual, quando casa com `^\d{3,}-` ou `^\d{8}-\d{6}-` (0.4.x); (5) pasta mais recente em `specs/` (maior número ou maior timestamp); senão erro com orientação. `CURRENT_BRANCH` no JSON é o nome da branch git quando (4) ou o basename do diretório nos demais. `check-prerequisites --paths-only` nunca grava `feature.json`; os demais passos gravam/atualizam `feature.json` quando resolvem por (4)/(5), como o 1.x faz.

**Rationale**: os comandos 0.4.x deste repositório dependem da branch; os 1.x de `feature.json`; a união atende aos dois e a um projeto sem git (FR-014).

## R4. Passo "criar feature" e a branch git

No 1.x, `create-new-feature.sh` só cria `specs/NNN-nome/spec.md` e `feature.json`; a branch git ficou para a extensão git. A spec (US1 cenário 2, FR-003) exige a branch.

**Decision**: o passo nativo `createFeature` numera (maior número entre branches locais e remotas, pastas `specs/NNN-*`, `+1`; `timestamp` quando `init-options.json` tiver `feature_numbering`/`branch_numbering: timestamp` ou `--timestamp`), normaliza o nome curto (regras do script: minúsculas, hifens, stop words, até 3–4 palavras, acrônimos mantidos, limite de 244 bytes), cria a pasta e o `spec.md` a partir do template resolvido (R6), grava `feature.json`, e **cria e faz checkout da branch git** quando há repositório e `speckit.createBranch` não é `false` (`--dry-run` só calcula). Alterações pendentes no working tree são avisadas. JSON devolvido: `{BRANCH_NAME, SPEC_FILE, FEATURE_NUM, FEATURE_DIR, HAS_GIT}` (superconjunto dos dois dialetos). O comando `speckit.specify` embutido (v1.2.3) tem seus passos 2–3 substituídos por "Run `{SCRIPT}` com `--json --short-name`", e o `speckit.plan` embutido ganha o passo "atualize o contexto do agente com `update-agent-context.sh`" (R7); ambas as modificações são registradas no `THIRD_PARTY_NOTICES.md`.

**Rationale**: mantém o comportamento que o usuário conhece (branch por feature) sem depender da extensão git do Spec Kit, e torna a criação da branch um passo determinístico do fluxo (sem confirmação), como a spec pede.

## R5. Pré‑requisitos antes de chamar o modelo (FR-005)

**Decision**: cada comando descoberto tem um `preflight` derivado da frontmatter `scripts.sh` (1.x) ou, na ausência dela, de uma tabela por nome (`plan` → setup-plan; `tasks`/`analyze`/`checklist`/`implement`/`converge`/`clarify`/`taskstoissues` → check-prerequisites com as opções que cada um usa; `specify`/`constitution`/`init`/`status` → nenhum). O Maestro executa o preflight em modo de validação sem efeitos colaterais (não copia template) antes do turno; se falhar, emite a mensagem de erro do script (`ERROR: plan.md not found… Run /speckit.plan first`) e não chama o modelo. O passo real continua sendo executado pelo modelo durante o turno (idempotente).

## R6. Resolução de templates com camadas (1.x)

**Decision**: `resolveTemplate(name)` segue a pilha do upstream: `.specify/templates/overrides/<name>.md` → presets em `.specify/presets/` (ordem do `.registry` por prioridade, senão alfabética; estratégias `replace|prepend|append|wrap` do `preset.yml` quando presente — parser YAML mínimo próprio) → `.specify/extensions/<id>/templates/<name>.md` (ordem do `.registry`, senão alfabética) → `.specify/templates/<name>.md` → template embutido. Sem Python/PyYAML: o parser mínimo cobre o subconjunto usado pelos manifestos (mapas, listas de mapas, escalares); manifesto inválido → erro claro.

**Rationale**: é o que `create-new-feature`, `setup-plan`, `setup-tasks` e `check-prerequisites --template` do 1.x fazem; o fallback ao embutido cobre projetos sem `.specify/templates`.

## R7. Atualização do contexto do agente

**Decision**: o passo nativo `updateAgentContext` reproduz o algoritmo do `update-agent-context.ps1` 0.4.x (campos `Language/Version`, `Primary Dependencies`, `Storage`, `Project Type` do `plan.md`; seção "Active Technologies" ganha só entradas novas; "Recent Changes" mantém as 3 mais recentes; "Last updated" atualizado; arquivo criado do `agent-file-template.md` quando não existe; seção entre `<!-- MANUAL ADDITIONS START/END -->` preservada). Alvos: o agente pedido em `-AgentType`, **sempre** `MAESTRO.md`, e todos os arquivos de agentes conhecidos já existentes (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `QWEN.md`, `.github/copilot-instructions.md`, `.cursor/rules/specify-rules.mdc`, …, tabela do script). O comando `speckit.plan` embutido invoca esse passo (R4).

## R8. Descoberta e precedência de comandos

**Decision**: `discoverCommands(cwd)` lê, nesta ordem, `.maestro/commands/*.md`, a pasta da integração ativa de `.specify/integration.json` (`default_integration` ou `integration`; mapa conhecido: `claude` → `.claude/commands`, `cursor-agent` → `.cursor/commands`, `copilot` → `.github/prompts` (`*.prompt.md`), `codex` → `.codex/prompts`, `windsurf` → `.windsurf/workflows`, `generic` → `integration_settings.generic.commands_dir`; integrações com TOML (`gemini`, `qwen`) são ignoradas com aviso), e os embutidos. Só arquivos `speckit.*.md`/`speckit-*.md`; o primeiro nome encontrado vence; `/help` mostra a origem (`projeto`, `claude`, `embutido`). Frontmatter (`description`, `scripts`, `handoffs`, `tools`) lida pelo parser YAML mínimo; o corpo recebe `$ARGUMENTS`/`{ARGS}`.

## R9. Composição do prompt e exibição

**Decision**: um comando de prompt produz `{ display: '/speckit.plan <args>', prompt: <preâmbulo + corpo> }`. O preâmbulo (fixo, em inglês, `src/speckit/preamble.ts`) diz ao modelo: (a) os scripts do Spec Kit são executados nativamente pelo Maestro e aceitam qualquer das três grafias; (b) toda pergunta ao usuário deve usar `ask_user` com as opções sugeridas e esperar a resposta antes de continuar; (c) o modo de aprovação vale para escritas/comandos fora dos scripts. `Message` ganha `display?: string`; `MessageList` o usa em vez do texto; o provedor recebe o texto completo. O histórico ↑/↓ guarda só a linha digitada (já é assim).

## R10. Inicialização e atualização (`/speckit.init`)

**Decision**: `init` cria o que falta: `.specify/memory/constitution.md`, `.specify/templates/*.md` (+ `agent-file-template.md`), `.specify/scripts/{bash,powershell,python}/*`, `.maestro/commands/speckit.*.md` (renderizados: `{SCRIPT}` → `scripts.sh`, `{ARGS}` → `$ARGUMENTS`, `__SPECKIT_COMMAND_X__` → `/speckit.x`, `/memory/` → `.specify/memory/`), `.specify/init-options.json` (`feature_numbering: sequential`, `integration: maestro`, `script: sh`), `.specify/integration.json` (acrescenta `maestro` em `integration_settings` com `invoke_separator: "."` e `commands_dir`; mantém `default_integration` existente) e o manifesto `.specify/integrations/maestro.manifest.json` (`version`, `files: {caminho: sha256}`). `--upgrade` compara o hash atual de cada arquivo do manifesto com o gravado: igual → substitui; diferente → mantém e lista; ausente → cria. `--here` não é necessário (sempre a pasta de trabalho). Sem git: cria tudo e avisa.

## R11. Contexto do projeto no prompt de sistema

**Decision**: `loadProjectContext(cwd)` lê `MAESTRO.md`, senão `CLAUDE.md`; conteúdo anexado ao prompt de sistema sob `# Project guidelines (<arquivo>)`; `--debug` registra `context.loaded { file, bytes }`; acima de 24 KB o Maestro avisa uma vez na transcrição. Sem arquivo: nada acontece.

## R12. Sugestões de comando no prompt

**Decision**: quando o texto começa com `/` e não contém espaço, o `InputPrompt` mostra até 6 comandos cujo nome começa pelo texto (nome + descrição, uma linha cada) abaixo do campo; **→** (seta direita) completa o primeiro; Enter envia o que estiver digitado. Lista vem de `controller.commands` (fixos + descobertos). TAB continua reservado aos modos.

## R13. Testes

- **Unit** (`tests/unit/speckit/`): `naming` (stop words, acrônimos, 244 bytes, Unicode), `numbering` (branches local/remota + pastas, timestamp), `invocation` (três grafias → `StepRequest`), `frontmatter` (YAML mínimo), `templates` (camadas e estratégias), `steps` (JSON de cada passo com `tempHome`‑like temp repo; git real via `execFile` em pasta temporária), `agentContext` (criação, atualização, 3 mudanças, seção manual), `init` (criar, idempotente, upgrade com modificado/igual/ausente), `discovery` (precedência, origem), `prompt` (render + preâmbulo), `projectContext`.
- **Contract** (`tests/contract/speckit.test.ts`): JSON dos passos byte‑a‑byte igual aos exemplos dos scripts 0.4.x e 1.x; comandos deste repositório descobertos e preflights corretos.
- **Integration**: `tests/integration/speckit/flow.test.ts` com `FakeProvider` que "executa" os scripts via `run_command` e grava arquivos: `specify` → branch + spec; `plan` → plan + contexto; `tasks`; FR-005 sem chamar o modelo; `-p`; UI: `tests/integration/ui/speckit.test.tsx` (sugestões ao digitar `/spec`, → completa, transcrição mostra `/speckit.plan` e não o prompt inteiro, pergunta vira diálogo).
- **License**: `attribution.test.ts` estendido para `assets/speckit` (cabeçalho `NOTICE`, seção no `THIRD_PARTY_NOTICES.md`).
