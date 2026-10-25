# Tasks: Provedor Claude Code

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Fundação

- [X] T001 `src/config/schema.ts` + `src/config/defaults.ts`: `PROVIDER_IDS` ganha `claude-code`; `claudeCodeProviderSchema` (`enabled` false, `model`, `models`, `effort`, `command?`); `INITIAL_SETTINGS` com comentário
- [X] T002 `src/config/loader.ts`: fonte de credencial `claude-code` = `cli` quando o executável existe; `CredentialSource` ganha `cli`
- [X] T003 `src/providers/types.ts`: `capabilities.executesTools`, `ProviderRequest.runTool`
- [X] T004 `src/providers/status.ts`: nomes ("Claude API (créditos de API)", "Claude Code (assinatura)"), dicas e `describeProvider` para `claude-code`

## Phase 2: User Story 1 — conversar pelo Claude Code (P1)

- [X] T005 [US1] `src/providers/claudeCodeStream.ts` (puro): `buildArgs`, `buildUserMessage` (histórico em `<conversation_history>` + última mensagem com imagens), `parseLine` → eventos, `mapResultError`
- [X] T006 [US1] `src/providers/claudeCode.ts`: localizar o executável, `spawn` injetável, stdin JSON, stdout linha a linha, cancelamento com `killTree`, uso de tokens do `result`, erros
- [X] T007 [US1] `src/providers/index.ts`: registrar o provedor
- [X] T008 [P] [US1] `tests/unit/providers/claudeCodeStream.test.ts` e `tests/unit/providers/claudeCode.test.ts` (Claude Code falso)

## Phase 3: User Story 2 — ferramentas via MCP (P1)

- [X] T009 [US2] `src/providers/mcpBridge.ts`: servidor HTTP em 127.0.0.1:0, token Bearer, `initialize`/`tools/list`/`tools/call`/`ping`, notificações → 202, GET → 405, `close()`
- [X] T010 [US2] `src/providers/claudeCode.ts`: subir a ponte quando houver ferramentas, `--mcp-config`, `--allowedTools mcp__maestro__*`, `MCP_TOOL_TIMEOUT`
- [X] T011 [US2] `src/session/turn.ts`: `runTool` para provedores com `executesTools` (grava chamada e resultado no histórico, limite de chamadas, cancelamento)
- [X] T012 [P] [US2] `tests/unit/providers/mcpBridge.test.ts` e `tests/integration/session/providerDrivenTurn.test.ts`

## Phase 4: User Story 3 — `/auth` e avisos (P2)

- [X] T013 [US3] `src/setup/claudeCodeCli.ts`: `locate`, `readStatus` (`claude auth status`, JSON)
- [X] T014 [US3] `src/setup/methods.ts`: método `claude-code`; descrições de `claude-api` e `claude-login` com "créditos de API"; rótulos de status
- [X] T015 [US3] `src/setup/driver.ts` + `src/ui/dialogs/AuthDialog.tsx`: passos `login.*` conforme o método (Claude Code só verifica o status)
- [X] T016 [US3] `src/utils/errors.ts` + `src/providers/anthropicProtocol.ts`: categoria `billing` para saldo insuficiente
- [X] T017 [US3] `src/ui/dialogs/ModelDialog.tsx` + `BILLING_NOTES` em `src/providers/status.ts`: rótulo do grupo por provedor (API · consome créditos / assinatura do Claude Code)
- [X] T018 [P] [US3] testes de métodos, driver e erro de saldo

## Phase 5: Polimento

- [X] T019 `README.md`: seção Claude Code, diferença de cobrança e ressalva dos termos; `CLAUDE.md`
- [X] T020 `npm run lint`, `npm run typecheck`, `npm test`
- [X] T021 Teste manual com o Claude Code real (2.1.310, login claude.ai): leitura, escrita com confirmação, escrita recusada, contexto no segundo turno, cancelamento no meio do streaming, `maestro -p` compilado e `claude auth status`
- [ ] T022 Teste manual na sessão interativa: `/auth` → Claude Code, `/model claude-code` e um `/speckit.*` pelo Claude Code
