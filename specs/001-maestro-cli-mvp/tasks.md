---

description: "Task list for Maestro CLI – Assistente de IA no Terminal (MVP)"
---

# Tasks: Maestro CLI – Assistente de IA no Terminal (MVP)

**Input**: Design documents from `/specs/001-maestro-cli-mvp/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (cli.md, config-schema.md, provider-interface.md), quickstart.md

**Tests**: O plano define `vitest` com testes unitários, de integração e de contrato (plan.md § Technical Context; contratos § "Testes de contrato derivados"). As tarefas de teste abaixo implementam exatamente esses casos. Nenhum teste automatizado acessa rede: os SDKs são mockados e a sessão usa o provedor `fake`.

**Organization**: Tarefas agrupadas por história de usuário para permitir implementação e validação independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: História a que a tarefa pertence (US1, US2, US3, US4)
- Caminhos exatos em cada descrição

## Path Conventions

Projeto único: `src/` e `tests/` na raiz do repositório, conforme plan.md § Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inicializar o pacote npm, toolchain TypeScript/ESM e esqueleto de diretórios.

- [x] T001 Criar `package.json` na raiz com `name: "maestro"`, `version: "0.1.0"`, `type: "module"`, `bin: { "maestro": "dist/index.js" }`, `engines.node: ">=22"`, scripts `build` (`tsc`), `dev` (`tsx src/index.ts`), `test` (`vitest run`), `test:watch`, `lint` (`eslint .`), `format` (`prettier --write .`); dependências de runtime `@anthropic-ai/sdk`, `openai`, `ink`, `react`, `yargs`, `zod`, `zod-to-json-schema`, `chalk`, `diff`; dev `typescript`, `tsx`, `vitest`, `ink-testing-library`, `@types/node`, `@types/react`, `@types/yargs`, `@types/diff`, `eslint`, `typescript-eslint`, `prettier`; rodar `npm install`
- [x] T002 [P] Criar `tsconfig.json` (target ES2022, module NodeNext, moduleResolution NodeNext, jsx react-jsx, strict, esModuleInterop, outDir `dist`, rootDir `src`, include `src`) e `tsconfig.test.json` que inclui `tests`
- [x] T003 [P] Criar `vitest.config.ts` (environment node, include `tests/**/*.test.ts?(x)`, coverage em `src/`)
- [x] T004 [P] Criar `eslint.config.js` (typescript-eslint recommended + react-hooks) e `.prettierrc` (singleQuote, semi, printWidth 100)
- [x] T005 [P] Criar `.gitignore` com `node_modules/`, `dist/`, `.maestro/`, `coverage/`, `*.log`
- [x] T006 Criar esqueleto de diretórios `src/{cli,config,providers,session,tools,ui/components,ui/hooks,utils}` e `tests/{unit,integration,contract,helpers}` com `src/index.ts` provisório (`#!/usr/bin/env node`, imprime `maestro 0.1.0`) e confirmar que `npm run build && node dist/index.js` funciona

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tipos neutros, configuração validada, utilitários e entrada da CLI que todas as histórias usam.

**⚠️ CRITICAL**: Nenhuma história pode começar antes desta fase terminar.

