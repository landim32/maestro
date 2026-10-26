# Tasks: Provedor Codex (assinatura do ChatGPT pelo Codex CLI instalado)

**Input**: Design documents from `specs/012-codex-cli-provider/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios pela constituição (III. Testabilidade). Cada história traz testes unitários, de contrato e de integração. Nenhum teste chama o `codex` real; eles usam `tests/helpers/fakeCodex.ts`.

**Format**: `[ID] [P?] [Story] Description`. `[P]` marca tarefas que podem rodar em paralelo (arquivos diferentes, sem dependência pendente).

## Phase 1: Setup (refatoração compartilhada)

**Purpose**: deixar prontas para dois usuários as peças do `claude-code` que o `codex` reaproveita, sem mudar comportamento.

- [X] T001 Mover `spawnSpec` de `src/providers/claudeCode.ts` para `src/utils/process.ts` e exportá-lo. `claudeCode.ts` passa a importá-lo de lá. Comportamento idêntico.
- [X] T002 Em `src/utils/process.ts`, criar `locateCli(command, names, opts)`, que reúne a lógica de `locateClaudeCode`: comando explícito, depois cada nome em `names` no PATH. Reescrever `locateClaudeCode` como `locateCli(command, platform === 'win32' ? ['claude.exe', 'claude'] : ['claude'], opts)` e acrescentar `locateCodex(command, opts)` com `['codex.exe', 'codex']` no Windows e `['codex']` fora dele.
- [X] T003 Rodar `npx vitest run tests/unit/providers/claudeCode.test.ts tests/unit/setup/claudeCodeCli.test.ts` para confirmar que a refatoração não mudou nada.

---

## Phase 2: Foundational (bloqueia todas as histórias)

**Purpose**: o id `codex` existir em configuração, status e registro.

- [X] T004 Em `src/config/defaults.ts`, adicionar `DEFAULTS.codex = { model: 'gpt-6-luna', models: ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna'], effort: 'medium' }` e `INITIAL_SETTINGS.providers.codex`, com o `_comment` de `contracts/settings.md`, `enabled: false`, `model`, `models` e `effort`.
- [X] T005 Em `src/config/schema.ts`:
  - `PROVIDER_IDS = ['claude', 'qwen', 'claude-code', 'codex']`;
  - `codexProviderSchema` como `strictObject`, igual ao `claudeCodeProviderSchema` (`_comment`, `enabled` false, `model` não vazio, `models`, `effort`, `command` opcional e não vazio) e com os padrões de `DEFAULTS.codex`;
  - `providers.codex: codexProviderSchema.prefault({})`;
  - exportar o tipo `CodexProviderSettings`.
- [X] T006 Em `src/config/models.ts`, fazer o catálogo padrão de `codex` usar `DEFAULTS.codex.models`. Trocar o ternário por um mapa `{ claude, qwen, 'claude-code': claudeCode, codex }`.
- [X] T007 Em `src/config/loader.ts`, definir `credentials.codex = 'cli'` quando `providers.codex.enabled` e `locateCodex(command)` encontrar o executável. Senão, `'none'`.
- [X] T008 Em `src/providers/status.ts`, acrescentar `DISPLAY_NAMES.codex = 'Codex (assinatura do ChatGPT)'`, a nota de cobrança `'assinatura do ChatGPT pelo Codex'` e `CREDENTIAL_HINTS.codex` ("Codex não encontrado. Instale o Codex CLI, faça login nele (`codex login`) e use /auth → Codex (ou defina providers.codex.command)."). Fazer o `describeProvider` tratar `codex` como `claude-code`: fonte `cli` e sem chave.
- [X] T009 [P] Atualizar `tests/contract/config-schema.test.ts` e `tests/unit/config/loader.test.ts` com os padrões de `providers.codex`, a validação de chave desconhecida e de `command` vazio, e `credentials.codex` com e sem executável (`locate` injetado ou PATH falso).

**Checkpoint**: `npm run typecheck` verde. O provedor ainda não está registrado.

---

## Phase 3: User Story 1 — Conversar pela assinatura (Priority: P1) 🎯 MVP

**Goal**: com o Codex logado, enviar uma mensagem e receber a resposta marcada `codex`, com uso de tokens, modelo trocável, histórico entre provedores, rotas e Esc.

**Independent Test**: com o `fakeCodex` emitindo o JSONL de `contracts/codex-events.md`, `runTurn` pelo provedor `codex` devolve o texto, o uso de tokens e `end_turn`. O Esc encerra o processo falso.

### Tests for User Story 1

- [X] T010 [P] [US1] Criar `tests/helpers/fakeCodex.ts`, no molde de `tests/helpers/fakeClaudeCode.ts`. É um `spawn` falso que:
  - grava `args`, `env` e o stdin recebido;
  - emite linhas JSONL roteirizadas (`thread.started`, `turn.started`, `item.completed` com `agent_message`, `turn.completed` com usage, ou `turn.failed`/`error`);
  - tem código de saída e stderr configuráveis;
  - opcionalmente chama a ponte MCP de verdade, por HTTP em 127.0.0.1, usando a URL do `-c mcp_servers.maestro.url=` e o token de `env.MAESTRO_MCP_TOKEN`;
  - sabe esperar o abort.
- [X] T011 [P] [US1] Criar `tests/unit/providers/codexStream.test.ts`, cobrindo cada linha da tabela de `contracts/codex-events.md`:
  - blocos separados por `\n\n`;
  - `outputTokens = output + reasoning`;
  - avisos `item.type=error` não fatais;
  - o primeiro `failure` vence;
  - linhas inválidas ignoradas;
  - `buildPrompt` com e sem histórico;
  - `parseVersion` (`codex-cli 0.161.0`, lixo) e a comparação com `MIN_CODEX_VERSION`.
- [X] T012 [P] [US1] Criar `tests/contract/codex-invocation.test.ts`, que fixa as cinco invariantes de `contracts/codex-invocation.md`:
  - token ausente dos args;
  - nenhum valor de `-c` com aspas;
  - `read-only` e `approval_policy=never` sempre presentes, e nenhum `danger*`/`--full-auto`;
  - sem ferramentas, nenhum `mcp_servers.*`;
  - último argumento `-`.

  Também fixa a lista `CODEX_DISABLED_FEATURES`, a ordem dos argumentos e `childEnvCodex`, que remove `OPENAI_API_KEY`/`CODEX_API_KEY`/`OPENAI_BASE_URL` e só define `MAESTRO_MCP_TOKEN` quando há ponte.
- [X] T013 [P] [US1] Criar `tests/integration/providers/codex.test.ts` (parte US1), cobrindo:
  - texto, uso de tokens e `done` com o `fakeCodex`;
  - `-m`/`model_reasoning_effort` vindos de `req.model`/`overrides.effort` e de `settings.providers.codex`;
  - histórico de outro provedor no stdin (`<conversation_history>`);
  - imagem da última mensagem gravada na pasta temporária e passada por `-i`;
  - Esc, que chama `killTree` (com `platform: 'linux'`) e devolve `done: cancelled`;
  - pasta temporária apagada no fim;
  - versão menor que a mínima, que devolve `invalid_config` sem chamar o `exec`;
  - executável ausente, que devolve `invalid_config` com a dica.

### Implementation for User Story 1

- [X] T014 [US1] Criar `src/providers/codexStream.ts` (puro), com:
  - `MIN_CODEX_VERSION = '0.161.0'`, `CODEX_DISABLED_FEATURES`, `STRIPPED_ENV_CODEX` e `MCP_TOKEN_ENV = 'MAESTRO_MCP_TOKEN'`;
  - `buildCodexArgs({ cwd, model, effort, instructionsFile, images, mcpUrl })`, conforme `contracts/codex-invocation.md`;
  - `childEnvCodex(env, token?)`;
  - `buildPrompt(messages)`, que reaproveita `renderHistory` de `claudeCodeStream.ts`;
  - `newCodexParserState()` e `parseCodexLine(line, st)`;
  - `codexUsage(st)`, `parseVersion(stdout)` e `versionAtLeast(v, min)`.
- [X] T015 [US1] Criar `src/providers/codex.ts` com `createCodexProvider(ctx, deps)`, no molde de `claudeCode.ts`.
  - **Deps injetáveis**: `spawn`, `locate`, `readVersion`, `startBridge`, `tmpDir`, `platform` e `log`.
  - **Capacidades**: `capabilities: { images: true, executesTools: true }`.
  - **Antes do turno**: a versão é verificada uma vez por instância, e uma versão antiga devolve `invalid_config` com "atualize o Codex: npm install -g @openai/codex".
  - **Pasta temporária `maestro-codex-*`**: recebe `instructions.md` (0600) com `req.system` e as imagens da última mensagem.
  - **Processo**: `spawnSpec`, prompt pelo stdin, stdout lido por `readline` e `parseCodexLine`.
  - **No Esc**: `killTree`.
  - **Fim do processo**: segue a ordem de `contracts/codex-events.md`, e o stderr passa por `redact`.
  - **`finally`**: mata o processo, fecha a ponte e apaga a pasta.
  - **Log**: `codex.start` (modelo, número de ferramentas), `codex.exit` (código, cancelado, concluído, número de avisos) e `codex.version`, sem conteúdo.
- [X] T016 [US1] Em `src/providers/index.ts`, chamar `registerProvider('codex', (ctx) => createCodexProvider(ctx))`.
- [X] T017 [US1] Confirmar em `tests/integration/ui/routes.test.tsx` e `tests/unit/routes/catalog.test.ts` que uma rota com `provider: 'codex'` resolve e que `/model codex <modelo>` é aceito. Ajustar as listas de provedores esperadas nesses testes, se houver.

**Checkpoint**: conversa pelo Codex falso funcionando de ponta a ponta. Esta é a MVP.

---

## Phase 4: User Story 2 — Ferramentas do Maestro pelo Codex (Priority: P1)

**Goal**: o modelo do Codex usa só as ferramentas do Maestro, pela ponte MCP, com a mesma política de aprovação.

**Independent Test**: o `fakeCodex` chama `write_file` pela ponte. No modo `default` aparece o pedido de confirmação, e uma recusa volta como erro. `read_file` roda sem confirmação. Um `run_command` de `.specify/scripts/` é interceptado. `ask_user` chega ao `ToolContext.ask`.

### Tests for User Story 2

- [X] T018 [P] [US2] Em `tests/integration/providers/codex.test.ts`, acrescentar a parte US2, que usa o `runTurn` real com `fakeCodex` mais a ponte real e cobre:
  - a escrita que pede confirmação e é recusada (o arquivo não existe, `tool_result.isError`);
  - a leitura automática;
  - a leitura fora da pasta recusada;
  - a interceptação do Spec Kit;
  - `ask_user`;
  - `tool_call`/`tool_result` no histórico (ids `mcp_<uuid>`);
  - `--no-tools` com só `ask_user`;
  - o turno sem ferramentas e sem `runTool`, que não passa nenhum `mcp_servers.*`.
- [X] T019 [P] [US2] Em `tests/integration/autopilot/run.test.ts`, criar um caso que roda um passo do autopiloto com a rota apontando para `codex` (`fakeCodex` roteirizado). Se o harness atual não aceitar troca de provedor por rota, documentar como cobertura manual em `quickstart.md` §4.

### Implementation for User Story 2

- [X] T020 [US2] Em `src/providers/codex.ts`, subir a ponte (`startMcpBridge({ tools: req.tools, runTool: req.runTool })`) quando houver ferramentas e `runTool`. Passar `mcpUrl` ao `buildCodexArgs` e o token só pelo ambiente (`childEnvCodex(env, bridge.token)`). Fechar a ponte no `finally`.
- [X] T021 [US2] Em `src/providers/codex.ts`, garantir que um pedido de ferramenta depois do abort não executa nada (o `runTool` do turno já devolve "cancelado") e que o turno cancelado mata o processo antes de fechar a ponte.

**Checkpoint**: Spec Kit e autopiloto utilizáveis com `codex`.

---

## Phase 5: User Story 3 — Limite de uso, `/auth` e avisos (Priority: P2)

**Goal**: `/auth` → Codex habilita o provedor sem tocar em credenciais. O limite de uso espera e reenvia. Os textos indicam que o provedor usa a assinatura do ChatGPT.

**Independent Test**: no diálogo `/auth` com um `codexCli` falso, os casos "ChatGPT", "chave de API", "não logado", "não instalado" e "versão antiga" mostram as mensagens corretas, e só o primeiro e o segundo habilitam o provedor. Um `turn.failed` com 429 seguido de sucesso produz uma espera e o texto final.

### Tests for User Story 3

- [X] T022 [P] [US3] Em `tests/unit/providers/codexStream.test.ts`, acrescentar os casos de `codexError`, linha a linha da tabela de `contracts/codex-events.md`:
  - JSON embutido com `status` e `code`;
  - `model_not_found` com a mensagem interna;
  - 401/"Not logged in" para `auth` com a dica;
  - 429/`usage_limit_reached`/"usage limit" para `rate_limit`, com `retryAfterMs` vindo de "try again in 30s" e de "try again at <data>" (com `now` fixo), e sem `retryAfterMs` quando não houver tempo;
  - o texto sempre redigido.
- [X] T023 [P] [US3] Criar `tests/unit/setup/codexCli.test.ts`: `parseLoginStatus` para "Logged in using ChatGPT" (`chatgpt`), "Logged in using an API key - sk-…" (`api-key`, sem nenhum trecho da chave no resultado), "Logged in using access token" (`other`) e "Not logged in". Também `readVersion` e `readLoginStatus` com `execFile` falso, com `shell` só para `.cmd` no Windows.
- [X] T024 [P] [US3] Em `tests/integration/ui/dialogs.auth.test.tsx`, acrescentar os casos de `/auth codex`: ChatGPT (habilita e oferece ativar), chave de API (habilita com aviso), não logado (instrução `codex login`, nada gravado), não instalado (dicas, tentar de novo) e versão antiga (aviso de atualização). Em todos, conferir que `codex login` nunca é executado.
- [X] T025 [P] [US3] Em `tests/integration/providers/codex.test.ts`, acrescentar a parte US3: com `runTurn`, `sleep` injetado e um `fakeCodex` que primeiro emite `turn.failed` 429 com "try again in 30s" e depois sucesso, conferir as esperas `[30000]`, o aviso "limite de taxa do provedor" e o texto final.
- [X] T026 [P] [US3] Criar `tests/unit/security/noSecrets.codex.test.ts`, no molde de `noSecrets.claudeCode.test.ts`, verificando que:
  - `OPENAI_API_KEY` no ambiente do Maestro não chega ao filho;
  - o token da ponte não aparece nos args nem no log;
  - a saída de "Logged in using an API key - sk-…" não chega à tela nem ao log;
  - o log de `codex.*` não tem prompt nem resposta.

### Implementation for User Story 3

- [X] T027 [US3] Em `src/providers/codexStream.ts`, implementar `codexError(message, now)` conforme a tabela de `contracts/codex-events.md`: extração do JSON embutido, as categorias, a dica de login e `retryAfterMs` de "try again in N s/ms/seconds" ou "try again at <data>" mais 5 s. Usar `MaestroError` e `redact`.
- [X] T028 [US3] Criar `src/setup/codexCli.ts` com:
  - a interface `CodexCli { locate, readVersion, readLoginStatus }`;
  - `CODEX_INSTALL_HINTS` (`npm install -g @openai/codex`, `codex login`, `providers.codex.command`);
  - `parseLoginStatus(stdout)`, que devolve `{ loggedIn, method: 'chatgpt' | 'api-key' | 'other' }` e descarta o resto da linha;
  - `createCodexCli({ execFile, env, platform })`, com timeout de 30 s e `shell` só para `.cmd`/`.bat`.
- [X] T029 [US3] Em `src/setup/methods.ts`:
  - `MethodId` ganha `'codex'`;
  - o método `codex` é `kind: 'login'` e `providerId: 'codex'`, com o rótulo "Codex" e a descrição "usa a assinatura do ChatGPT pelo Codex instalado (sem chave de API)";
  - os mesmos tratamentos que o `claude-code` recebe na linha ~187, os passos `login.*` sem iniciar login.
- [X] T030 [US3] Em `src/setup/driver.ts`:
  - `SetupDeps.codex: CodexCli`, com padrão `createCodexCli`;
  - em `login.detect`, `locate(settings.providers.codex.command)`;
  - em `login.running`, `checkCodex()`. Ele lê a versão (se for antiga, erro de atualização), depois `readLoginStatus`:
    - não logado: erro com "rode `codex login` num terminal";
    - `api-key`: sucesso com o aviso "consome créditos da API da OpenAI";
    - `chatgpt`: sucesso com "conta do ChatGPT".
  - em sucesso, `writeSettings([{ path: 'providers.codex.enabled', value: true }])` e a oferta de ativar, como no `checkClaudeCode`.
- [X] T031 [US3] Em `src/ui/dialogs/AuthDialog.tsx`, tratar o método `codex` como o `claude-code` (o predicado `cc` vira "método de CLI": `claude-code` ou `codex`). Mostrar a versão, o método e as dicas de `CODEX_INSTALL_HINTS`.
- [X] T032 [US3] Em `src/session/commands.ts`, `METHOD_IDS` ganha `'codex'` e o uso passa a ser `/auth [claude-api|claude-login|claude-code|codex|qwen]`. Conferir que `/model` e `/help` listam `codex` (derivado de `PROVIDER_IDS`) e ajustar textos fixos, se houver.
- [X] T033 [US3] Em `src/ui/dialogs/ModelDialog.tsx`, o grupo `codex` mostra a nota de cobrança "assinatura" (`BILLING_NOTES`/`status.ts` da T008).

**Checkpoint**: as três histórias funcionando de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T034 [P] Em `README.md`, criar a seção "Codex (assinatura do ChatGPT)" com:
  - instalação e `codex login`;
  - `/auth codex`, `/model codex`;
  - modelos padrão e esforço;
  - a cobrança pela assinatura, o aviso sobre login por chave de API e a versão mínima 0.161.0;
  - as limitações: texto em blocos, `maxTokens` ignorado, ferramentas próprias do Codex desligadas.

  Acrescentar `providers.codex` ao exemplo de `settings.json`.
- [X] T035 [P] Em `CLAUDE.md`, criar o parágrafo "**Codex provider (specs/012).**", logo depois do parágrafo do Claude Code provider, com:
  - `codex exec --json`;
  - as flags de isolamento e `CODEX_DISABLED_FEATURES`;
  - o token por `MAESTRO_MCP_TOKEN`;
  - `default_tools_approval_mode=approve`;
  - os valores de `-c` sem aspas;
  - `fakeCodex`.

  Atualizar a estrutura de `providers/` e trocar "— planned" em Recent Changes.
- [X] T036 Rodar `npm run typecheck`, `npm run lint`, `npx prettier --check --end-of-line auto` nos arquivos alterados, `npm test` e `npm run build`.
- [ ] T037 Executar `quickstart.md` §1 a §3 e §6 com o Codex real (0.161.0, login ChatGPT), por `node dist/index.js`. Registrar o resultado aqui.
  - **2026-10-26, `-p` com o Codex real (feito):**
    - leitura por `read_file` funcionou;
    - escrita: `auto-edit` grava, e `default` é recusada pelo Maestro;
    - `run_command` no modo `auto` funcionou;
    - leitura fora da pasta foi bloqueada;
    - pedido para usar o shell próprio: o `exec` do code mode é um sandbox JS sem fs, e nada foi criado;
    - `debug.log` sem conteúdo.
  - **Dois achados corrigidos durante o teste:** a busca do executável pegava o shim POSIX `codex` no Windows (R7), e o modelo achava que o sandbox era somente leitura e não chamava `write_file` (R5.1).
  - **Falta (sessão interativa):** `/auth codex` no diálogo real, Esc no meio de um turno e a lista de processos sem o token.
- [ ] T038 Executar `quickstart.md` §4 (Spec Kit pelo `codex`) e §5 (erros) manualmente.
  - **2026-10-26 (feito):**
    - `/speckit.specify` pelo Codex real (`-p --approval-mode auto-edit`, repositório temporário): a branch `001-greet-name` foi criada pelo passo nativo, e `spec.md` e o checklist foram gravados em 23 s;
    - modelo inválido: "The 'gpt-inexistente' model is not supported when using Codex with a ChatGPT account.", sem JSON bruto.
  - **Falta:** `codex logout`/não logado (não executado para não deslogar o usuário) e o autopiloto pelo `codex`.

---

## Dependencies & Execution Order

- **Setup (T001–T003)**: sem dependências.
- **Foundational (T004–T009)**: depende do Setup. Bloqueia todas as histórias.
- **US1 (T010–T017)**: depende da Foundational. É a MVP.
- **US2 (T018–T021)**: depende de T014–T015, porque estende `codex.ts`.
- **US3 (T022–T033)**: T027 depende de T014. T028–T033 dependem só da Foundational e podem andar em paralelo com a US1.
- **Polish (T034–T038)**: depois das histórias desejadas.

### Within Each User Story

Os testes vêm antes e devem falhar. Depois vêm os módulos puros (`codexStream.ts`), o provedor (`codex.ts`) e a integração (registro, `/auth`, UI).

### Parallel Opportunities

- T009 em paralelo com T006–T008, porque os arquivos são diferentes.
- US1: T010, T011, T012 e T013 juntos.
- US3: T022, T023, T024, T025 e T026 juntos. T028 em paralelo com T014/T015.
- Polish: T034 e T035 juntos.

## Parallel Example: User Story 1

```text
Task: "Criar tests/helpers/fakeCodex.ts"
Task: "Criar tests/unit/providers/codexStream.test.ts"
Task: "Criar tests/contract/codex-invocation.test.ts"
Task: "Criar tests/integration/providers/codex.test.ts (US1)"
```

## Implementation Strategy

1. **MVP**: Setup, Foundational e US1. Já dá para conversar pelo Codex com `providers.codex.enabled: true` editado à mão.
2. **US2**: ferramentas e Spec Kit, o que torna o provedor útil para o desenvolvimento.
3. **US3**: `/auth`, limite de uso e textos.
4. **Polish**: documentação, verificação completa e quickstart manual.
