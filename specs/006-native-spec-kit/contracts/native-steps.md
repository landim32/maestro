# Contract — Passos nativos do Spec Kit

**Feature**: `006-native-spec-kit` · **Date**: 2026-10-25  
Reproduz `scripts/{bash,powershell,python}` do spec-kit v1.2.3 e os scripts PowerShell 0.4.x instalados neste repositório.

## 1. Interceptação

Uma chamada `run_command` cujo primeiro segmento (antes de `;`, `&&`, `|`) é um script do Spec Kit é executada nativamente. Reconhecimento: o programa (após `pwsh`, `powershell`, `bash`, `sh`, `python`, `python3`, `py`, `node`, `&`, `./` opcionais) termina em

```
.specify/scripts/bash/<nome>.sh | .specify/scripts/powershell/<nome>.ps1 | .specify/scripts/python/<nome>.py
scripts/bash/<nome>.sh | scripts/powershell/<nome>.ps1 | scripts/python/<nome>.py
```

com `<nome>` ∈ `create-new-feature`, `setup-plan`, `setup-tasks`, `check-prerequisites`, `resolve-template`, `update-agent-context` (hífen ou sublinhado). Qualquer outro script é um comando comum (modo de aprovação).

## 2. Opções aceitas (as três grafias são equivalentes)

| Passo | Opções |
|---|---|
| create-new-feature | `--json`/`-Json`, `--short-name X`/`-ShortName X`, `--number N`/`-Number N`, `--timestamp`/`-Timestamp`, `--dry-run`/`-DryRun`, `--allow-existing-branch`/`-AllowExistingBranch`, posicional = descrição (aspas simples/duplas, `'\''` de bash) |
| setup-plan, setup-tasks | `--json`/`-Json` |
| check-prerequisites | `--json`/`-Json`, `--require-spec`/`-RequireSpec`, `--require-tasks`/`-RequireTasks`, `--include-tasks`/`-IncludeTasks`, `--paths-only`/`-PathsOnly`, `--template NAME`/`-Template NAME` |
| resolve-template | posicional NAME, `--json`/`-Json` |
| update-agent-context | `-AgentType X`/`--agent-type X`/posicional X, `[plan_path]` |

Opção desconhecida → `ERROR: Unknown option '<x>'. Use --help for usage information.` (`ok: false`).

## 3. Resolução da feature (todos os passos exceto create)

1. `SPECIFY_FEATURE_DIRECTORY` (env) → caminho (relativo à raiz do `.specify/`).
2. `SPECIFY_FEATURE` (env) → `specs/<nome>`.
3. `.specify/feature.json` → `feature_directory`.
4. Branch git atual com prefixo `NNN-` ou `YYYYMMDD-HHMMSS-` → `specs/<branch>`.
5. Pasta mais recente em `specs/` (maior número; timestamps vencem números).
6. Senão: `ERROR: Feature directory not found. Run /speckit.specify first to create the feature structure.`

`--paths-only` nunca grava `feature.json`; os demais gravam quando resolveram por 4 ou 5 (valor relativo, ex. `specs/006-x`).

## 4. Saídas

### create-new-feature

```json
{"BRANCH_NAME":"007-user-auth","SPEC_FILE":"C:\\repo\\specs\\007-user-auth\\spec.md","FEATURE_NUM":"007","FEATURE_DIR":"C:\\repo\\specs\\007-user-auth","HAS_GIT":true}
```

Efeitos: pasta criada; `spec.md` copiado do template resolvido (vazio com aviso se não houver template); `.specify/feature.json` gravado; com git e `speckit.createBranch` ≠ false: `git checkout -b <BRANCH_NAME>` (ou checkout da existente com `--allow-existing-branch`); alterações pendentes → aviso `[specify] Warning: working tree has uncommitted changes; they move to the new branch`. `--dry-run` só devolve `{…, "DRY_RUN": true}`. Pasta já existente sem `--allow-existing-branch` → erro do script. Número explícito em conflito → próximo livre com aviso.

Numeração: `max(números de branches locais e remotas `NNN-*`, pastas `specs/NNN-*`) + 1`, com três dígitos mínimo; `timestamp` quando `--timestamp` ou `init-options.json` (`feature_numbering`, senão `branch_numbering`) = `timestamp`.

### setup-plan

`{"FEATURE_SPEC":…,"IMPL_PLAN":…,"FEATURE_DIR":…,"BRANCH":…,"HAS_GIT":true}`; copia o `plan-template` resolvido para `plan.md` se não existir (`Copied plan template to …` / `Plan already exists at …, skipping template copy` no texto).

### setup-tasks

`{"FEATURE_DIR":…,"AVAILABLE_DOCS":[…],"TASKS_TEMPLATE":"<caminho>","TASKS_TEMPLATE_CONTENT":"…"}`; exige `plan.md` e `spec.md`.

### check-prerequisites

- validação: `{"FEATURE_DIR":…,"AVAILABLE_DOCS":["research.md","data-model.md","contracts/","quickstart.md","tasks.md"?]}` (+ `TEMPLATE_CONTENT` com `--template`); exige pasta da feature e `plan.md` não vazio; `--require-spec` → `spec.md`; `--require-tasks` → `tasks.md`.
- `--paths-only`: `{"REPO_ROOT":…,"BRANCH":…,"FEATURE_DIR":…,"FEATURE_SPEC":…,"IMPL_PLAN":…,"TASKS":…}`.
- Erros: `ERROR: plan.md not found in <dir>` + `Run /speckit.plan first to create the implementation plan.` etc., idênticos aos scripts.

### resolve-template

`{"TEMPLATE_NAME":"spec-template","TEMPLATE_CONTENT":"…"}`; ordem de camadas de data-model § 5.

### update-agent-context

Texto no formato do script (`INFO: Parsing plan data from …`, `INFO: Found language: …`, `✓ Updated existing Claude Code context file`, `INFO: Summary of changes:`). Alvos: `MAESTRO.md` sempre; `-AgentType X` → arquivo de X; sem tipo → todos os arquivos de agentes conhecidos existentes. Regras: entradas novas em "## Active Technologies" (sem duplicar), nova linha no topo de "## Recent Changes" mantendo 3, `Last updated: YYYY-MM-DD`, seção entre `<!-- MANUAL ADDITIONS START -->` e `<!-- MANUAL ADDITIONS END -->` intacta; arquivo ausente é criado do `agent-file-template` resolvido; `.mdc` ganha frontmatter do Cursor.

## 5. Transcrição e logs

Cada passo gera `⚙ speckit <passo> · <resumo>` (`info`) e `speckit.step { step, ok, ms }` no `--debug` (sem conteúdo de templates). Falha → `⚠ speckit <passo>: <primeira linha do erro>` e `ok: false` devolvido ao modelo como `tool_result` de erro.

## 6. Testes que fixam este contrato

- `tests/unit/speckit/invocation.test.ts` — § 1–2 (todas as grafias; scripts desconhecidos não interceptados).
- `tests/unit/speckit/feature.test.ts` — § 3 (seis fontes, `feature.json` persistido ou não).
- `tests/unit/speckit/steps.test.ts` — § 4 (repositório git temporário real; JSON e efeitos; sem git).
- `tests/contract/speckit.test.ts` — igualdade do JSON com amostras gravadas dos scripts 0.4.x e 1.x.
