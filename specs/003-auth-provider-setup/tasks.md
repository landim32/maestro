---

description: "Task list for Configuração de Provedores pela Sessão (/auth) e Seleção de Modelo (/model)"
---

# Tasks: Configuração de Provedores pela Sessão (/auth) e Seleção de Modelo (/model)

**Input**: Design documents from `/specs/003-auth-provider-setup/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (commands.md, dialog-flows.md, settings-writer.md), quickstart.md

**Tests**: O plano define a estratégia (research R9 e § "Testes de contrato/derivados" dos contratos): reducers testados sem UI, efeitos mockados (SDKs e processo `ant`), integração com `renderSized`/`mountApp` e `MAESTRO_HOME` temporário. As tarefas de teste abaixo implementam exatamente esses casos. Nenhum teste acessa rede nem executa o `ant` real.

**Organization**: Tarefas por história de usuário. Nenhuma dependência nova de runtime.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: História a que a tarefa pertence (US1, US2, US3)
- Caminhos exatos em cada descrição

## Path Conventions

Projeto único: `src/` e `tests/` na raiz, conforme plan.md § Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Utilitários de processo e helpers de teste compartilhados.

- [x] T001 Mover `killTree` de `src/tools/runCommand.ts` para `src/utils/process.ts` e adicionar `findExecutable(name, extraDirs?)` (percorre `PATH` com `path.delimiter`, considera `PATHEXT` no Windows, aceita diretórios extras; devolve caminho absoluto ou `undefined`); atualizar o import em `runCommand.ts`
- [x] T002 [P] Criar helper `withTempHome()` em `tests/helpers/tempHome.ts` que cria um diretório temporário, grava um `settings.json` opcional e devolve `{ home, globalPath, env, cleanup }` para testes que gravam configuração
- [x] T003 [P] Criar helper `fakeAntCli(script)` em `tests/helpers/fakeAnt.ts` que simula `AntCli` (research R2): `locate()` configurável (encontrado/ausente), `runLogin()` emitindo saídas/URL e terminando com sucesso, falha ou cancelamento sob controle do teste, `readStatus()` com `loggedIn` configurável
- [x] T004 [P] Teste `tests/unit/utils/process.test.ts`: `findExecutable` encontra binário em diretório do `PATH` temporário (com e sem `.exe` via `PATHEXT`), em `extraDirs`, e devolve `undefined` quando ausente; `killTree` continua coberto por `tests/unit/tools/runCommand.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Writer de configuração, catálogo de métodos, estado de diálogo no controller e componentes base de diálogo. Bloqueia todas as histórias.