- [x] T007 [P] Implementar `mask(key)` (`"****" + últimos 4`, `"****"` se ≤ 4 chars) em `src/utils/mask.ts`
- [x] T008 [P] Implementar detecção de TTY e cor (`isInteractive()`, `colorEnabled({ noColorFlag })` respeitando `NO_COLOR` e `process.stdout.isTTY`) em `src/utils/tty.ts`
- [x] T009 [P] Definir `MaestroError` (campos `providerId`, `category`, `message`, `hint`, `cause`) com categorias de data-model.md § 6, helper `toMaestroError(unknown, providerId?)` para erros genéricos (ECONNREFUSED/ENOTFOUND/timeout → `network`, ZodError → `invalid_config`, resto → `unknown`) e `formatError(err, { debug })` em `src/utils/errors.ts`
- [x] T010 [P] Implementar caminhos cross‑platform (`globalConfigDir()` = `~/.maestro`, `globalSettingsPath()`, `projectSettingsPath(cwd)` = `cwd/.maestro/settings.json`, `debugLogPath()`) usando `os.homedir()` e `path` em `src/config/paths.ts`
- [x] T011 Implementar schema zod de `Settings` conforme contracts/config-schema.md § 2 (tipos `ProviderId`, `ClaudeProviderSettings`, `QwenProviderSettings`, `ToolsSettings`, `UiSettings`; `_comment` aceito em qualquer nível; `apiKey: ""` normalizado para `undefined`; `baseUrl` exige `^https?://` e remove barra final; `additionalProperties` proibidos) e `formatZodIssues(issues)` que gera linhas `caminho.do.campo: motivo` em `src/config/schema.ts`
- [x] T012 [P] Criar conteúdo padrão do `settings.json` inicial (exatamente o JSON de contracts/config-schema.md § 4) e `DEFAULTS` internos (modelos `claude-opus-5-5` e `qwen3-coder-plus`, `baseUrl` DashScope, `maxTokens 16000`, `effort "medium"`, `fallbacks true`, `tools.enabled true`, `commandTimeoutMs 60000`, `maxOutputChars 20000`) em `src/config/defaults.ts`
- [x] T013 Implementar `loadSettings({ configPath?, cwd, env, overrides })` em `src/config/loader.ts`: cria `~/.maestro/settings.json` a partir de `defaults.ts` se não existir (retornando flag `created: true`), lê global, faz merge raso por chave com projeto, aplica env (`DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL`, `MAESTRO_PROVIDER`, `MAESTRO_CONFIG`), aplica overrides de args (`provider`, `model`, `noTools`), valida com schema; erro de JSON → `settings.json: invalid JSON at line N, column M`; erro de schema → lista de `campo: motivo`; retorna `Settings` + `credentialSource` por provedor (`config` / `env` / `profile` / `none`, sendo `profile` detectado para claude pela existência de `~/.config/anthropic/credentials/*.json` ou `%APPDATA%\Anthropic\credentials\*.json`)
- [x] T014 [P] Definir tipos neutros `ProviderId`, `Role`, `ContentPart`, `Message`, `ProviderRequest`, `ProviderEvent`, `ModelProvider`, `ProviderFactory`, `ProviderStatus` conforme contracts/provider-interface.md § 1 e data-model.md § 2–3 em `src/providers/types.ts`
- [x] T015 [P] Definir `ToolDefinition<I>`, `ToolContext`, `ToolResult`, `PendingToolAction` conforme data-model.md § 5 em `src/tools/types.ts`
- [x] T016 Implementar registro de provedores em `src/providers/registry.ts`: mapa `factories: Partial<Record<ProviderId, ProviderFactory>>` (vazio nesta fase; preenchido em US1/US2), `createProvider(id, settings)` (erro claro se id não registrado), `listStatuses(settings, activeId, credentialSources)` que monta `ProviderStatus[]` com `enabled`, `configured = enabled && missing.length === 0`, `maskedKey` via `mask()`, `missing` (`["credentials"]` quando não há chave/perfil)
- [x] T017 Criar provedor de teste `createFakeProvider(script: ProviderEvent[][] | ((req) => ProviderEvent[]))` que implementa `ModelProvider`, respeita `signal` (emite `done cancelled` ao abortar) e registra as requisições recebidas, em `tests/helpers/fakeProvider.ts`
- [x] T018 Implementar `Session` (campos `cwd`, `activeProviderId`, `history`, `state`, `pendingConfirmation`, `abortController`; métodos `pushUser(text)` que ignora texto vazio, `pushAssistant(parts, providerId, model)`, `pushToolResults(results)`, `clear()`, `switchProvider(id, model?)` que rejeita se `state !== "idle"`, `setState()`, emissor de eventos `change`) conforme a máquina de estados de data-model.md § 4 em `src/session/session.ts`
- [x] T019 Implementar parser de argumentos com `yargs` conforme contracts/cli.md § 1 (`-p/--prompt`, `--provider` com choices `claude|qwen`, `--model`, `--config`, `--no-tools`, `--no-color`, `--debug`, `-v`, `-h`; posicional → erro de uso com código 2; `strict()`) em `src/cli/args.ts`
- [x] T020 Implementar entrada em `src/index.ts`: parse args → `loadSettings` (falha → stderr + exit 2) → se `created`, imprimir caminho criado e estado dos provedores → `listStatuses` → pré‑voo básico (provedor ativo não configurado e nenhum alternativo configurado → imprimir `missing` com hint e exit 3) → despachar para `runInteractive`/`runNonInteractive` (stubs que lançam "not implemented" até US1/US4)
- [x] T021 [P] Testes de fundação: `tests/unit/utils/mask.test.ts`; `tests/unit/config/loader.test.ts` (primeira execução cria arquivo; merge projeto > global; env > arquivo; args > env; `credentialSource` em cada cenário; JSON inválido e schema inválido com mensagens exatas); `tests/contract/config-schema.test.ts` (exemplo gerado valida; cada regra adicional de contracts/config-schema.md § 2 tem caso negativo); `tests/unit/cli/args.test.ts` (cada opção; posicional → erro); `tests/unit/session/session.test.ts` (transições da tabela de data-model.md § 4; `switchProvider` rejeitado fora de `idle`; mensagem vazia ignorada)

