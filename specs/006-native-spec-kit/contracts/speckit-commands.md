# Contract — Comandos `/speckit.*` no Maestro

**Feature**: `006-native-spec-kit` · **Date**: 2026-10-25

## 1. Descoberta

| Ordem | Fonte | Arquivos | Origem exibida |
|---|---|---|---|
| 1 | `.maestro/commands/` | `speckit.*.md`, `speckit-*.md` | `projeto` |
| 2 | Pasta da integração ativa em `.specify/integration.json` (`default_integration`, senão `integration`): `claude` → `.claude/commands/`, `cursor-agent` → `.cursor/commands/`, `copilot` → `.github/prompts/*.prompt.md`, `codex` → `.codex/prompts/`, `windsurf` → `.windsurf/workflows/`, `generic` → `integration_settings.generic.commands_dir` | idem | id da integração |
| 3 | Embutidos (`assets/speckit/commands/`) | 10 comandos v1.2.3 | `embutido` |

O primeiro nome encontrado vence. Integrações cujo formato não é markdown (`gemini`, `qwen`: TOML) são ignoradas com aviso no `--debug`. A descoberta roda na abertura da sessão e após `/speckit.init`.

`/help` lista os comandos descobertos após os fixos:

```
Spec Kit (embutido v1.2.3 · projeto: .claude/commands):
  /speckit.specify <descrição>   Create or update the feature specification… (claude)
  /speckit.plan                  Execute the implementation planning workflow… (claude)
  …
  /speckit.init [--upgrade]      Instala ou atualiza o Spec Kit neste projeto (Maestro)
  /speckit.status                Feature atual e artefatos (Maestro)
```

## 2. Execução de um comando de prompt

1. `parseSlash` identifica `speckit.<x>`; argumentos = texto após o nome (sem split por espaço).
2. **Preflight** (FR-005): o passo associado roda em modo de validação; falha → aviso `warn` com a mensagem do script e o comando anterior; o modelo não é chamado.
3. Prompt = preâmbulo (§ 3) + corpo do arquivo com `$ARGUMENTS`/`{ARGS}` substituídos (vazio quando não há argumentos).
4. Mensagem do usuário entra no histórico da conversa com `display = "/speckit.<x> <args>"`; a transcrição mostra o `display`; o provedor recebe o prompt completo.
5. O turno roda normalmente (ferramentas, modo de aprovação, `ask_user`).

Em `-p`: `maestro -p "/speckit.tasks"` segue os mesmos passos; preflight falho → stderr + código 2.

## 3. Preâmbulo (fixo, `src/speckit/preamble.ts`)

Conteúdo mínimo, em inglês:

- "This command is executed by Maestro, a native Spec Kit host. The Spec Kit helper scripts under `.specify/scripts/` (bash, PowerShell or Python spellings) are run natively by Maestro when you call them through `run_command`; they need no confirmation and return the same JSON the scripts would."
- "Whenever the command tells you to ask the user something or to wait for an answer (clarification questions, 'proceed anyway?' checks), call the `ask_user` tool with the suggested options; do not ask in plain text. If no user is available, state the assumption you made."
- "File writes and other commands follow the user's approval mode as usual."

## 4. Sugestões no prompt

- Texto começando com `/` e sem espaço → até 6 linhas `  /nome   descrição` abaixo do campo, filtradas por prefixo (fixos + descobertos).
- **→** completa o primeiro item (acrescenta espaço quando o comando tem argumentos no `usage`); Enter envia o texto digitado; TAB continua sendo o ciclo de modos.
- Sem correspondência: nenhuma linha extra.

## 5. Transcrição

```
› /speckit.plan
⚙ speckit setup-plan  ·  Copied plan template to specs/006-x/plan.md
⚙ speckit update-agent-context  ·  MAESTRO.md atualizado, CLAUDE.md atualizado
```

Passos nativos aparecem como avisos `info` com o prefixo `⚙ speckit <passo>`; nunca como diálogo de confirmação.

## 6. Comandos nativos

| Comando | Efeito |
|---|---|
| `/speckit.init` | Instala o que falta (contracts/init-and-context.md § 1); relatório na transcrição |
| `/speckit.init --upgrade` | Atualiza arquivos não modificados; lista mantidos |
| `/speckit.status` | Feature atual (nome, origem da resolução), artefatos ✓/✗, versão embutida e instalada, pasta de comandos ativa |

## 7. Testes que fixam este contrato

- `tests/unit/speckit/discovery.test.ts` — § 1 (precedência, origem, TOML ignorado).
- `tests/unit/speckit/prompt.test.ts` — § 2–3 (render, preâmbulo, `display`).
- `tests/integration/speckit/flow.test.ts` — § 2 passo 2 (preflight sem chamar o modelo), `-p`.
- `tests/integration/ui/speckit.test.tsx` — § 4–5.
- `tests/unit/session/commands.test.ts` — `/help` com a seção Spec Kit.
