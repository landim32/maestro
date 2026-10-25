# Research — Modos de Aprovação (TAB), `ask_user` e Créditos ao qwen-code

**Branch**: `005-approval-modes-ask-user` · **Date**: 2026-10-25

Levantamento do estado atual do código, do que o qwen-code faz e das decisões técnicas. Nenhum `NEEDS CLARIFICATION` ficou aberto.

## R0. Estado atual (o que já existe e o que falta)

| Aspecto | Hoje | Lacuna frente à spec |
|---|---|---|
| Confirmação de ferramentas | `ToolDefinition.requiresConfirmation: boolean` (`write_file`, `run_command` = true); `turn.ts → executeTool` chama `cb.confirm` e espera `y`/`n` | Decisão binária e fixa; precisa depender do modo e da classe da ação (edição / comando / comando destrutivo) |
| Estado da sessão | `SessionState = idle \| generating \| awaiting_confirmation`; `pendingConfirmation` + `ConfirmationDialog` acima do prompt; `useKeyboard` responde `y`/`n` | Falta um estado "aguardando resposta" para `ask_user` e o roteamento de teclas do novo diálogo |
| TAB | Não tratado em `useKeyboard`; `TextField` dos diálogos já ignora `key.tab` | `InputPrompt` precisa ignorar TAB e `useKeyboard` precisa ciclar o modo |
| Barra de status | `STATE_TEXT` + dicas por estado; aviso transitório (`transientNotice`) já existe no `App` | Falta o modo (rótulo e cor) |
| Argumentos / settings | `--tools/--no-tools`; `tools.{enabled, commandTimeoutMs, maxOutputChars}`; `applyOverrides` injeta `tools.enabled` | Faltam `tools.approvalMode`, `--approval-mode`, `--yolo` |
| `-p` | `confirm` ausente → toda ação que exige confirmação é recusada | Deve obedecer ao modo; `ask_user` deve responder "sem usuário" |
| Ferramentas | `ToolName` união fechada; `toolsFor(settings)` devolve tudo ou nada | Falta `ask_user`, disponível mesmo com `--no-tools` |
| Transcrição | `onToolStart` emite aviso `⚙ nome caminho`; `MessageList` mostra `tool_call`/`tool_result` | Falta indicar "executado sem confirmação (modo X)" com resumo |
| Licença | `LICENSE` MIT (Rodrigo Landim Carneiro, 2026); `package.json` **sem** campo `license`; `files: [dist, README.md]` | Faltam `license`, avisos de terceiros, cabeçalhos, créditos no README, princípios na constituição |
| Constituição | `.specify/memory/constitution.md` ainda é o template (não ratificada) | FR-024 exige registrar os princípios open-source e de atribuição |

## R1. Como o qwen-code faz os modos de aprovação

**Fonte** (referência fixada): `QwenLM/qwen-code`, branch `main`, commit `1c9cdd234fd9a391cac146e2d4c834d603afd045` (2026-10-25; último release `v0.26.1`, 2026-10-24). Licença Apache-2.0; `LICENSE` traz "Copyright 2025 Google LLC" e "Copyright 2025 Qwen"; cabeçalhos de arquivo usam `@license` + `Copyright 2025 Qwen Team` (ou `Google LLC` nos herdados do gemini-cli) + `SPDX-License-Identifier: Apache-2.0`.

- `packages/core/src/config/approval-mode.ts`: `enum ApprovalMode { PLAN='plan', DEFAULT='default', AUTO_EDIT='auto-edit', AUTO='auto', YOLO='yolo' }`, `APPROVAL_MODES = Object.values(ApprovalMode)`.
- `docs/users/features/approval-mode.md`: **Plan** (somente leitura), **Ask Permissions** (`default`, pede para toda edição e comando), **Auto-Edit** (edições aprovadas, comandos pedem), **Auto** (um classificador LLM avalia comandos, chamadas de rede e edições fora do workspace, bloqueando em caso de dúvida), **YOLO** (tudo aprovado). Atalho: **Shift+Tab (Tab no Windows)** cicla `plan → default → auto-edit → auto → yolo`. Configuração: `tools.approvalMode` em `settings.json` (projeto ou usuário); comando `/approval-mode <modo>` (YOLO só na sessão, salvo `--project`/`--user`).
- `packages/cli/src/config/approval-mode-value.ts`: normaliza a grafia (`auto_edit`/`autoedit` → `auto-edit`) e rejeita valores desconhecidos.
- `packages/cli/src/ui/components/approvalModeVisuals.ts`: cores por modo — `auto-edit` warning, `auto` link, `yolo` error, `default` secundário; prefixo do prompt `*` em YOLO.