**Checkpoint**: `npm run build && npm test` verdes; `node dist/index.js` cria `~/.maestro/settings.json` e sai com código 3 quando não há credenciais.

---

## Phase 3: User Story 1 – Conversar com um modelo de IA no terminal (Priority: P1) 🎯 MVP

**Goal**: `maestro` abre sessão interativa em Ink, envia mensagens ao provedor Claude, exibe a resposta por streaming, mantém contexto, permite cancelar com Esc e sair com `/exit`.

**Independent Test**: Com `ANTHROPIC_API_KEY` (ou perfil `ant`) presente, rodar `maestro`, enviar "meu nome é Rodrigo" e depois "qual é o meu nome?"; a segunda resposta cita o nome; Esc durante uma resposta longa mantém o parcial; `/exit` encerra com código 0. Com chave inválida, o erro aparece na UI e a sessão continua.

### Implementation for User Story 1

- [x] T022 [US1] Definir o system prompt fixo do Maestro (identidade, cwd, instruções curtas de concisão; sem data/hora para não invalidar cache) em `src/session/systemPrompt.ts`
- [x] T023 [US1] Implementar provedor Claude (texto) em `src/providers/claude.ts`: `createClaudeProvider(settings)` com `new Anthropic()` sem argumentos quando `apiKey`/`baseUrl` ausentes, senão com eles; `status()` sem rede (`configured` = `enabled` && (apiKey config ∨ `ANTHROPIC_API_KEY` ∨ `ANTHROPIC_AUTH_TOKEN` ∨ perfil detectado)); `stream()` usando `client.beta.messages.stream({ model, max_tokens, system, messages, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort } })` quando `fallbacks: true`, senão `client.messages.stream({...})` sem esses campos; **não** enviar `thinking`; converter `Message(user|assistant texto)` → `MessageParam`; emitir `text_delta` em `content_block_delta/text_delta`, `usage` e `done` a partir de `finalMessage()` (`stop_reason` 1:1, `refusal` lê `stop_details`); abortar via `signal` → `done cancelled`; mapear `Anthropic.AuthenticationError`→`auth` (hint `"No Claude credentials found. Run 'ant auth login' or export ANTHROPIC_API_KEY."`), `APIConnectionError`→`network`, `RateLimitError`→`rate_limit`, `BadRequestError` com "context"/"prompt is too long"→`context_length` (hint `"Conversation too long for this model. Use /clear to start over."`), `APIError`→`provider`
- [x] T024 [US1] Registrar `claude: createClaudeProvider` no mapa `factories` de `src/providers/registry.ts`
- [x] T025 [US1] Implementar `runTurn(session, provider, { tools: [], onDelta, onEvent })` em `src/session/turn.ts`: cria `AbortController`, muda estado para `generating`, consome `provider.stream()`, acumula texto, em `done end_turn` faz `pushAssistant`, em `max_tokens` push parcial + aviso, em `refusal` aviso, em `cancelled` push parcial se não vazio, em `error` exibe `MaestroError` sem push; volta a `idle`; expõe `cancel()`; deixa `stopReason: "tool_use"` encaminhado a um hook `onToolUse` (implementado em US3; nesta fase termina o turno com aviso "tools not available")
- [x] T026 [US1] Implementar registro de slash commands em `src/session/commands.ts`: interface `SlashCommand { name, aliases?, description, run(ctx, args) }`, comandos `/help` (lista), `/clear` (rejeita se não `idle`), `/exit` e `/quit`; `parseSlash(input)`; comando desconhecido → mensagem `Unknown command: /foo. Type /help.`; `/model` reservado para US2 (retorna "not available yet")
- [x] T027 [P] [US1] Criar `src/ui/components/Header.tsx` (nome `maestro`, versão, provedor/modelo ativo, cwd)
- [x] T028 [P] [US1] Criar `src/ui/components/MessageList.tsx` (renderiza `history` por papel com cores; mostra resposta parcial em streaming; mensagens de sistema/erro em destaque)
- [x] T029 [P] [US1] Criar `src/ui/components/InputPrompt.tsx` (campo de texto com cursor, Enter envia, ↑/↓ navega mensagens anteriores do usuário, desabilitado durante `generating`)
- [x] T030 [P] [US1] Criar `src/ui/components/StatusBar.tsx` (estado da sessão, atalhos `Esc cancel · Ctrl+C×2 exit · /help`)
- [x] T031 [US1] Criar hook `useSession(session)` que assina o evento `change` e expõe `history`, `state`, `partialText`, `activeProvider`, `notices[]` em `src/ui/hooks/useSession.ts`
- [x] T032 [US1] Criar hook `useKeyboard({ onCancel, onExit })` com Ink `useInput`: Esc e Ctrl+C em `generating` → cancel; Ctrl+C em `idle` → aviso "press Ctrl+C again to exit" e segunda vez em 2 s → exit, em `src/ui/hooks/useKeyboard.ts`
- [x] T033 [US1] Criar `src/ui/App.tsx` compondo Header, MessageList, InputPrompt, StatusBar; `onSubmit` roteia `/comandos` para `commands.ts` e texto para `runTurn`; aplica `colorEnabled` para degradar cores
- [x] T034 [US1] Implementar `runInteractive({ settings, statuses, provider })` em `src/cli/interactive.ts`: recusa sem TTY com mensagem orientando `-p` (exit 2); `render(<App/>)`; `waitUntilExit()`; retorna código 0; ligar em `src/index.ts` substituindo o stub
- [x] T035 [P] [US1] Testes: `tests/unit/providers/claude.test.ts` com `@anthropic-ai/sdk` mockado (`vi.mock`) cobrindo ordem de eventos, cancelamento ≤ 500 ms, mapeamento de cada erro, `status()` nos cenários sem credencial/env/config, escolha de `beta.messages` vs `messages` conforme `fallbacks`; `tests/integration/session/turn.test.ts` com `fakeProvider` (histórico enviado inteiro no 2º turno; cancel mantém parcial; erro não faz push de assistant vazio; `max_tokens` gera aviso); `tests/unit/session/commands.test.ts` (`/help`, `/clear` em `idle` e rejeitado em `generating`, desconhecido); `tests/unit/ui/InputPrompt.test.tsx` com `ink-testing-library` (Enter envia, vazio ignorado)

