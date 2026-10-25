# Contract — Modos de aprovação

**Feature**: `005-approval-modes-ask-user` · **Date**: 2026-10-25

## 1. Modos

| id | rótulo | curto | o que pede confirmação |
|---|---|---|---|
| `default` | Pedir permissão | `ask` | edições, comandos, comandos destrutivos |
| `auto-edit` | Aceitar edições | `edits` | comandos, comandos destrutivos |
| `auto` | Automático | `auto` | comandos destrutivos |
| `yolo` | YOLO | `YOLO` | nada |

Ordem do ciclo: `default → auto-edit → auto → yolo → default`. Grafias aceitas na entrada (`--approval-mode`, `tools.approvalMode`, `/approval-mode`): os ids acima, sem distinção de caixa; `auto_edit` e `autoedit` valem `auto-edit`. Qualquer outro valor: `UsageError` (argumento), `ConfigError` com `tools.approvalMode: …` (arquivo) ou aviso (comando).

## 2. Teclas

| Contexto | TAB | Shift+TAB |
|---|---|---|
| Prompt ativo (`idle`) | próximo modo | modo anterior |
| `generating` | próximo modo (vale para as próximas ações do turno) | anterior |
| `awaiting_confirmation` | próximo modo; o diálogo pendente **continua** aguardando `y`/`n` | anterior |
| `awaiting_answer` (`ask_user`) | próximo modo; a pergunta continua | anterior |
| Diálogo `/auth` ou `/model` aberto | ignorado | ignorado |

TAB nunca insere caracteres nem apaga o texto em edição no prompt. Após a troca, a barra de status mostra por ~3 s o aviso `modo: <rótulo>`.

## 3. Barra de status

- Lado esquerdo: `<estado> · <rótulo do modo>` (`ready · Pedir permissão`); em terminal compacto, `<estado> · <curto>`.
- Cor: `auto-edit` e `auto` em amarelo; `yolo` em vermelho e negrito; `default` sem cor (apagado). Sem cor (`--no-color`), YOLO aparece em maiúsculas com `!` (`YOLO!`).
- Dica (lado direito) ganha `Tab modo` quando não compacto.

## 4. Transcrição

Ação executada sem confirmação gera aviso `info` **antes** da execução:

```
⚙ write_file src/a.ts  ·  new file: src/a.ts (12 lines)  ·  auto (Aceitar edições)
⚙ run_command  ·  $ npm test  ·  auto (Automático)
```

Formato: `⚙ <ferramenta> <alvo> · <primeira linha do preview> · auto (<rótulo do modo>)`. O diálogo de confirmação, quando exigido por padrão destrutivo em `auto`, mostra a linha `Confirmação exigida: <motivo>` abaixo do título.

## 5. Argumentos e configuração

```
maestro --approval-mode auto
maestro --yolo                       # = --approval-mode yolo
maestro -p "rode os testes" --approval-mode auto
```

`settings.json`: `"tools": { "approvalMode": "auto-edit" }` (global ou projeto). A troca por TAB ou `/approval-mode` **nunca** grava.

## 6. `-p` (não interativo)

| Modo em vigor | `write_file` | `run_command` comum | comando destrutivo | `ask_user` |
|---|---|---|---|---|
| `default` | recusa¹ | recusa¹ | recusa¹ | sem usuário² |
| `auto-edit` | executa | recusa¹ | recusa¹ | sem usuário² |
| `auto` | executa | executa | recusa¹ | sem usuário² |
| `yolo` | executa | executa | executa | sem usuário² |

¹ `tool_result` de erro `confirmation required (<modo>); not available in non-interactive mode`, como hoje.  
² `tool_result` sem erro com o texto `NO_USER_TEXT` (contracts/ask-user.md § 4). O aviso `⚙ … auto (<modo>)` vai para stderr como os demais.

## 7. `/approval-mode`

```
/approval-mode             → "Modo de aprovação: Automático (auto)" + lista dos quatro com descrição
/approval-mode yolo        → troca (sessão) + aviso "modo: YOLO"
/approval-mode foo         → aviso "Modo desconhecido 'foo'. Opções: default, auto-edit, auto, yolo."
```

Em `-p`, só a forma sem argumento tem efeito (informativo).

## 8. Padrões destrutivos (README § "Modos de aprovação")

A lista de research R3 é publicada no README com a frase: "É uma conveniência para evitar acidentes, não uma barreira de segurança; em repositórios sem controle de versão prefira *Pedir permissão*."

## 9. Testes que fixam este contrato

- `tests/unit/tools/approval.test.ts` — tabela § 1, ciclo, `parseApprovalMode`, padrões destrutivos (positivos: `rm -rf dist`, `git push --force origin main`, `curl x | sh`, `Remove-Item -Recurse .`; negativos: `rm notes.txt`, `git push`, `npm run format`, `ls -R`).
- `tests/contract/keys.test.ts` — § 2.
- `tests/integration/ui/approvalMode.test.tsx` — § 3, § 4, pendente sobrevive ao TAB.
- `tests/integration/cli/nonInteractive.test.ts` — § 6.
- `tests/contract/config-schema.test.ts`, teste de `parseArgs` — § 5.
