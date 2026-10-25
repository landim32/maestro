# Contract — `/speckit.init`, assets embutidos e contexto do projeto

**Feature**: `006-native-spec-kit` · **Date**: 2026-10-25

## 1. `/speckit.init`

Cria o que falta a partir de `assets/speckit/` (v1.2.3) e nunca altera arquivos existentes:

| Destino | Conteúdo | Quando |
|---|---|---|
| `.specify/memory/constitution.md` | `constitution-template.md` | ausente |
| `.specify/templates/*.md` | spec, plan, tasks, checklist, constitution, agent-file | cada um ausente |
| `.specify/scripts/bash/*.sh`, `powershell/*.ps1`, `python/*.py` | scripts v1.2.3 (para outros agentes) | cada um ausente |
| `.maestro/commands/speckit.<x>.md` | comando renderizado (`{SCRIPT}` → `scripts.sh`, `{ARGS}` → `$ARGUMENTS`, `__SPECKIT_COMMAND_X__` → `/speckit.x`, `/memory/` → `.specify/memory/`) | cada um ausente |
| `.specify/init-options.json` | `{ "feature_numbering": "sequential", "integration": "maestro", "script": "sh", "speckit_version": "v1.2.3" }` | ausente |
| `.specify/integration.json` | acrescenta `integration_settings.maestro` (`invoke_separator: "."`, `commands_dir: ".maestro/commands"`); define `integration: "maestro"` só se ausente | sempre (merge) |
| `.specify/integrations/maestro.manifest.json` | `{ integration, version, installed_at, files: { rel: sha256 } }` | sempre (regravado) |

Relatório na transcrição:

```
Spec Kit v1.2.3 instalado.
  criados: 23 arquivos (.specify/templates, .specify/scripts, .maestro/commands, …)
  mantidos: .specify/memory/constitution.md, .specify/templates/spec-template.md
Próximo passo: /speckit.constitution para definir os princípios do projeto.
```

Sem repositório git: linha extra `Aviso: sem repositório git; /speckit.specify criará a pasta da feature, mas não a branch.`

### `--upgrade`

Para cada arquivo do manifesto: hash atual == hash gravado → substitui pelo embutido (`atualizados`); diferente → mantém (`mantidos (modificados)`); ausente → cria. Arquivos que o manifesto não conhece não são tocados. Versão registrada em `init-options.json` e manifesto.

### `-p`

`maestro -p "/speckit.init"` executa e imprime o relatório em stdout; código 0.

## 2. Assets embutidos

```
assets/speckit/
├── VERSION                      # v1.2.3 · 8ac9e8103319d98099cfc274a2517bb2b621626c
├── NOTICE                       # MIT, Copyright (c) GitHub, Inc.; lista de modificações do Maestro
├── templates/*.md               # 5 templates + agent-file-template.md (do 0.4.5)
├── templates/commands/*.md      # 10 comandos (specify e plan com as modificações de research R4/R7)
└── scripts/{bash,powershell,python}/*
```

`package.json` → `files` inclui `assets`; `src/speckit/assets.ts` resolve a pasta ao lado do pacote (`../../assets/speckit` a partir de `src/speckit/` e de `dist/speckit/`). `maestro --version` mostra `spec-kit v1.2.3` na segunda linha; `/speckit.status` mostra embutida × instalada.

Atribuição: seção **spec-kit** em `THIRD_PARTY_NOTICES.md` (repositório, tag, commit, MIT, texto da licença, lista das modificações) e crédito no README.

## 3. Contexto do projeto no prompt de sistema

| Situação | Comportamento |
|---|---|
| `MAESTRO.md` na pasta de trabalho | Anexado ao prompt de sistema como `# Project guidelines (MAESTRO.md)`; `--debug`: `context.loaded { file: 'MAESTRO.md', bytes }` |
| Só `CLAUDE.md` | Idem com `CLAUDE.md`; aviso único na transcrição: `Contexto do projeto: CLAUDE.md (crie MAESTRO.md para um contexto próprio)` |
| Nenhum | Nada |
| Arquivo > 24 KB | Carregado inteiro; aviso `Contexto do projeto grande (NN KB); considere enxugar MAESTRO.md` |

O passo `update-agent-context` cria/atualiza `MAESTRO.md` com o template de arquivo de agente (contracts/native-steps.md § 4) e também os arquivos de agentes conhecidos que já existam.

## 4. Configuração

```json
"speckit": { "createBranch": true }
```

`createBranch: false` faz `/speckit.specify` criar só a pasta e o `feature.json`. Chave válida no global e no projeto.

## 5. Testes que fixam este contrato

- `tests/unit/speckit/init.test.ts` — § 1 (criar, idempotente, upgrade: igual/modificado/ausente, sem git, merge de `integration.json`).
- `tests/unit/speckit/assets.test.ts` — § 2 (VERSION, 10 comandos, 6 templates, scripts presentes; `files` do `package.json`).
- `tests/unit/config/projectContext.test.ts` e `tests/unit/session/systemPrompt.test.ts` — § 3.
- `tests/contract/config-schema.test.ts` — § 4.
- `tests/unit/license/attribution.test.ts` — seção spec-kit e `assets/speckit/NOTICE`.