**Checkpoint**: US1 funcional de ponta a ponta com Claude. `maestro` conversa, mantém contexto, cancela e sai.

---

## Phase 4: User Story 2 – Configurar e ativar múltiplos provedores de modelo (Priority: P2)

**Goal**: Provedor Qwen (DashScope) funcional; `/model` mostra e troca provedor preservando histórico; `--provider` e pré‑voo com alternativa; primeira execução orienta o preenchimento.

**Independent Test**: Com os dois provedores configurados, `/model` lista ambos; `/model qwen` → próxima resposta vem do Qwen; `/model claude` volta; reiniciar respeita `activeProvider` do arquivo. Com `DASHSCOPE_API_KEY=invalida`, erro de autenticação sem encerrar. Com Qwen ativo e sem chave, o Maestro informa o que falta e oferece o Claude.

### Implementation for User Story 2

- [x] T036 [US2] Implementar provedor Qwen (texto) em `src/providers/qwen.ts`: `createQwenProvider(settings)` com `new OpenAI({ apiKey, baseURL })`; `status()` (`missing: ["apiKey"]` sem chave; `credentialSource` env > config); `stream()` com `client.chat.completions.create({ model, max_tokens, messages: [system, ...], stream: true, stream_options: { include_usage: true } }, { signal })`; `text_delta` de `choices[0].delta.content`; `finish_reason` `stop`→`end_turn`, `length`→`max_tokens`, `content_filter`→`refusal`; `usage` do último chunk; mapear `OpenAI.AuthenticationError`→`auth` (hint `"Qwen API key missing or invalid. Set DASHSCOPE_API_KEY or providers.qwen.apiKey in settings.json."`), `APIConnectionError`→`network`, `RateLimitError`→`rate_limit`, 400 com "context length"/"maximum context"→`context_length`, `APIError`→`provider`
- [x] T037 [US2] Registrar `qwen: createQwenProvider` em `src/providers/registry.ts` e completar `listStatuses` com `displayName` (`"Claude (Anthropic)"`, `"Qwen (Alibaba Cloud)"`), `credentialSource`, `maskedKey`
- [x] T038 [US2] Implementar `/model` em `src/session/commands.ts`: sem args → tabela (id, estado `active`/`ready`/`not configured`/`disabled`, modelo, origem da credencial, chave mascarada); `/model <id>` → valida id (desconhecido, `disabled`, `not configured` com `missing`), chama `session.switchProvider(id)` criando o provedor via `createProvider`, confirma em tela; `/model <id> <modelo>` → também sobrescreve modelo da sessão; rejeitado se `state !== "idle"`
- [x] T039 [US2] Implementar pré‑voo completo em `src/cli/preflight.ts`: se ativo não configurado → imprime `missing` + hint; se há alternativo configurado → em modo interativo pergunta `Use <id> instead? [Y/n]` (via `prompts`‑like simples com readline) e em `-p` usa com aviso em stderr; senão exit 3; usar em `src/index.ts` no lugar do pré‑voo básico de T020
- [x] T040 [US2] Implementar mensagem de primeira execução em `src/cli/firstRun.ts` (caminho criado, tabela de estados dos provedores, instrução `ant auth login`/`ANTHROPIC_API_KEY` e `DASHSCOPE_API_KEY`) e chamar a partir de `src/index.ts` quando `created: true`
- [x] T041 [US2] Aplicar overrides de sessão (`--provider`, `--model`, `MAESTRO_PROVIDER`) ao `activeProviderId` e modelo inicial da `Session` em `src/cli/interactive.ts` e em `src/index.ts` sem gravar no arquivo
- [x] T042 [US2] Atualizar `src/ui/components/Header.tsx` e `src/ui/components/StatusBar.tsx` para refletir troca de provedor/modelo em tempo real (via `useSession`) e exibir aviso quando o novo provedor rejeitar o histórico por tamanho (`context_length`)
- [x] T043 [P] [US2] Testes: `tests/unit/providers/qwen.test.ts` com `openai` mockado (ordem de eventos, cancelamento, `include_usage`, mapeamento de erros, `status()`); `tests/unit/providers/registry.test.ts` (estados `active`/`ready`/`not configured`/`disabled`; `credentialSource` env > config; `maskedKey`); `tests/unit/session/commands.model.test.ts` (tabela, troca válida preserva histórico, id desconhecido, desativado, não configurado, rejeitado em `generating`); `tests/contract/provider-interface.test.ts` (garantias 1–4 de contracts/provider-interface.md § 2 para `claude` mockado, `qwen` mockado e `fake`); `tests/unit/cli/preflight.test.ts` (ativo não configurado com e sem alternativa; códigos 0/3)

