---

description: "Task list for Histórico de Entradas e Catálogo de Modelos por Provedor"
---

# Tasks: Histórico de Entradas e Catálogo de Modelos por Provedor

**Input**: Design documents from `/specs/004-history-model-catalog/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (history.md, model-catalog.md), quickstart.md

**Tests**: O plano define a estratégia (research R9 e § "Testes derivados" dos contratos): store e navegador do histórico testados sem UI, reducer do `/model` testado sem UI, integração com `mountApp` + `withTempHome` (`MAESTRO_HOME` temporário). As tarefas de teste abaixo implementam exatamente esses casos. Nenhum teste acessa rede.

**Organization**: Tarefas por história de usuário. Nenhuma dependência nova de runtime.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: História a que a tarefa pertence (US1, US2, US3)
- Caminhos exatos em cada descrição

## Path Conventions

Projeto único: `src/` e `tests/` na raiz, conforme plan.md § Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Caminho do arquivo de histórico e helper de teste para lê‑lo.

- [x] T001 Adicionar `HISTORY_FILE_NAME = 'history.jsonl'` e `historyPath(env = process.env)` (= `path.join(globalConfigDir(env), HISTORY_FILE_NAME)`) em `src/config/paths.ts`
- [x] T002 [P] Estender `TempHome` em `tests/helpers/tempHome.ts` com `historyPath` e `readHistory(): string[]` (lê `history.jsonl` e devolve os `text` das linhas válidas; `[]` se o arquivo não existir)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema e padrões do catálogo, derivações puras do catálogo, e o módulo de histórico (store + memória + navegador). Bloqueia todas as histórias.

- [x] T003 Em `src/config/defaults.ts`, adicionar `models` a `DEFAULTS.claude` (`['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5']`) e `DEFAULTS.qwen` (`['qwen3-coder-plus','qwen3-coder-flash','qwen3-max']`) e incluir `models` nos dois provedores de `INITIAL_SETTINGS` (data-model § 2.1)
- [x] T004 Em `src/config/schema.ts`, criar `modelsSchema` = `z.preprocess([] → undefined, z.array(z.string().regex(/^\S+$/, 'must be a single non-empty token')).refine(sem repetidos, { message: "duplicate model '<x>'" }).optional())` e adicioná‑lo como `models` em `claudeProviderSchema` e `qwenProviderSchema` com `.default(DEFAULTS.<id>.models)`; garantir que `formatZodIssues` emite `providers.qwen.models.1: …` para item inválido e `providers.qwen.models: duplicate model 'x'` para repetido
- [x] T005 [P] Criar `src/config/models.ts` com `modelCatalog(settings, id): string[]` (= `models` + `model` configurado sem repetir, `model` no fim se faltar; nunca vazio) e `learnModelPatch(globalRaw: Json, id, model): SettingsPatchEntry[]` (lê `providers.<id>.models` do JSON bruto global ou o padrão quando ausente; `[]` se já contém; senão um patch `{ path: 'providers.<id>.models', value: [...lista, model] }`) — data-model § 2.2–2.3
- [x] T006 [P] Criar `src/session/history.ts` com `HISTORY_LIMIT = 1000`, `HISTORY_COMPACT_AT = 2000`, interface `HistoryStore { load(): string[]; append(text): void }`, `fileHistoryStore(path, logger?)` (carga tolerante linha a linha, dedupe consecutiva, últimas 1.000; compactação atômica tmp+rename quando > 2.000 linhas; append `{"t","text"}\n` com `mkdirSync` recursivo; erros capturados → `logger.log('history.error', { op, path, message })`), `memoryHistoryStore()`, classe `InputHistory` (`entries` readonly, `push(text)` → false se vazio/igual à última; aplica limite; chama `store.append`), e `historyNavigate(cursor, dir, items, current)` puro conforme a tabela do data-model § 1.4
- [x] T007 [P] Teste `tests/unit/config/models.test.ts`: `modelCatalog` com padrão, com `model` fora da lista (vai ao fim), sem repetição e ordem preservada; `learnModelPatch` devolve `[]` para nome existente, patch com padrão + nome quando a chave está ausente no bruto, e não copia lista de projeto (recebe só o bruto global)
- [x] T008 [P] Teste `tests/unit/session/history.test.ts`: `fileHistoryStore` (round‑trip multilinha; linha corrompida pulada; > 2.000 linhas → arquivo reescrito com 1.000 e `load` devolve 1.000; pasta inexistente criada no append; caminho inválido não lança e loga `history.error`); `InputHistory.push` (dedupe consecutiva, `''` → false, limite 1.000); `historyNavigate` cobrindo cada linha da tabela do data-model § 1.4
- [x] T009 Estender `tests/contract/config-schema.test.ts`: `INITIAL_SETTINGS` valida e traz `models` nos dois provedores; `{}` → `models` padrão; `models: []` → padrão; `['a b']` → `providers.qwen.models.0: must be a single non-empty token`; `['x','x']` → `providers.qwen.models: duplicate model 'x'`

**Checkpoint**: `npm run typecheck && npx vitest run tests/unit/config tests/unit/session/history.test.ts tests/contract/config-schema.test.ts` verde.

---

## Phase 3: User Story 1 – Navegar pelo histórico de entradas com ↑/↓ (Priority: P1) 🎯 MVP

**Goal**: Cada envio do prompt (mensagens e comandos `/`) vai para `~/.maestro/history.jsonl`; ↑/↓ navegam do mais recente ao mais antigo com rascunho preservado; sobrevive a `/clear` e ao fechamento.

**Independent Test**: Enviar uma mensagem, `/model` (Esc) e outra mensagem; ↑ três vezes mostra as três na ordem inversa; ↓ devolve o rascunho; novo `mountApp` com o mesmo `MAESTRO_HOME` recupera tudo; `history.jsonl` não contém texto digitado em diálogo.

### Implementation for User Story 1

- [x] T010 [US1] Em `src/session/controller.ts`: adicionar `history?: InputHistory` a `ControllerOptions` e como campo público readonly; em `submit()`, chamar `this.history?.push(input)` logo após a checagem de diálogo aberto e **antes** de `executeSlash` (contracts/history.md § 2)
- [x] T011 [US1] Em `src/index.ts`: quando interativo, criar `new InputHistory(fileHistoryStore(historyPath(process.env), logger))` e passar `history` ao `SessionController`; em `-p` não passar nada (nenhum arquivo criado/lido)
- [x] T012 [P] [US1] Em `src/ui/hooks/useSession.ts`: substituir `userInputs` por `historyItems: controller.history?.entries ?? []` e atualizar o uso em `src/ui/App.tsx` (`historyItems={snap.historyItems}`)
- [x] T013 [US1] Em `src/ui/components/InputPrompt.tsx`: trocar `cursorIdx` por `HistoryCursor` e usar `historyNavigate` em ↑/↓ (rascunho guardado ao entrar, devolvido ao sair); qualquer digitação/Backspace sai do histórico (`index=null`); Enter zera o cursor; manter `isScrollKey` ignorado — contracts/history.md § 3
- [x] T014 [P] [US1] Estender `tests/contract/dialog-flows.test.ts` (ou criar `tests/contract/keys.test.ts`): `isScrollKey` é falso para ↑/↓ simples e verdadeiro para Shift+↑/↓, PageUp/PageDown/Home/End (trava FR‑003)
- [x] T015 [US1] Criar `tests/integration/ui/history.test.tsx` com `withTempHome` + `mountApp({ env: home.env, controller: { history: new InputHistory(fileHistoryStore(home.historyPath)) } })`: (a) mensagem + `/model` (Esc) + mensagem → ↑×3 na ordem inversa, ↓ volta ao vazio; (b) rascunho `rasc` preservado após ↑ e ↓; (c) entrada editada é enviada e vira a mais recente, original mantida; (d) duplicata consecutiva não repete; (e) `/clear` não apaga o histórico; (f) segundo `mountApp` com o mesmo `home` recupera as entradas (`home.readHistory()` confere a ordem); (g) Shift+↑ não altera o prompt
- [x] T016 [P] [US1] Estender `tests/unit/security/noSecrets.test.ts`: após o fluxo `/auth` com chave digitada, `home.readHistory()` contém `/auth` e nenhuma linha do arquivo contém a chave
- [x] T017 [P] [US1] Estender `tests/integration/cli/nonInteractive.test.ts`: rodar `-p` com `MAESTRO_HOME` temporário e verificar que `history.jsonl` não é criado

**Checkpoint**: US1 completa e testável sozinha (`npx vitest run tests/integration/ui/history.test.tsx tests/unit/security`).

---

## Phase 4: User Story 2 – Catálogo de modelos por provedor no arquivo e no `/model` (Priority: P1)

**Goal**: `providers.<id>.models` no `settings.json`; `/model` lista todos os modelos agrupados por provedor com o ativo marcado; selecionar troca provedor+modelo e grava; a forma textual lista os catálogos.

**Independent Test**: Com configuração nova, `/model` mostra os modelos padrão agrupados; escolher `claude-sonnet-5-5` muda o cabeçalho e grava `providers.claude.model`; acrescentar um modelo no arquivo e reabrir mostra‑o; `-p "/model"` imprime `Models:`.

### Implementation for User Story 2

- [x] T018 [US2] Em `src/setup/modelFlow.ts`: substituir `ModelItem` por `ModelEntry` (uma entrada por modelo: `providerId, model, active, configured, credentialSource, maskedKey`); `buildModelEntries(statuses, settings, activeModel)` percorre `PROVIDER_IDS` × `modelCatalog(settings, id)`, marca `active` quando `s.active && model === activeModel` e insere o modelo ativo fora do catálogo como última entrada do grupo; `initialModelFlow(statuses, settings, activeModel)`; navegação continua pulando entradas não configuradas e passando por "Digitar outro modelo…"; `refreshModelList` recebe `settings`
- [x] T019 [US2] Em `src/ui/dialogs/SelectList.tsx`: suportar itens `header: true` (linha não selecionável, renderizada em negrito/dim, sem marcador) e janela de rolagem (`maxVisible?: number`) que mantém o item selecionado visível; em `src/ui/dialogs/ModelDialog.tsx`: renderizar grupos `<provedor> · <perfil|chave ****xxxx|ambiente|não configurado — configure com /auth>` seguidos dos modelos (`● modelo [ativo]` / `○ modelo`, desativados quando o provedor não está configurado) e "Digitar outro modelo…" por último — contracts/model-catalog.md § 2
- [x] T020 [US2] Em `src/setup/driver.ts`: `openModel()` e o re‑seed pós‑`back` passam `this.ctl.settings` a `initialModelFlow`/`refreshModelList`; `runModelEffect('apply')` inalterado nesta fase (grava `activeProvider` e `providers.<id>.model`)
- [x] T021 [P] [US2] Em `src/session/controller.ts`: `describeProviders()` acrescenta a seção `Models:` com uma linha por provedor (`  claude: * claude-opus-5-5, claude-sonnet-5-5, …`), `*` no modelo ativo do provedor ativo — contracts/model-catalog.md § 3
- [x] T022 [US2] Atualizar `tests/unit/setup/modelFlow.test.ts`: entradas por modelo agrupadas na ordem `PROVIDER_IDS`; ativo marcado; modelo ativo fora do catálogo inserido no fim do grupo; navegação pula grupo não configurado e é cíclica passando pela entrada custom; Enter em modelo de outro provedor → `applying` com o par certo
- [x] T023 [US2] Atualizar `tests/integration/ui/dialogs.model.test.tsx`: lista mostra cabeçalhos de grupo e os três modelos padrão de cada provedor; ↓ até `claude-sonnet-5-5` + Enter muda o cabeçalho e grava `providers.claude.model`; com `settings.providers.claude.models` contendo `claude-x`, o seletor o exibe; lista maior que a altura mantém o selecionado visível
- [x] T024 [P] [US2] Estender `tests/integration/cli/nonInteractive.test.ts` e `tests/unit/session/commands.model.test.ts`: `/model` sem argumentos em `-p` imprime `Models:` com `*` no ativo

**Checkpoint**: US1 + US2 testáveis de forma independente.

---

## Phase 5: User Story 3 – "Digitar outro modelo…" escolhe o provedor e aprende o modelo (Priority: P2)

**Goal**: A entrada custom pede o provedor (Claude/Qwen, só configurados selecionáveis), depois o nome; o nome é ativado e acrescentado a `providers.<id>.models` sem duplicar; a forma textual também aprende; falha de gravação mantém ativo e avisa.

**Independent Test**: `/model` → "Digitar outro modelo…" → Qwen → `qwen3-max-preview` → Enter: próxima mensagem vai para o Qwen com esse modelo, o arquivo lista o nome em `providers.qwen.models`, reabrir `/model` o mostra; repetir não duplica; `/model qwen qwen3-coder-flash` por texto acrescenta se faltar.

### Implementation for User Story 3

- [x] T025 [US3] Em `src/setup/modelFlow.ts`: novo passo `customProvider { providers: ProviderChoice[], selected }` (Enter na entrada custom → `customProvider` com `selected` no provedor ativo configurado, senão primeiro configurado; ↑/↓ só entre configurados; Enter em configurado → `custom` com `value` = modelo atual do provedor; Enter em não configurado ignorado; Esc → `list`); `custom` + Esc → `customProvider`; `applying` ganha `learn: boolean` calculado com `catalogs: Record<ProviderId, string[]>` passado ao reducer; `done` ganha `warning?`; evento `applied` aceita `warning?` — data-model § 3
- [x] T026 [US3] Em `src/ui/dialogs/ModelDialog.tsx`: tela `customProvider` (`Selecionar modelo · provedor`, `SelectList` com `claude`/`qwen`, descrição de credencial ou `não configurado — configure com /auth`, desativado quando não configurado; rodapé `↑↓ escolher · Enter confirmar · Esc voltar`); tela `custom` com rodapé `Enter aplicar · Esc voltar · Ctrl+U limpar`; `done` exibe `warning` quando presente — contracts/model-catalog.md § 2
- [x] T027 [US3] Em `src/setup/driver.ts` `runModelEffect('apply')`: montar o patch `[activeProvider, providers.<id>.model, ...(learn ? ctl.rememberModel(id, model) : [])]`; em falha de gravação após `switchProvider` bem‑sucedido, `notice('Não foi possível gravar a configuração: <motivo>', 'warn')` e `dispatchModel({ type: 'applied', warning })` em vez de `applyError`; `applyError` só quando `switchProvider` falha
- [x] T028 [US3] Em `src/session/controller.ts`: `rememberModel(id, model): SettingsPatchEntry[]` (= `learnModelPatch(readRawSettings(globalPath), id, model)`; `[]` sem `settingsPaths`); `persistActive(model?)` inclui `rememberModel` no mesmo patch quando `model` é informado (cobre `/model <id> <modelo>` em `src/session/commands.ts` sem alteração adicional)
- [x] T029 [US3] Estender `tests/unit/setup/modelFlow.test.ts`: custom → `customProvider` com `selected` correto; ↑/↓ pulam não configurados; Enter em não configurado não muda; Esc em cada etapa; `learn` verdadeiro só para nome fora do catálogo; `applied` com `warning` → `done.warning`
- [x] T030 [US3] Estender `tests/integration/ui/dialogs.model.test.tsx`: fluxo completo "Digitar outro modelo…" → Qwen → nome → próxima mensagem vai ao Qwen com o modelo; `home.readSettings()` mostra `providers.qwen.models` com o nome no fim; reabrir `/model` lista o modelo; repetir o nome não duplica; provedor não configurado desativado na etapa de provedor; `settingsWriter` que lança → modelo ativo no cabeçalho + aviso `Não foi possível gravar`
- [x] T031 [P] [US3] Estender `tests/unit/session/commands.model.test.ts` e `tests/unit/setup/driver.test.ts`: `/model qwen qwen3-max` por texto grava `activeProvider`, `providers.qwen.model` e acrescenta a `providers.qwen.models` em um único patch; nome já presente não gera entrada em `models`

**Checkpoint**: As três histórias testáveis de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T032 [P] Atualizar `README.md`: seção "Uso" com ↑/↓ e `~/.maestro/history.jsonl`; exemplo de `settings.json` com `models`; descrição do `/model` agrupado e de "Digitar outro modelo…"
- [x] T033 [P] Atualizar `CLAUDE.md` (bloco de estilo de código): histórico de entradas vive em `src/session/history.ts` com store injetável; campos de diálogo e `-p` nunca entram no histórico; catálogo de modelos é derivação pura em `src/config/models.ts` e grava sempre no global
- [x] T034 [P] Atualizar `specs/004-history-model-catalog/contracts/model-catalog.md` e `history.md` com quaisquer textos finais de tela/mensagem que tenham mudado na implementação; marcar o quickstart conferido
- [x] T035 Rodar `npm run typecheck && npm run lint && npm run format:check && npm run build && npm test` e corrigir pendências
- [ ] T036 Verificação manual do quickstart em terminal real (cenários 1–6), com `MAESTRO_HOME` temporário

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: sem dependências.
- **Phase 2 (Foundational)**: depende de T001 (T006 usa `historyPath` só em T011, mas o módulo é independente). T003 → T004 (o esquema usa `DEFAULTS.<id>.models`). T005 depende de T004 (tipos de `Settings`). T007/T008/T009 dependem dos módulos que testam.
- **Phase 3 (US1)**: depende de T006 e T001. Independente das Phases 4–5.
- **Phase 4 (US2)**: depende de T003–T005. Independente da Phase 3.
- **Phase 5 (US3)**: depende da Phase 4 (reducer e diálogo revisados) e de T005.
- **Phase 6 (Polish)**: depende de tudo.

### User Story Dependencies

- **US1**: só fundação (T001, T006). Entrega sozinha o MVP.
- **US2**: só fundação (T003–T005). Pode ser feita em paralelo com US1.
- **US3**: depende de US2.

### Parallel Opportunities

- Phase 1: T002 em paralelo com T001.
- Phase 2: T005, T006 em paralelo após T004; T007, T008 em paralelo com a implementação dos respectivos módulos (TDD) e entre si; T009 após T004.
- US1 ∥ US2: as duas histórias tocam arquivos distintos (`controller.ts` é tocado por T010 e T021 — fazer T010 antes de T021 ou rebasar).
- Dentro de US1: T012, T014, T016, T017 em paralelo com T013.
- Dentro de US2: T021 e T024 em paralelo com T018–T020.
- Dentro de US3: T031 em paralelo com T029–T030.

## Parallel Example: Phase 2

```text
T003 → T004
      ├─ T005 (config/models.ts)  ─ T007 (teste)
      ├─ T006 (session/history.ts) ─ T008 (teste)
      └─ T009 (contrato de esquema)