- [x] T005 Criar `src/config/writer.ts` conforme contracts/settings-writer.md: `readRawSettings`, `applyPatch` (caminhos `a.b.c`, cria intermediários, `undefined` remove), normalização (`apiKey` sem espaços/quebras, `baseUrl` sem barra final, strings vazias removidas), validação com `settingsSchema` antes de gravar, escrita atômica (`.tmp` + `rename`), `projectOverrides(paths, cwd)` e `writeSettings(patch, { globalPath, cwd })` devolvendo `{ path, overriddenByProject }`; erros → `MaestroError` (`invalid_config`) com caminho na mensagem e `hint`
- [x] T006 [P] Criar `src/setup/methods.ts` com `CONNECTION_METHODS` (data-model § 1: `claude-api`, `claude-login`, `qwen`, com `FieldSpec[]` na ordem de contracts/dialog-flows.md § 3, padrões de `src/config/defaults.ts`, hint do endpoint internacional, validadores), `methodStatus(method, statuses)` → `not_configured | configured | active`, e `currentValues(method, settings)` para pré‑preenchimento
- [x] T007 [P] Adicionar `verified?: boolean` a `ProviderStatus` em `src/providers/types.ts` e propagar em `src/providers/status.ts` (`describeProvider` lê um conjunto `unverified` opcional do `ProviderContext`)
- [x] T008 Estender `src/session/controller.ts`: campo `dialog?: DialogState` (tipos em `src/setup/dialog.ts`: `{ type: 'auth'; flow } | { type: 'model'; flow }`), métodos `openDialog(state)` (recusa se `session.state !== 'idle'` ou já aberto), `closeDialog()`, `setDialog(state)`, `applySettings({ settings, credentialSources })` (substitui `ctx`, invalida provedor em cache, emite `change`), `markUnverified(providerId)`, getter `settingsPaths` (`globalPath`, `cwd`) recebido em `ControllerOptions`; `submit()` ignora texto enquanto `dialog` existir (aviso curto)
- [x] T009 Em `src/index.ts`, passar `settingsPaths: { globalPath: loaded.globalPath, cwd }` e `env: process.env` ao `SessionController`; em `tests/helpers/appHarness.tsx` e `tests/helpers/context.ts` aceitar `settingsPaths`/`env` opcionais
- [x] T010 [P] Criar `src/ui/dialogs/DialogFrame.tsx` (título, área de conteúdo com `flexGrow`, rodapé de teclas; `flexShrink={0}` no título/rodapé, `minHeight={0}` no conteúdo; variante sem cor) conforme contracts/dialog-flows.md § 1
- [x] T011 [P] Criar `src/ui/dialogs/SelectList.tsx` (itens `{ label, description?, status?, disabled? }`, índice selecionado, marcador `>`/invertido, itens desativados em cinza; componente puro — a navegação é feita pelo reducer)
- [x] T012 [P] Criar `src/ui/dialogs/TextField.tsx` (rótulo, valor, `secret` → exibe `•` por caractere ou `****` + 4 últimos quando `keepCurrent`, placeholder/hint, mensagem de erro em vermelho; `useInput` com `isActive`: caracteres, backspace, Ctrl+U limpa, Enter → `onSubmit`, Esc → `onBack`; colagem remove `\r\n` e espaços nas pontas)
- [x] T013 [P] Criar `src/ui/dialogs/ProgressView.tsx` (spinner textual `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` ou `-\|/` sem cor via `useAnimation`/intervalo de 100 ms, mensagem, URL opcional em destaque, dica `Esc cancelar`) e `src/ui/dialogs/ResultView.tsx` (título de sucesso/erro, lista de avisos, `SelectList` de ações)
- [x] T014 Atualizar `src/ui/hooks/useKeyboard.ts` com `dialogOpen: boolean` e `onDialogKey(event)`: quando aberto, ↑/↓/Enter/Esc/caracteres vão para `onDialogKey` (`up`, `down`, `enter`, `back`, `cancel`), Ctrl+C simples = `cancel`, Ctrl+C duplo continua saindo, teclas de rolagem ignoradas; `src/ui/App.tsx` passa `dialogOpen = Boolean(controller.dialog)`, torna `InputPrompt` inativo e renderiza `DialogHost` no lugar do `Transcript` quando há diálogo
- [x] T015 [P] Testes de fundação: `tests/unit/config/writer.test.ts` (todos os casos de contracts/settings-writer.md § 4, incluindo hash intacto após erro de validação e `rename` falhando); `tests/unit/setup/methods.test.ts` (ordem de campos por método, padrões, validadores, `methodStatus`, `currentValues` com chave mascarada); `tests/unit/session/controller.dialog.test.ts` (`openDialog` recusa fora de `idle` e quando já aberto; `submit` ignora texto com diálogo aberto; `applySettings` troca `ctx` e invalida provedor); `tests/unit/ui/dialogs/TextField.test.tsx` (mascaramento `•`, Ctrl+U, Enter/Esc, colagem limpa, frame nunca contém a chave)

**Checkpoint**: build e testes verdes; `controller.openDialog` funciona com um estado fictício e o `App` mostra a moldura vazia.

---

## Phase 3: User Story 1 – Conectar um provedor pelo diálogo `/auth` (Priority: P1) 🎯 MVP

**Goal**: `/auth` abre o menu; Claude API e Qwen percorrem campos → teste de conexão → gravação → ativação, tudo sem sair da sessão.

**Independent Test**: Com `MAESTRO_HOME` temporário, `/auth` → Qwen → chave válida (SDK mockado) → `Sim` → mensagem respondida pelo Qwen e `settings.json` com `providers.qwen.enabled = true` e `activeProvider = "qwen"`. Chave inválida → `Falha: chave rejeitada (401)` com `Corrigir chave de API`.

### Implementation for User Story 1