**Checkpoint**: US1 e US2 funcionam; troca de provedor em sessão e por `--provider`.

---

## Phase 5: User Story 3 – Dar contexto do projeto ao modelo (Priority: P3)

**Goal**: Modelo pode ler arquivos e listar diretórios dentro de `cwd`; escrita de arquivo e execução de comando exigem confirmação com prévia; caminhos fora de `cwd` são negados.

**Independent Test**: Em um projeto com arquivos, "resuma o arquivo X" cita conteúdo real; "crie hello.txt com olá" abre diálogo de confirmação; `n` → arquivo não existe; `y` → arquivo criado; pedir leitura de `../fora.txt` → acesso negado e aviso na UI.

### Implementation for User Story 3

- [x] T044 [P] [US3] Implementar `resolveInsideCwd(cwd, inputPath)` em `src/tools/sandbox.ts`: `path.resolve`, rejeita se não começa com `cwd + path.sep` (e `!== cwd`), resolve `fs.realpath` quando existir e revalida (symlink fora → nega); retorna caminho absoluto ou lança `SandboxError`
- [x] T045 [P] [US3] Implementar ferramenta `read_file` (`{ path, offset?, limit? }`, lê UTF‑8, numera linhas, trunca em `maxOutputChars`, `requiresConfirmation: false`) em `src/tools/readFile.ts`
- [x] T046 [P] [US3] Implementar ferramenta `list_directory` (`{ path = "." , recursive? = false }`, lista nomes com `/` em diretórios, ignora `node_modules` e `.git`, `requiresConfirmation: false`) em `src/tools/listDirectory.ts`
- [x] T047 [P] [US3] Implementar ferramenta `write_file` (`{ path, content }`, `requiresConfirmation: true`, `preview` gera diff unificado com `diff.createPatch` contra o conteúdo atual ou "new file" , cria diretórios pais, grava UTF‑8) em `src/tools/writeFile.ts`
- [x] T048 [P] [US3] Implementar ferramenta `run_command` (`{ command, cwd? }`, `requiresConfirmation: true`, `preview` mostra o comando e o cwd, `spawn` com `cmd.exe /c` no Windows e `/bin/sh -c` nos demais, `commandTimeoutMs`, captura stdout+stderr truncados em `maxOutputChars`, `isError` quando exit ≠ 0, respeita `signal`) em `src/tools/runCommand.ts`
- [x] T049 [US3] Implementar `src/tools/registry.ts` (`allTools()`, `getTool(name)`, `toolsFor(settings)` que retorna `[]` quando `tools.enabled` é falso)
- [x] T050 [US3] Adicionar conversão de ferramentas ao provedor Claude em `src/providers/claude.ts`: `ToolDefinition` → `{ name, description, input_schema: zodToJsonSchema(...), strict: true }`; `Message(assistant, [text, tool_call])` → blocos `text` + `tool_use`; `Message(tool, results)` → **uma** mensagem `user` com todos os `tool_result` (`is_error`); acumular `input_json_delta` por índice e emitir `tool_call` com input parseado no `content_block_stop`; `stop_reason tool_use` → `done tool_use`
- [x] T051 [US3] Adicionar conversão de ferramentas ao provedor Qwen em `src/providers/qwen.ts`: `ToolDefinition` → `{ type: "function", function: { name, description, parameters } }`; assistant com `tool_calls` (`arguments: JSON.stringify(input)`); **uma** mensagem `{ role: "tool", tool_call_id, content }` por resultado (erro prefixado `"ERROR: "`); acumular `delta.tool_calls[i].function.arguments` por índice e emitir `tool_call` após `JSON.parse` quando `finish_reason === "tool_calls"` → `done tool_use`
- [x] T052 [US3] Implementar loop de ferramentas em `src/session/turn.ts` conforme contracts/provider-interface.md § 3: em `done tool_use` → `pushAssistant(text + tool_calls)`; para cada `tool_call` validar input com `inputSchema` (falha → `tool_result isError`), se `requiresConfirmation` → estado `awaiting_confirmation` com `PendingToolAction` (`previewText`) e aguardar `resolve(approved)`; executar ou registrar `"user declined"`; `pushToolResults`; repetir; máximo 10 iterações → aviso e fim
- [x] T053 [US3] Criar `src/ui/components/ConfirmationDialog.tsx` (nome da ferramenta, `previewText` com rolagem/truncamento, `[y] approve  [n] decline`) e ligar `y`/`n` em `src/ui/hooks/useKeyboard.ts` e exibição condicional em `src/ui/App.tsx` quando `state === "awaiting_confirmation"`
- [x] T054 [US3] Ligar `toolsFor(settings)` a `runTurn` em `src/ui/App.tsx` e `src/cli/interactive.ts`, respeitando `--no-tools` e `tools.enabled`
- [x] T055 [P] [US3] Testes: `tests/unit/tools/sandbox.test.ts` (dentro, fora, `..`, symlink para fora, raiz = cwd); `tests/unit/tools/readFile.test.ts`, `listDirectory.test.ts`, `writeFile.test.ts` (preview com diff; grava só no `run`), `runCommand.test.ts` (exit ≠ 0 → isError; timeout; truncamento) usando diretório temporário; `tests/integration/session/toolLoop.test.ts` com `fakeProvider` emitindo `tool_call` (aprovar executa e reenvia; recusar envia `isError`; input inválido vira `tool_result isError`; limite de 10 iterações); `tests/contract/conversion.test.ts` com snapshots da conversão `user → assistant(tool_call) → tool → assistant(text)` para os formatos Anthropic e OpenAI