**Decision**: quatro modos `default | auto-edit | auto | yolo`, nesta ordem de ciclo, mesmos valores do qwen-code (sem `plan`, fora de escopo). TAB avança; Shift+TAB volta. Chave `tools.approvalMode`; argumentos `--approval-mode <modo>` e `--yolo`; comando `/approval-mode [modo]` para mostrar/trocar por texto (mesmo nome do qwen-code). O "Automático" do Maestro usa **uma lista de padrões destrutivos** (R3), não um classificador LLM — custo zero, determinístico e testável; a documentação deixa explícito que é conveniência, não barreira.

**Rationale**: os quatro nomes pedidos pelo usuário correspondem um a um a `default`, `auto-edit`, `auto`, `yolo`; manter os valores do qwen-code facilita a migração mental de quem já o usa. Um classificador LLM dobraria o custo de cada comando e tornaria o comportamento não determinístico nos testes.

**Alternatives considered**: incluir `plan` (o usuário não pediu; o Maestro não tem modo de planejamento); classificador LLM para "Automático" (rejeitado acima); Shift+TAB como atalho principal (o usuário pediu TAB; o próprio qwen-code usa TAB no Windows).

## R2. Onde a decisão de confirmar passa a viver

**Decision**: `ToolDefinition.requiresConfirmation: boolean` é substituído por `kind: 'read' | 'edit' | 'command' | 'question'`. Um módulo puro `src/tools/approval.ts` expõe `classifyAction(tool, input) → { kind: ActionKind, reason? }` (onde `command` vira `destructive` quando `isDestructiveCommand` reconhece um padrão) e `needsConfirmation(mode, kind) → boolean` segundo a tabela da spec (FR-003). `turn.ts → executeTool` consulta `opts.approvalMode()` (getter, para refletir uma troca por TAB no meio do turno) e: pede confirmação (fluxo atual, com `reason` no `PendingToolAction`), ou executa e emite `cb.onAutoApproved(name, summary, mode)` para a transcrição (FR-005). Ferramentas `read` nunca pedem; `question` segue R4.

**Rationale**: a classe da ação é propriedade da ferramenta; a política é propriedade da sessão. Separar as duas mantém `turn.ts` pequeno e deixa `approval.ts` 100% testável por tabela.

**Alternatives considered**: `requiresConfirmation: (mode) => boolean` em cada ferramenta (espalha a política); decidir na UI (o `-p` não tem UI).

## R3. Padrões de comando destrutivo

**Decision**: lista em `src/tools/approval.ts` (`DESTRUCTIVE_PATTERNS: Array<{ id, pattern: RegExp, reason }>`), aplicada ao texto do comando (case‑insensitive, separadores `;`, `&&`, `||`, `|` considerados — cada segmento é testado). Conjunto inicial:

| id | padrão (resumo) | motivo exibido |
|---|---|---|
| `rm-recursive` | `rm` com `-r`/`-rf`/`-fr`, `rmdir /s`, `Remove-Item … -Recurse` | remoção recursiva |
| `rm-force` | `rm -f`, `del /f /q`, `Remove-Item … -Force` | remoção forçada |
| `git-destructive` | `git reset --hard`, `git clean -f`, `git checkout -- .`, `git restore .`, `git branch -D`, `git rebase`/`commit --amend`, `git stash drop/clear` | descarta alterações ou reescreve histórico |
| `git-force-push` | `git push` com `--force`, `-f`, `+ref`, `--force-with-lease`, `--delete` | envio forçado ao remoto |
| `disk` | `mkfs`, `format `, `diskpart`, `dd if=`, `fdisk`, `parted` | formatação / escrita direta em disco |
| `power` | `shutdown`, `reboot`, `halt`, `poweroff`, `Restart-Computer`, `Stop-Computer` | desligamento / reinício |
| `perms` | `chmod -R`, `chown -R`, `icacls … /T`, `takeown /r` | permissões em massa |
| `sys-redirect` | redirecionamento `>`/`>>` para `/etc/`, `/boot/`, `C:\Windows\` | sobrescreve arquivos de sistema |
| `pipe-shell` | `curl`/`wget`/`iwr` … `\| sh`/`bash`/`iex` | executa download sem inspeção |
| `sudo` | linha começando com `sudo`/`doas`/`runas` | privilégios elevados |

**Rationale**: cobre os exemplos exigidos por FR-004 e os citados pela doc do qwen-code (`rm -rf /`, `curl … | sh`, force‑push). Testes de tabela positivos e negativos (`rm file.txt`, `git push`, `npm test`, `format-code.sh`) evitam falsos positivos óbvios; a lista é documentada no README.

**Alternatives considered**: analisar o comando com um parser de shell (dependência nova, dois shells diferentes); bloquear em vez de pedir confirmação (a spec manda pedir).

## R4. Como o qwen-code faz o `ask_user`

**Fonte**: `packages/core/src/tools/askUserQuestion.ts` (nome `ask_user_question`), `packages/cli/src/ui/components/messages/AskUserQuestionDialog.tsx`.

- Parâmetros: `questions` (1–4) de `{ question, header (≤ 12 chars, não imposto), options (2–4 de { label, description }), multiSelect? }`; `metadata.source?` opcional; `additionalProperties: false`.
- Validação com mensagens `Question N: "header" must be a non-empty string.` etc.
- Descrição ao modelo inclui: "Use this tool when you need to ask the user questions during execution", "Users will always be able to select "Other" to provide custom text input", "Use multiSelect: true to allow multiple answers", "If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label".
- Resposta ao modelo: `User has provided the following answers:` + linhas `**<header>**: <valor>`; cancelamento → `User declined to answer the questions.`; sem UI → `Cannot ask user questions in non-interactive mode…`.
- Diálogo: uma pergunta por vez (abas por `header` quando há várias, aba final "Submit"); ↑/↓ e Ctrl+P/N navegam; dígitos 1–9 pulam para a opção; Espaço marca em múltipla escolha; Enter confirma; Esc/Ctrl+C cancela; opção extra "Other" com `TextInput` inline (`Type something...`), vazio não confirma; múltipla escolha junta rótulos com `, `.

**Decision**: ferramenta `ask_user` (nome pedido pelo usuário; o do qwen-code é `ask_user_question`) em `src/tools/askUser.ts` com esquema zod equivalente (`questions` 1–4; `header` 1–12 chars **imposto**; `options` 2–4 com rótulos únicos; `multiSelect` default false), descrição e formato de resposta **adaptados** do qwen-code (com cabeçalho de atribuição). Fluxo de diálogo como reducer puro em `src/setup/askUserFlow.ts` (uma pergunta por vez com "pergunta N de M" em vez de abas — cabe melhor no `DialogFrame` existente; sem abas Submit: a última pergunta confirma o conjunto; Esc cancela tudo). Teclas: ↑/↓, Espaço (múltipla), Enter, Esc, dígitos 1–9 e "Outro…" com `TextField` (vazio não confirma). Resposta ao modelo no mesmo formato do qwen-code.

**Rationale**: reaproveita `DialogFrame`/`SelectList`/`TextField`; o reducer puro segue o padrão dos fluxos `/auth` e `/model`; o formato de resposta igual ao qwen-code mantém a compatibilidade com prompts/modelos já acostumados.

**Alternatives considered**: usar o mecanismo `DialogState` do controller (recusa abrir fora de `idle`; o `ask_user` ocorre durante a geração); abas como no qwen-code (mais código, pouco ganho no terminal).

## R5. Como o `ask_user` chega até a UI e volta

**Decision**: `Session` ganha `pendingQuestion?: PendingQuestion` e o estado `awaiting_answer` (`setPendingQuestion(q)` ↔ `setState`), simétrico a `pendingConfirmation`. `ToolContext` ganha `ask?: (request: AskUserRequest) => Promise<AskUserOutcome>`; `turn.ts` injeta `cb.ask` (controller interativo) ou nada (`-p`). O controller mantém `questionFlow?: AskUserFlowState` e `dispatchQuestion(key)`; o reducer devolve `{ step: 'done', answers }` ou `{ step: 'cancelled' }` e o controller resolve a promessa. `useKeyboard` roteia teclas em `awaiting_answer` (↑/↓/Enter/Esc/Espaço/dígitos) para `onQuestionKey`; o texto de "Outro…" entra pelo `TextField` (que já ignora as teclas de navegação). `App` renderiza `AskUserDialog` no mesmo lugar do `ConfirmationDialog`.

**Rationale**: `ask_user` não é confirmação, mas é "ação que espera o usuário" — o mesmo molde já existe. Promessa com `resolve` injetado é como o `confirm` de hoje; cancelar a geração (Ctrl+C) resolve a pergunta como não respondida pelo `abort`.

## R6. TAB no teclado

**Decision**: em `useKeyboard`, antes dos tratamentos por estado e **depois** do bloco `dialogOpen`: `if (key.tab) { onCycleMode?.(key.shift ? -1 : 1); return; }`. Em `awaiting_confirmation` e `awaiting_answer` o TAB também cicla (FR-008: a ação pendente continua esperando; `pending` não é tocado). `InputPrompt` passa a ignorar `key.tab` (hoje não há autocompletar; Ink entrega `input === ''` com `key.tab`, mas o guard explícito evita qualquer `\t`). Com diálogo `/auth`/`/model` aberto, TAB é ignorado (o `return` do bloco `dialogOpen` já cobre).

**Rationale**: um só ponto de entrada de teclas (já existe) e teste de contrato em `tests/contract/keys.test.ts`.

## R7. Onde mora o modo e como chega ao turno

**Decision**: `SessionController.approvalMode: ApprovalMode` (inicial = `settings.tools.approvalMode`, já com `--approval-mode`/`--yolo` aplicados pelo `loader.applyOverrides`); `cycleApprovalMode(dir)` e `setApprovalMode(mode)` emitem `change` e um aviso transitório via novo campo `controller.transient?: { text, at }` consumido pelo `App` (que já tem `transientNotice` local — passa a aceitar os dois). `runTurn` recebe `approvalMode: () => ApprovalMode`. Nada é gravado em `settings.json` (FR-007). `useSession` expõe `approvalMode`.

**Alternatives considered**: guardar o modo em `Session` (é política de ferramentas, não estado da conversa); gravar a troca (a spec proíbe).

## R8. `ask_user` e `--no-tools`

**Decision**: `toolsFor(settings)` passa a devolver `[askUserTool]` quando `tools.enabled === false` e todas quando `true`; `buildSystemPrompt` ganha um parágrafo sobre `ask_user` (quando perguntar; não usar para confirmações). Em `-p`, a ferramenta continua listada, mas responde "no user is available to answer in non-interactive mode" (FR-017).

**Rationale**: FR-016; `ask_user` não toca o workspace. Manter a ferramenta listada em `-p` evita um `unknown tool` quando o modelo tenta usá‑la e dá uma mensagem útil.

## R9. Atribuição e licenciamento

**Decision**:

1. **Cabeçalho** nos arquivos com código copiado/adaptado (lista em R10), no formato do próprio qwen-code acrescido da origem:
   ```ts
   /**
    * @license
    * Portions adapted from qwen-code (https://github.com/QwenLM/qwen-code),
    * <caminho no qwen-code> @ 1c9cdd234fd9a391cac146e2d4c834d603afd045.
    * Copyright 2025 Qwen Team. Copyright 2025 Google LLC.
    * SPDX-License-Identifier: Apache-2.0
    * Modified for Maestro; see THIRD_PARTY_NOTICES.md.
    */
   ```
2. **`THIRD_PARTY_NOTICES.md`** na raiz: seção por projeto (qwen-code, gemini-cli) com repositório, titulares, licença, commit de referência, lista dos arquivos do Maestro que contêm material adaptado, e o texto integral da Apache License 2.0.
3. **`LICENSE`** continua MIT; ganha um parágrafo final apontando para `THIRD_PARTY_NOTICES.md`.
4. **`package.json`**: `"license": "MIT"`; `files` += `LICENSE`, `THIRD_PARTY_NOTICES.md` (FR-025; `npm pack` do workflow passa a incluí‑los).
5. **README**: seções "Licença" (MIT; é e continuará open-source) e "Créditos" (qwen-code com link, gemini-cli por herança, Claude Code como inspiração de UX já citada).
6. **Constituição** ratificada (v1.0.0) com os princípios já usados nos gates das features anteriores (simplicidade, CLI texto I/O, testabilidade, segurança de credenciais, observabilidade mínima) **mais** "Open-source permanente" e "Atribuição de terceiros".
7. **Teste** `tests/unit/license/attribution.test.ts`: lê a lista de arquivos de `THIRD_PARTY_NOTICES.md` e verifica o cabeçalho em cada um; verifica `package.json.license === 'MIT'`, `private !== true`, `files` com os dois arquivos (SC-006).

**Rationale**: Apache-2.0 § 4 exige manter avisos de copyright, indicar modificações e reproduzir o NOTICE (o qwen-code não tem NOTICE; reproduzimos os copyrights do `LICENSE`). MIT e Apache-2.0 são compatíveis para esta combinação.

## R10. Arquivos do Maestro que receberão cabeçalho de atribuição

| Arquivo do Maestro | Origem no qwen-code | O que é adaptado |
|---|---|---|
| `src/tools/approval.ts` | `packages/core/src/config/approval-mode.ts`, `packages/cli/src/config/approval-mode-value.ts` | valores/ordem dos modos, normalização de grafia |
| `src/tools/askUser.ts` | `packages/core/src/tools/askUserQuestion.ts` | esquema de parâmetros, mensagens de validação, descrição ao modelo, formato das respostas |
| `src/setup/askUserFlow.ts` | `packages/cli/src/ui/components/messages/AskUserQuestionDialog.tsx` | semântica de teclas (dígitos, Espaço, "Outro…", vazio não confirma, junção com `, `) |
| `src/ui/dialogs/AskUserDialog.tsx` | idem | estrutura do diálogo |
| `src/ui/components/StatusBar.tsx` | `packages/cli/src/ui/components/approvalModeVisuals.ts` | cores por modo (`auto-edit` amarelo, `auto` azul, `yolo` vermelho) |

A lista final é a fonte de verdade do `THIRD_PARTY_NOTICES.md` e do teste de atribuição; se durante a implementação um arquivo não usar nada do qwen-code, sai da lista.

## R11. Testes

- **Unit**: `tests/unit/tools/approval.test.ts` (tabela modo × classe; ciclo; padrões destrutivos positivos/negativos; `parseApprovalMode`); `tests/unit/tools/askUser.test.ts` (esquema, validação, formatação de respostas, `-p`); `tests/unit/setup/askUserFlow.test.ts` (reducer: única, múltipla, Outro, dígitos, N de M, cancelamento).
- **Contract**: `tests/contract/keys.test.ts` (+TAB cicla; Shift+TAB volta; TAB ignorado em diálogo; TAB em `awaiting_confirmation` não resolve o `pending`); `tests/contract/config-schema.test.ts` (+`tools.approvalMode`); `tests/contract/cli-args.test.ts` ou equivalente (`--approval-mode`, `--yolo`, valor inválido → `UsageError`); `tests/contract/tool-schemas.test.ts` se existir (JSON Schema de `ask_user` gerado por `z.toJSONSchema`).
- **Integration (UI)**: `tests/integration/ui/approvalMode.test.tsx` (TAB muda a barra de status; `auto-edit` executa `write_file` sem diálogo e registra aviso; `auto` pede para `rm -rf`; pendente sobrevive ao TAB); `tests/integration/ui/dialogs.askUser.test.tsx` (FakeProvider emite `tool_call ask_user`; teclas; resposta chega ao provedor como `tool_result`; Esc → declined; em YOLO ainda pergunta).
- **Integration (CLI)**: `tests/integration/cli/nonInteractive.test.ts` (+`--approval-mode auto` executa `write_file`; padrão recusa; `ask_user` → sem usuário).
- **Security**: `tests/unit/security/noSecrets.test.ts` (+texto livre de "Outro…" não aparece em `history.jsonl` nem no log).
- **License**: `tests/unit/license/attribution.test.ts` (R9.7).