- [x] T016 [US1] Criar reducer puro `authFlowReducer(state, event)` e `initialAuthFlow(methods, statuses, preselect?)` em `src/setup/authFlow.ts` cobrindo todas as transições de data-model § 3 para os passos `menu`, `fields`, `testing`, `testFailed`, `saving`, `saveFailed`, `activate`, `done` (os passos `login.*` entram em US2 com transições que devolvem o estado inalterado nesta fase); exportar `effectsFor(state)` que indica o efeito pendente (`test`, `save`, `activate`, `none`)
- [x] T017 [P] [US1] Criar `src/setup/connectionTest.ts`: `testConnection(method, values, { timeoutMs = 10_000, signal })` → `ConnectionTestResult` (data-model § 5): Claude → `new Anthropic({ apiKey, baseURL }).models.retrieve(model, { timeout, signal })`; Qwen → `new OpenAI({ apiKey, baseURL }).chat.completions.create({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }, { timeout, signal })`; mapear erros com `mapAnthropicError`/`mapOpenAIError` → categoria e `field` (auth→apiKey, network/timeout→baseUrl, 404→model); mensagens de contracts/dialog-flows.md § 4; nunca lança
- [x] T018 [US1] Criar `src/setup/driver.ts`: `SetupDriver` que recebe `{ controller, testConnection, writeSettings, ant? }`, mantém o `AuthFlowState` em `controller.dialog`, aplica eventos via reducer e executa efeitos: `test` (com `AbortController` para Esc), `save` (patch `providers.<id>.{enabled:true, apiKey?, baseUrl?, model}`; se `verified=false` chama `controller.markUnverified`), `activate` (`controller.switchProvider` + patch `activeProvider`), avisos (`overriddenByProject`, variável de ambiente com precedência); após gravar chama `controller.applySettings` relendo via `loadSettings`
- [x] T019 [US1] Adicionar comandos em `src/session/commands.ts`: `/auth` (aliases `connect`, `login`, arg opcional `claude-api|claude-login|qwen` → pré‑seleção) que, se `ctl.interactive` for falso, emite a orientação textual de contracts/commands.md § 1 e, senão, abre o diálogo via `SetupDriver`; recusa com aviso fora de `idle`; atualizar descrições de `/help` (contracts/commands.md § 3)
- [x] T020 [US1] Criar `src/ui/dialogs/AuthDialog.tsx` mapeando cada `step` para componentes (`menu` → `SelectList` com estados; `fields` → `TextField` com rótulo/hint/pré‑preenchimento; `testing` → `ProgressView`; `testFailed`/`saveFailed` → `ResultView` com as três ações; `activate` → `ResultView` com avisos e `Sim`/`Não`; `done` → `ResultView` de sucesso) e `src/ui/dialogs/DialogHost.tsx` que escolhe `AuthDialog`/`ModelDialog` por `dialog.type` e encaminha `onDialogKey` → `driver.dispatch`
- [x] T021 [US1] Ligar no `src/ui/App.tsx`: instanciar `SetupDriver` (via `controller`), passar `onDialogKey`, exibir linha de confirmação na conversa ao concluir (`Conectado: qwen / qwen3-coder-plus`) usando `controller.notice`
- [x] T022 [P] [US1] Testes: `tests/unit/setup/authFlow.test.ts` (cada linha da tabela de transições de data-model § 3 para os passos não‑login, incluindo validação de campo, `back` no índice 0, `testFailed` → campo correto por categoria, `cancel` em cada passo); `tests/unit/setup/connectionTest.test.ts` com SDKs mockados (sucesso, 401 → `apiKey`, timeout → `baseUrl`, 404 → `model`, erro genérico sem campo, argumentos exatos das chamadas); `tests/unit/setup/driver.test.ts` (efeitos chamados na ordem, patch gravado, `applySettings`, `markUnverified` em "gravar sem testar", avisos)
- [x] T023 [P] [US1] Teste de integração `tests/integration/ui/dialogs.auth.test.tsx` com `mountApp` + `withTempHome` + `testConnection` injetado: `/auth` abre o menu e desativa o prompt (digitar não muda o frame do prompt); fluxo Qwen completo grava o arquivo e troca o provedor (próxima mensagem vai ao `qwen` fake); chave inválida mostra `Falha` e volta ao campo; Esc fecha em `menu`, volta campo em `fields`, cancela teste em `testing`; frame nunca contém a chave digitada; `/auth` em `generating` é recusado; `/connect` e `/login` abrem o mesmo diálogo; `-p "/auth"` imprime orientação (em `tests/integration/cli/nonInteractive.test.ts`)

**Checkpoint**: Qwen e Claude API configuráveis sem sair da sessão; US1 entrega valor sozinha.