**Checkpoint**: US1–US3 funcionam; nenhuma escrita ou comando acontece sem `y`.

---

## Phase 6: User Story 4 – Uso não interativo (Priority: P4)

**Goal**: `maestro -p "<prompt>"` (ou stdin com `-`) imprime a resposta em stdout e encerra com código adequado.

**Independent Test**: `maestro -p "diga olá"` imprime resposta e retorna 0; com chave inválida retorna 1 e mensagem em stderr; `echo oi | maestro -p -` funciona; Ctrl+C retorna 130.

### Implementation for User Story 4

- [x] T056 [US4] Implementar `runNonInteractive({ settings, provider, prompt, tools })` em `src/cli/nonInteractive.ts`: lê stdin quando `prompt === "-"`; `runTurn` com `onDelta` escrevendo em stdout (sem ANSI quando não há TTY), progresso de ferramentas e erros em stderr; confirmações negadas automaticamente com `tool_result` `"confirmation required; not available in non-interactive mode"`; códigos 0/1; `SIGINT` → cancel e 130
- [x] T057 [US4] Ligar `runNonInteractive` em `src/index.ts` (substituindo o stub) e garantir que o pré‑voo em `-p` usa alternativa com aviso em stderr sem perguntar
- [x] T058 [P] [US4] Testes: `tests/integration/cli/nonInteractive.test.ts` com `fakeProvider` injetado (stdout contém só a resposta; erro → stderr + código 1; stdin `-`; confirmação negada automaticamente; `tools` desligadas com `--no-tools`)

