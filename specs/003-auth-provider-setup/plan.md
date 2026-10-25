# Implementation Plan: Configuração de Provedores pela Sessão (/auth) e Seleção de Modelo (/model)

**Branch**: `003-auth-provider-setup` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-auth-provider-setup/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Adicionar ao Maestro um sistema de diálogos modais no console e dois comandos que o usam: `/auth` (apelidos `/connect`, `/login`) para conectar provedores — Claude por chave de API, Claude por login OAuth via CLI `ant`, e Qwen (DashScope) — com campos guiados, teste de conexão, gravação em `settings.json` e ativação imediata; e `/model` sem argumentos, que abre um seletor com o modelo ativo e todos os configurados. Os fluxos são máquinas de estado puras em `src/setup/` (testáveis sem UI), os efeitos (teste de conexão, gravação, processo `ant`) são injetáveis, e a UI em `src/ui/dialogs/` reutiliza o layout de altura fixa da feature 002. Nenhuma dependência nova. Detalhes em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.  
**Primary Dependencies**: existentes — `ink` 8 (`useInput` com `isActive`), `@anthropic-ai/sdk` (`models.retrieve` para teste), `openai` (`chat.completions.create` mínimo para teste), `zod` (validação antes de gravar), `node:child_process` (CLI `ant`). Nenhuma nova.  
**Storage**: `~/.maestro/settings.json` passa a ser **escrito** pelo Maestro (patch por caminho, preservando `_comment`, escrita atômica).  
**Testing**: `vitest` + `renderSized`/`appHarness` da feature 002; SDKs e processo `ant` mockados; `MAESTRO_HOME` temporário para gravação.  
**Target Platform**: Windows, macOS, Linux; detecção da CLI `ant` por PATH e diretório padrão do Windows.  
**Project Type**: CLI (mesmo pacote).  
**Performance Goals**: diálogo abre em < 1 frame; teste de conexão ≤ 10 s com cancelamento; troca pelo seletor reflete no cabeçalho em < 1 s (SC‑004).  
**Constraints**: chaves nunca em texto claro (mascaramento na digitação, exibição e logs); sem instalação automática da CLI; `-p` inalterado; layout nunca excede `rows`.  
**Scale/Scope**: 3 métodos de conexão fixos; ~14 arquivos novos (setup/, ui/dialogs/, config/writer), ~6 alterados.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constituição ainda não ratificada; gates contra os princípios padrão, como nas features anteriores.

| Gate | Pré‑Phase 0 | Pós‑Phase 1 |
|---|---|---|
| **Simplicidade / YAGNI** | PASS — 3 métodos fixos, sem instalação automática, sem listagem dinâmica de modelos | PASS — reducers puros + driver injetável evitam acoplamento à UI sem criar camadas extras |
| **CLI texto I/O** | PASS — `-p` recusa diálogos com orientação textual e código 0 | PASS — contrato em [contracts/commands.md](./contracts/commands.md) |
| **Testabilidade** | PASS — fluxos como reducers, efeitos injetáveis | PASS — research R9 |
| **Segurança de credenciais** | PASS — `TextField` mascarado, `mask()` em todas as exibições, gravação validada | PASS — teste `noSecrets` estendido ao diálogo |
| **Observabilidade mínima** | PASS — causas de falha no próprio diálogo; `--debug` registra eventos de setup sem segredos | PASS |

**Violações a justificar**: nenhuma.

## Project Structure

### Documentation (this feature)