---

## Phase 4: User Story 2 – Login na Anthropic pelo diálogo (Priority: P1)

**Goal**: "Claude Auth Login" detecta a CLI `ant`, executa o login com progresso e URL, confirma por `ant auth status`, trata ausência/falha/cancelamento.

**Independent Test**: Com `fakeAntCli` encontrado e sucesso → `Login concluído` → ativação → Claude `configured (perfil)`. Com `fakeAntCli` ausente → instruções + `Tentar novamente`. Esc durante `running` → processo cancelado, volta ao menu.

### Implementation for User Story 2

- [x] T024 [P] [US2] Criar `src/setup/installHints.ts`: `installHints(platform)` → linhas por SO (Windows: URL de releases + `windows_amd64.zip` + pasta sugerida `%LOCALAPPDATA%\Programs\ant`; macOS: `brew install anthropics/tap/ant`; Linux: `tar.gz` do release) conforme research R3
- [x] T025 [US2] Criar `src/setup/antCli.ts`: `locateAnt(env, platform)` usando `findExecutable('ant', [join(LOCALAPPDATA, 'Programs', 'ant')])`; `runLogin(antPath, { onOutput, signal })` → `LoginRun` com `spawn(antPath, ['auth', 'login', '--timeout', '5m'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })`, extração de `https://\S+` da saída para `url`, término por código (0 → ok), cancelamento via `killTree`; `readStatus(antPath)` executa `['auth', 'status']` e devolve `{ loggedIn: /Logged in to/.test(out), summary }`; `envShadowWarning(env)` quando `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` existir
- [x] T026 [US2] Completar `src/setup/authFlow.ts` com os passos `login.detect`, `login.missing`, `login.running`, `login.failed`, `login.done` e eventos `antDetected`, `loginOutput`, `loginExit` conforme data-model § 3; `effectsFor` passa a indicar `detectAnt`, `runLogin`, `cancelLogin`
- [x] T027 [US2] Estender `src/setup/driver.ts`: efeitos `detectAnt` (→ `antDetected` com `installHints`), `runLogin` (guarda `LoginRun`, encaminha `loginOutput`, ao terminar chama `readStatus` e emite `loginExit` com `ok = exit 0 && loggedIn`, `warnings` de `envShadowWarning`), `cancelLogin` (chama `cancel()` do `LoginRun`); após `login.done` recalcular `credentialSources` via `applySettings` (o Claude passa a `profile`) e seguir para `activate` sem gravar chave
- [x] T028 [US2] Estender `src/ui/dialogs/AuthDialog.tsx`: `login.detect` → `ProgressView`; `login.missing` → `ResultView` com instruções e ações `Tentar novamente`/`Voltar`; `login.running` → `ProgressView` com `Aguardando autorização no navegador…`, URL quando houver e `Esc cancelar`; `login.failed` → `ResultView` com causa; `login.done` → mensagem de sucesso antes de `activate`
- [x] T029 [P] [US2] Testes: `tests/unit/setup/antCli.test.ts` com `child_process.spawn` mockado (argumentos exatos `['auth','login','--timeout','5m']` e `['auth','status']`, `stdio` sem stdin, extração de URL, código ≠ 0 → `reason` = última linha não vazia, cancel → `killTree`, `readStatus` com e sem `Logged in to`, `locateAnt` via PATH e diretório padrão, `envShadowWarning`); `tests/unit/setup/installHints.test.ts` (três plataformas); `tests/unit/setup/authFlow.login.test.ts` (transições `login.*` e `cancel` em `running`)
- [x] T030 [P] [US2] Teste de integração `tests/integration/ui/dialogs.login.test.tsx` com `fakeAntCli`: ausente → instruções e `Tentar novamente` refaz a detecção; presente → `Aguardando autorização…`, URL exibida após `loginOutput`, sucesso → `Login concluído` → `Sim` ativa Claude com `credentialSource = 'profile'` (arquivo de credenciais criado pelo fake em `ANTHROPIC_CONFIG_DIR` temporário); falha → causa + `Tentar novamente`; Esc em `running` cancela (`cancel()` chamado) e volta ao menu; aviso de `ANTHROPIC_API_KEY` com precedência quando definida no `env`

**Checkpoint**: os três métodos do menu funcionam de ponta a ponta.

---