**Checkpoint**: Todas as histórias funcionam de forma independente.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Observabilidade mínima, portabilidade, documentação e validação final.

- [x] T059 [P] Implementar `--debug` em `src/utils/logger.ts` (grava `~/.maestro/debug.log` com requisições/respostas resumidas, erros com `cause`, **chaves mascaradas** via `mask`) e ligar em provedores e `src/index.ts`
- [x] T060 [P] Garantir degradação sem cor/TTY em `src/ui/components/*.tsx` e `src/cli/nonInteractive.ts` (`NO_COLOR`, `--no-color`, `!isTTY`) com teste `tests/unit/utils/tty.test.ts`
- [x] T061 [P] Criar `README.md` na raiz a partir de `specs/001-maestro-cli-mvp/quickstart.md` (instalação, credenciais Claude via `ant auth login`/`ANTHROPIC_API_KEY`, Qwen via `DASHSCOPE_API_KEY`, comandos, roadmap para orquestração)
- [x] T062 Verificar portabilidade: rodar `npm test` e o quickstart no Windows (PowerShell e Windows Terminal) confirmando `run_command` com `cmd.exe`, caminhos `%USERPROFILE%\.maestro` e cores; registrar ajustes em `src/tools/runCommand.ts` / `src/config/paths.ts`
- [x] T063 Medir tempo até o prompt (`maestro` → UI visível) e, se > 2 s, carregar `@anthropic-ai/sdk` e `openai` com `import()` dinâmico dentro de `createProvider` em `src/providers/registry.ts`
- [x] T064 Auditar saída de segredos: grep nos testes por chaves em claro em stdout/stderr/log; adicionar `tests/unit/security/noSecrets.test.ts` que executa `/model`, erros de auth e `--debug` com chave fictícia e garante que só `****xxxx` aparece
- [ ] T065 Executar validação manual completa de `specs/001-maestro-cli-mvp/quickstart.md` § "Validação rápida das histórias" com provedores reais e registrar o resultado em `specs/001-maestro-cli-mvp/checklists/requirements.md` § Notes
- [x] T066 Limpeza final: `npm run lint && npm run format && npm test` verdes; remover stubs/TODOs; atualizar `CLAUDE.md` (seção Commands e Project Structure) com os comandos e a árvore reais

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências; T002–T005 em paralelo após T001; T006 depois de T001–T002.
- **Foundational (Phase 2)**: depende de Phase 1. BLOQUEIA todas as histórias. Ordem interna: T007–T010, T012, T014, T015 em paralelo → T011 → T013 → T016, T017, T018 → T019 → T020 → T021.
- **US1 (Phase 3)**: depende de Phase 2. T022 → T023 → T024 → T025 → T026; T027–T030 em paralelo (dependem só de T014/T018); T031 → T032 → T033 → T034; T035 ao final.
- **US2 (Phase 4)**: depende de Phase 2 e de T024/T026 (registro e comandos criados em US1). T036 → T037 → T038; T039–T042 após T037; T043 ao final.
- **US3 (Phase 5)**: depende de Phase 2 e de T023/T025 (provedor Claude e `runTurn`), e de T036 para T051. T044–T048 em paralelo → T049 → T050, T051 em paralelo → T052 → T053 → T054 → T055.
- **US4 (Phase 6)**: depende de Phase 2 e de T025 (`runTurn`) e T039 (pré‑voo). Pode ser feita **antes** de US3 (é barata e serve para testar provedores). T056 → T057 → T058.
- **Polish (Phase 7)**: depende das histórias desejadas concluídas; T059–T061 em paralelo.