```text
specs/003-auth-provider-setup/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── commands.md          # /auth, /connect, /login, /model (texto e diálogo), modo -p
│   ├── dialog-flows.md      # passos, campos, teclas, textos de estado, resultados do teste e do login
│   └── settings-writer.md   # patch por caminho, atomicidade, validação, mensagens de erro
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── config/
│   └── writer.ts                 # readRawSettings, patchSettings(paths), writeSettingsAtomic, projectOverrides(paths)
├── utils/
│   └── process.ts                # killTree (movido de tools/runCommand.ts), findExecutable(name, extraDirs)
├── setup/                        # domínio dos fluxos (sem UI)
│   ├── methods.ts                # CONNECTION_METHODS: claude-api | claude-login | qwen (rótulo, provedor, campos, padrões)
│   ├── authFlow.ts               # reducer puro do /auth (estados e eventos, data-model § 3)
│   ├── modelFlow.ts              # reducer puro do /model (lista → seleção/texto → gravação)
│   ├── connectionTest.ts         # testConnection(method, values) → ConnectionTestResult (Anthropic models.retrieve / OpenAI 1-token)
│   ├── antCli.ts                 # locateAnt(), runLogin({onOutput, signal}) → LoginResult, readStatus() → { loggedIn, summary }
│   ├── installHints.ts           # instruções por plataforma
│   └── driver.ts                 # SetupDriver: liga reducer ↔ efeitos (test, write, ant), com dependências injetáveis
├── session/
│   ├── controller.ts             # + dialog: DialogState | undefined; openDialog/closeDialog/dispatchDialog; applySettings(); + logger de setup
│   └── commands.ts               # + /auth (aliases connect, login); /model sem args → diálogo; /model <id> [modelo] inalterado
└── ui/
    ├── App.tsx                   # renderiza DialogHost no lugar do Transcript quando há diálogo; InputPrompt inativo; useKeyboard em modo diálogo
    ├── hooks/useKeyboard.ts      # + dialogOpen: Esc/Ctrl+C simples vão ao diálogo; Ctrl+C duplo ainda sai
    └── dialogs/
        ├── DialogHost.tsx        # escolhe AuthDialog/ModelDialog pelo tipo
        ├── DialogFrame.tsx       # moldura, título, rodapé de teclas; altura limitada
        ├── SelectList.tsx        # lista com estado por item e itens desativados
        ├── TextField.tsx         # campo de texto; mask para chaves; Enter/Esc/Ctrl+U
        ├── ProgressView.tsx      # spinner textual, mensagem, URL opcional, "Esc cancela"
        ├── ResultView.tsx        # sucesso/erro + ações (Tentar novamente / Voltar / Gravar sem testar)
        ├── AuthDialog.tsx        # mapeia AuthFlowState → componentes
        └── ModelDialog.tsx       # mapeia ModelFlowState → componentes

tests/
├── unit/setup/authFlow.test.ts, modelFlow.test.ts, connectionTest.test.ts (SDKs mockados), antCli.test.ts (spawn mockado), installHints.test.ts
├── unit/config/writer.test.ts
├── unit/utils/process.test.ts
├── integration/ui/dialogs.auth.test.tsx     # fluxo Qwen completo com MAESTRO_HOME temporário; chave inválida; Esc; prompt inativo
├── integration/ui/dialogs.login.test.tsx    # ant ausente → instruções; ant mockado → progresso/URL/sucesso/cancelamento
├── integration/ui/dialogs.model.test.tsx    # seleção, item desativado, "digitar outro modelo", gravação
├── integration/cli/nonInteractive.test.ts   # + /auth e /model em -p
└── contract/dialog-flows.test.ts            # ordem de campos por método, teclas, argumentos exatos do ant
```

**Structure Decision**: `src/setup/` concentra a lógica dos fluxos sem dependência de Ink, de modo que toda transição é testada por reducer; `src/ui/dialogs/` só mapeia estado para componentes. O controller ganha um único campo `dialog` e três métodos, mantendo a UI como consumidora de eventos `change`, como já acontece hoje.

## Complexity Tracking

Nenhuma violação. Tabela intencionalmente vazia.

## Phase 0 — Research (concluída)

[research.md](./research.md): R1 interação do `/auth` (qwen code); R2 execução e confirmação do login via CLI `ant` (`--timeout 5m`, stdio sem stdin, parsing de `status`, URL na saída, cancelamento por kill da árvore); R3 instruções de instalação por plataforma; R4 teste de conexão (Claude `models.retrieve`, Qwen conclusão de 1 token, 10 s); R5 gravação atômica preservando `_comment` + aviso de sobrescrita por projeto; R6 componentes; R7 reducers + driver injetável; R8 `/model`; R9 testes. Sem `NEEDS CLARIFICATION`.

## Phase 1 — Design (concluída)

- [data-model.md](./data-model.md) — `ConnectionMethod`, `DialogState`, `AuthFlowState` (máquina de estados completa), `ModelFlowState`, `ConnectionTestResult`, `LoginResult`, `SettingsPatch`.
- [contracts/commands.md](./contracts/commands.md), [contracts/dialog-flows.md](./contracts/dialog-flows.md), [contracts/settings-writer.md](./contracts/settings-writer.md).
- [quickstart.md](./quickstart.md).
- `CLAUDE.md` atualizado pelo script.

## Phase 2 — Próximo passo

`/speckit.tasks`. Ordem sugerida: fundação (writer, process utils, methods, reducers, driver, dialog state no controller, componentes base) → US1 (`/auth` com Claude API e Qwen) → US2 (login via `ant`) → US3 (`/model` seletor) → polish.

## Riscos

| Risco | Mitigação |
|---|---|
| `ant auth login` não abre o navegador em alguns ambientes (SSH, WSL) | URL capturada da saída e exibida; `--timeout 5m`; Esc cancela |
| PATH do processo Maestro sem o `ant` recém‑instalado (Windows) | Fallback para `%LOCALAPPDATA%\Programs\ant\ant.exe`; "Tentar novamente" |
| Teste de conexão do Qwen consome 1 token | Custo desprezível; opção "gravar sem testar" |
| Escrever `settings.json` corrompido | Validação com `settingsSchema` antes de escrever; escrita atômica via arquivo temporário |
| Conflito de teclas entre diálogo, prompt e rolagem | `isActive` por componente; `useKeyboard` em modo diálogo; teste de contrato das teclas |