## Phase 5: User Story 3 – Selecionar o modelo ativo pelo diálogo `/model` (Priority: P2)

**Goal**: `/model` sem argumentos abre o seletor; seleção troca e grava; "Digitar outro modelo…"; forma textual preservada e também persistida.

**Independent Test**: Com Claude e Qwen configurados, `/model` lista os dois com o ativo marcado; selecionar o outro e enviar mensagem confirma a troca; reabrir confirma persistência; `/model qwen qwen-max` por texto funciona sem diálogo.

### Implementation for User Story 3

- [x] T031 [US3] Criar reducer `modelFlowReducer`/`initialModelFlow(statuses, activeModel)` em `src/setup/modelFlow.ts` (data-model § 4): itens a partir de `listStatuses` (+ item virtual `Digitar outro modelo…`), navegação pulando desativados, `enter` → `applying` ou `custom`, `custom` com validação não vazia, `applying` → `done`/`failed`
- [x] T032 [US3] Estender `src/setup/driver.ts` com `openModelDialog()` e efeito `apply` (`controller.switchProvider(id, model)` + `writeSettings([{ activeProvider }, { providers.<id>.model }])` + `applySettings`; falha → `failed`)
- [x] T033 [US3] Atualizar `/model` em `src/session/commands.ts`: sem argumentos e `ctl.interactive` → `driver.openModelDialog()`; sem argumentos em `-p` → tabela textual atual; com argumentos → comportamento atual **mais** gravação de `activeProvider` (e `providers.<id>.model` quando informado) via `writeSettings`, com aviso se a gravação falhar
- [x] T034 [US3] Criar `src/ui/dialogs/ModelDialog.tsx`: `list` → `SelectList` com `● / ○`, `provedor / modelo`, origem (`perfil`, `chave ****xxxx`, `ambiente`), `(ativo)`, desativados com `não configurado — configure com /auth`; `custom` → `TextField` `Modelo para <provedor>`; `applying` → `ProgressView`; `failed` → `ResultView`; registrar em `DialogHost`
- [x] T035 [P] [US3] Testes: `tests/unit/setup/modelFlow.test.ts` (itens, pulo de desativados, `custom`, `applying`/`done`/`failed`, `cancel`); `tests/unit/session/commands.model.test.ts` (+ `/model qwen` grava `activeProvider`; `/model qwen qwen-max` grava modelo; falha de gravação vira aviso e a troca em memória permanece)
- [x] T036 [P] [US3] Teste de integração `tests/integration/ui/dialogs.model.test.tsx` com `mountApp` + `withTempHome`: `/model` abre com o ativo marcado; ↓ + Enter troca para o outro provedor (próxima mensagem vai ao fake correto), cabeçalho reflete, arquivo contém `activeProvider`; item não configurado é pulado e mostra `configure com /auth`; `Digitar outro modelo…` → campo → Enter aplica `qwen-max`; Esc fecha sem mudar; `/model` em `generating` recusado

**Checkpoint**: todas as histórias funcionam de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Segurança, documentação, portabilidade e validação final.