### User Story Dependencies

- **US1 (P1)**: só Foundational. Entrega o MVP sozinha.
- **US2 (P2)**: Foundational + registro/comandos de US1. Testável isoladamente com o Qwen mockado.
- **US3 (P3)**: Foundational + `runTurn` e provedores de US1/US2. Testável isoladamente com `fakeProvider`.
- **US4 (P4)**: Foundational + `runTurn`. Independente de US2/US3 (ferramentas negadas automaticamente).

### Parallel Opportunities

- Phase 1: T002, T003, T004, T005.
- Phase 2: T007, T008, T009, T010, T012, T014, T015 (7 tarefas) e depois T021 junto com o início de US1.
- US1: T027, T028, T029, T030 (componentes de UI) enquanto T023–T026 avançam.
- US2: T039, T040, T041, T042 após T037.
- US3: T044, T045, T046, T047, T048 (5 ferramentas) e depois T050 ∥ T051.
- Polish: T059, T060, T061.
- Com dois desenvolvedores após Phase 2: A faz US1 → US3; B faz US2 → US4.

---

## Parallel Example: User Story 1

```bash
# Componentes de UI em paralelo (arquivos distintos, dependem só de types/session):
Task: "Criar src/ui/components/Header.tsx"
Task: "Criar src/ui/components/MessageList.tsx"
Task: "Criar src/ui/components/InputPrompt.tsx"
Task: "Criar src/ui/components/StatusBar.tsx"

# Enquanto isso, sequencialmente:
Task: "Implementar provedor Claude em src/providers/claude.ts"
Task: "Implementar runTurn em src/session/turn.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Implementar src/tools/sandbox.ts"
Task: "Implementar src/tools/readFile.ts"
Task: "Implementar src/tools/listDirectory.ts"
Task: "Implementar src/tools/writeFile.ts"
Task: "Implementar src/tools/runCommand.ts"
# depois, em paralelo:
Task: "Conversão de ferramentas em src/providers/claude.ts"
Task: "Conversão de ferramentas em src/providers/qwen.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001–T006).
2. Phase 2: Foundational (T007–T021).
3. Phase 3: US1 (T022–T035).
4. **PARAR e VALIDAR**: `maestro` conversa com Claude, mantém contexto, cancela, sai. Requer `ant auth login` ou `ANTHROPIC_API_KEY` na máquina (ver research.md R4).

### Incremental Delivery (ordem recomendada)

1. Setup + Foundational → base pronta (`exit 3` correto sem credenciais).
2. US1 → MVP demonstrável.
3. US2 → dois provedores e `/model`.
4. **US4** → modo `-p` (barato; facilita testar provedores em scripts). Adiantar antes de US3 é permitido pelas dependências.
5. US3 → ferramentas com confirmação.
6. Polish.

### Parallel Team Strategy

Após Phase 2: Dev A → US1 → US3; Dev B → US2 → US4; ambos → Polish.

---

## Notes

- Tarefas [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Nenhum teste automatizado faz rede; SDKs são mockados com `vi.mock` e a sessão usa `tests/helpers/fakeProvider.ts`.
- Provedor Claude: **não** enviar `thinking`; `fallbacks: "default"` exige `client.beta.messages` + beta `server-side-fallback-2026-07-01`.
- Chaves nunca em texto claro: toda exibição passa por `mask()` (T007); T064 audita.
- Commit após cada tarefa ou grupo lógico; parar em qualquer checkpoint para validar a história isoladamente.