```

## Parallel Example: US1 ∥ US2

```text
US1: T010 → T011 → T013 → T015      US2: T018 → T019 → T020 → T022 → T023
     T012, T014, T016, T017 [P]          T021, T024 [P]
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + T006/T008 da Phase 2.
2. Phase 3 completa.
3. **STOP e validar**: `tests/integration/ui/history.test.tsx` verde e quickstart cenários 1–2 em terminal real.

### Incremental Delivery

1. Fundação completa (Phase 2) → esquema `models` validado.
2. US1 → histórico persistente (MVP).
3. US2 → catálogo visível no `/model` e em `-p`.
4. US3 → etapa de provedor + aprendizado.
5. Polish → docs, lint, suíte completa, verificação manual.

### Parallel Team Strategy

Com duas pessoas: A faz Phase 2 (histórico) + US1; B faz Phase 2 (catálogo) + US2 e depois US3. Ponto de sincronização: `controller.ts` (T010 antes de T021/T028).

## Notes

- Commits com prefixo `fix:` (padrão do repositório).
- Nunca registrar texto de `TextField` de diálogo no histórico; o teste `noSecrets` (T016) é a trava.
- `learnModelPatch` recebe o JSON **bruto global** (não `Settings` mesclado) para não copiar listas do projeto para o global.
- Ao mudar `ModelFlowState`, atualizar `specs/003-auth-provider-setup/data-model.md` § `ModelFlowState` com um ponteiro para esta feature (T034).