- [x] T037 [P] Estender `tests/unit/security/noSecrets.test.ts`: percorrer o fluxo `/auth` Qwen com chave fictícia e garantir que nenhum frame, notice, `debug.log` ou `settings.json` em texto de log contém a chave em claro (apenas `••••`/`****wxyz`)
- [x] T038 [P] Teste de contrato `tests/contract/dialog-flows.test.ts`: ordem/rótulos/pré‑preenchimento dos campos por método (contracts/dialog-flows.md § 3), textos de estado do menu (§ 2), mensagens por categoria (§ 4), teclas do § 1 em cada passo (via reducer), argumentos exatos do `ant` (§ 6)
- [x] T039 [P] Atualizar `README.md` (seção Credenciais: "ou use `/auth` dentro do Maestro"; seção Uso: `/auth`, `/connect`, `/login`, seletor `/model`), `specs/003-auth-provider-setup/quickstart.md` se algo mudou, e `CLAUDE.md` (Project Structure com `src/setup/` e `src/ui/dialogs/`; Code Style: "fluxos de diálogo são reducers puros em `src/setup/`; efeitos só no `SetupDriver`; chaves só via `TextField secret`")
- [x] T040 Registrar eventos de setup no logger `--debug` em `src/setup/driver.ts` (`setup.open`, `setup.test`, `setup.save` com **caminhos**, nunca valores; `setup.login` com código de saída) e confirmar no teste de `noSecrets`
- [ ] T041 Verificar manualmente no Windows Terminal: `/auth` → Qwen com chave real (ou inválida) e `Claude Auth Login` com a CLI `ant` instalada nesta máquina; `/model` seletor; registrar em `specs/003-auth-provider-setup/checklists/requirements.md` § Notes
- [x] T042 Limpeza final: `npm run lint && npm run format && npm test` verdes; confirmar que as suítes das features 001 e 002 continuam passando (SC‑007); remover código morto da tabela textual de `/model` em `src/session/controller.ts` (`describeProviders`) se não for mais usada no modo interativo

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 primeiro; T002, T003, T004 em paralelo.
- **Foundational (Phase 2)**: depende de Phase 1. T005, T006, T007 em paralelo → T008 → T009; T010–T013 em paralelo (componentes); T014 após T010–T013; T015 ao final. BLOQUEIA as histórias.
- **US1 (Phase 3)**: depende de Phase 2. T016 e T017 em paralelo → T018 → T019 → T020 → T021; T022 e T023 em paralelo ao final.
- **US2 (Phase 4)**: depende de US1 (reducer, driver e `AuthDialog` existentes). T024 e T025 em paralelo → T026 → T027 → T028; T029 e T030 em paralelo ao final.
- **US3 (Phase 5)**: depende de Phase 2 e de T018 (`SetupDriver`), independente de US2. T031 → T032 → T033 → T034; T035 e T036 em paralelo.
- **Polish (Phase 6)**: depende das histórias concluídas; T037–T039 em paralelo; T040 → T041 → T042.

### User Story Dependencies

- **US1 (P1)**: só Foundational. Entrega Claude API e Qwen pelo diálogo.
- **US2 (P1)**: estende o fluxo de US1 com o ramo de login; precisa de US1.
- **US3 (P2)**: usa o `SetupDriver` de US1 (T018) mas não o ramo de login; pode rodar em paralelo com US2.

### Parallel Opportunities

- Phase 1: T002 ∥ T003 ∥ T004.
- Phase 2: T005 ∥ T006 ∥ T007; T010 ∥ T011 ∥ T012 ∥ T013.
- US1: T016 ∥ T017; T022 ∥ T023.
- US2 ∥ US3 após T018.
- US2: T024 ∥ T025; T029 ∥ T030.
- US3: T035 ∥ T036.
- Polish: T037 ∥ T038 ∥ T039.

---

## Parallel Example: Phase 2

```bash
Task: "Criar src/config/writer.ts"
Task: "Criar src/setup/methods.ts"
Task: "Adicionar verified a ProviderStatus em src/providers/types.ts e status.ts"
# depois, componentes em paralelo:
Task: "Criar src/ui/dialogs/DialogFrame.tsx"
Task: "Criar src/ui/dialogs/SelectList.tsx"
Task: "Criar src/ui/dialogs/TextField.tsx"
Task: "Criar src/ui/dialogs/ProgressView.tsx e ResultView.tsx"
```

## Parallel Example: User Story 1

```bash
Task: "Criar reducer em src/setup/authFlow.ts"
Task: "Criar src/setup/connectionTest.ts"
# testes ao final:
Task: "tests/unit/setup/authFlow.test.ts + connectionTest.test.ts + driver.test.ts"
Task: "tests/integration/ui/dialogs.auth.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2.
2. Phase 3 (US1): `/auth` com Claude API e Qwen.
3. **PARAR e VALIDAR**: configurar o Qwen sem editar arquivo nem variável de ambiente (SC‑001).

### Incremental Delivery

1. US1 → configuração por diálogo.
2. US2 → login na Anthropic (completa o menu).
3. US3 → seletor `/model`.
4. Polish.

### Parallel Team Strategy

Após T018 (driver): Dev A → US2 (login); Dev B → US3 (seletor); ambos → Polish.

---

## Notes

- Tarefas [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Nenhum teste executa o `ant` real nem acessa rede; `fakeAntCli` e SDKs mockados cobrem todos os ramos.
- Chaves só entram pelo `TextField secret`; nenhuma função de setup pode receber ou registrar valores de chave em logs (apenas caminhos).
- Commits com prefixo `fix:` (CLAUDE.md); a feature 003 fica na branch `003-auth-provider-setup` até o push ser pedido.
