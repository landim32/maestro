# Research — Histórico de Entradas e Catálogo de Modelos por Provedor

**Branch**: `004-history-model-catalog` · **Date**: 2026-10-25

Levantamento do estado atual do código e das decisões técnicas. Nenhum `NEEDS CLARIFICATION` ficou aberto.

## R0. Estado atual (o que já existe e o que falta)

| Aspecto | Hoje | Lacuna frente à spec |
|---|---|---|
| Histórico ↑/↓ | `InputPrompt` navega em `snap.userInputs`, derivado de `session.history` (só mensagens `user` da conversa) | Não inclui comandos `/`; não persiste; `/clear` apaga; sem rascunho preservado |
| ↑/↓ × rolagem | `isScrollKey` já reserva **Shift**+↑/↓, PageUp/PageDown, Home/End; ↑/↓ simples só chegam ao prompt | Nada a corrigir; travar por teste de contrato (a spec exige que continue assim) |
| `/model` lista | Um item por provedor (modelo configurado) + "Digitar outro modelo…" | Precisa listar o catálogo por provedor |
| "Digitar outro modelo…" | Usa o provedor ativo (ou o primeiro configurado) | Precisa pedir o provedor |
| Modelo digitado | Grava só `providers.<id>.model` | Precisa entrar em `providers.<id>.models` |
| Arquivo de configuração | `providers.<id>.model` (string) | Falta `providers.<id>.models` (lista) |
| `/model` por texto | `switchProvider` + `persistActive(model)` | Também deve acrescentar ao catálogo |
| `/model` em `-p` | `describeProviders()` (tabela por provedor) | Deve listar modelos por provedor |

## R1. Como o Claude Code faz o histórico

**Decision**: histórico por usuário em `~/.maestro/history.jsonl` (ao lado de `settings.json`, respeitando `MAESTRO_HOME`), uma linha JSON por entrada `{ "t": "<ISO-8601>", "text": "<entrada>" }`, append a cada envio, carregado na abertura, navegado com ↑/↓ do mais recente ao mais antigo com rascunho preservado.

**Rationale**: o Claude Code guarda `~/.claude/history.jsonl` (uma linha JSON por prompt, com texto e timestamp), acrescenta a cada envio e carrega na inicialização; ↑ no prompt vazio traz o último prompt e ↓ devolve o texto em edição. JSONL dá append atômico por linha (seguro com duas instâncias), tolera linhas corrompidas (pula a linha, não o arquivo) e preserva quebras de linha dentro do texto (escapadas pelo JSON).

**Alternatives considered**: JSON único (reescrita completa a cada envio, risco de corrupção com duas instâncias); texto puro uma entrada por linha (não preserva entradas multilinha); SQLite (dependência nova para nada).

## R2. Limite, deduplicação e compactação

**Decision**: limite de 1.000 entradas na memória e no arquivo. Deduplicação só de **consecutivas** (igual a `HISTCONTROL=ignoredups`). O arquivo é compactado (reescrito atomicamente com as 1.000 mais recentes) quando, ao carregar, tiver mais de 2.000 linhas; fora disso só há append.

**Rationale**: append puro mantém a gravação O(1) e segura entre instâncias; a compactação na carga é rara e acontece quando só há uma instância lendo. 1.000 entradas × ~200 bytes ≈ 200 KB, carga instantânea.

**Alternatives considered**: deduplicar globalmente (muda a ordem percebida e não é o que o Claude Code faz); compactar a cada envio (reescrita desnecessária).

## R3. O que entra e o que não entra no histórico

**Decision**: entra toda entrada submetida pelo prompt interativo com texto não vazio após `trim()`, **inclusive comandos `/`** (`/model`, `/auth`, `/clear`, `/help`); registra‑se **antes** de executar, para que comandos que fecham ou limpam a sessão (`/exit`, `/clear`) também fiquem. Não entram: texto digitado em campos de diálogo (`TextField` dos fluxos `/auth` e `/model`), entradas do modo `-p`, respostas `y/n` de confirmação de ferramenta, entradas vazias.

**Rationale**: o pedido é "histórico de comandos"; o atual só guarda mensagens. Campos de diálogo carregam chaves de API e já são tratados como segredo (feature 003). `-p` é execução única sem interatividade.

**Alternatives considered**: guardar só comandos (perde o caso de repetir perguntas longas); filtrar entradas que "parecem chave" (heurística frágil; o arquivo tem a mesma proteção do `settings.json`, que já guarda chaves).

## R4. Onde o histórico vive na arquitetura

**Decision**: `src/session/history.ts` com (a) `InputHistoryStore` — carga/append/compactação em arquivo, injetável (`HistoryStore` interface: `load(): string[]`, `append(text): void`); (b) `InputHistory` — lista em memória com `push()` (dedupe + limite) e `entries`; (c) navegador puro `historyNavigate(state, dir, items, current)` com estado `{ index: number | null; draft: string }`. O `SessionController` recebe `history?: InputHistory` em `ControllerOptions`; `submit()` chama `history.push(input)` no início (antes de `executeSlash`). O `InputPrompt` passa a receber `historyItems` do controller (não mais derivados de `session.history`) e usa o navegador puro.

**Rationale**: segue o padrão da feature 003 (lógica pura + efeitos injetáveis), permite testar navegação e persistência sem Ink, e remove o acoplamento do histórico à conversa (sobrevive a `/clear`). Falhas de E/S são capturadas no store e registradas em `logger.log('history.error', …)`, sem afetar a sessão (FR‑006).

**Alternatives considered**: manter a derivação de `session.history` (não persiste, não inclui comandos); colocar a persistência no `InputPrompt` (UI escrevendo arquivo viola a separação já adotada).

## R5. Catálogo de modelos no `settings.json`

**Decision**: nova chave `providers.<id>.models: string[]` nos dois provedores, com padrão por provedor (`DEFAULTS.claude.models`, `DEFAULTS.qwen.models`) escrito pelo `INITIAL_SETTINGS`. Validação: cada item `^\S+$` (não vazio, sem espaços), sem repetidos (`providers.<id>.models: duplicate model 'x'`); lista vazia é tratada como ausente (preprocess `[] → undefined` → padrão). O **catálogo efetivo** (`modelCatalog(settings, id)`) é `models` + `model` configurado (se faltar, vai para o fim), sem repetir — assim o ativo nunca fica fora da lista (FR‑009) e `--model` por argumento também aparece.

**Rationale**: `strictObject` já rejeita chaves desconhecidas; o padrão por provedor evita exigir edição manual; `[]` → padrão é o comportamento "ausente ou vazia" pedido na spec sem distinguir os dois casos no código.

**Alternatives considered**: catálogo global com prefixo de provedor (`claude:claude-opus-5-5`) — menos legível no arquivo; objeto `{ nome: {…} }` para metadados futuros — YAGNI.

Padrões escolhidos: Claude `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`; Qwen `qwen3-coder-plus`, `qwen3-coder-flash`, `qwen3-max`. O modelo configurado padrão de cada provedor é o primeiro da lista.

## R6. Precedência projeto/global e gravação do modelo aprendido

**Decision**: `mergeSettings` já substitui cada provedor inteiro quando `./.maestro/settings.json` o define; portanto a lista do projeto vale para aquele provedor (como na spec). Modelos aprendidos são gravados sempre no arquivo **global** via `writeSettings` (patch por caminho `providers.<id>.models`), e `WriteResult.overriddenByProject` gera o aviso "`./.maestro/settings.json` sobrescreve `providers.<id>.models` nesta pasta" (mesma mecânica da feature 003). O patch de "aprender" é calculado a partir do arquivo global **bruto** (`readRawSettings`), não do catálogo efetivo, para não copiar a lista do projeto para o global.

**Rationale**: reutiliza writer, precedência e avisos existentes.

## R7. Fluxo do `/model` revisado

**Decision**: `ModelFlowState` passa a ter:

- `list`: `items: ModelEntry[]` (uma entrada por **modelo**, com `providerId`, `model`, `active`, `configured`, `credentialSource`, `maskedKey`), agrupadas por provedor na UI (cabeçalho do grupo não selecionável), mais a entrada final "Digitar outro modelo…"; navegação pula entradas de provedores não configurados (como hoje).
- `customProvider` (**novo**): `providers: [{ id, configured, label }]`, `selected`; ↑/↓ alternam, Enter em configurado → `custom`; Enter em não configurado é ignorado; Esc → `list`.
- `custom`: `providerId`, `value`, `error`; Esc → `customProvider` (antes voltava direto à lista).
- `applying`: `providerId`, `model`, `learn: boolean` (true quando o modelo não está no catálogo efetivo).
- `done` ganha `warning?: string` para o caso "ativado, mas não gravado" (FR‑017); `failed` fica só para falha de ativação.

O driver, em `apply`: `switchProvider` → patch `[activeProvider, providers.<id>.model, (+ providers.<id>.models se learn)]` → `reloadSettings`; se a gravação falhar, `applied` com `warning` e aviso em `notice`.

**Rationale**: mantém o reducer puro e testável; a única tela nova é a escolha do provedor (reutiliza `SelectList`).

**Alternatives considered**: perguntar o provedor **depois** do nome (pior: o nome depende do provedor); inferir pelo prefixo `claude-`/`qwen` (falha com modelos de nome livre).

## R8. Saída textual do `/model`

**Decision**: `describeProviders()` passa a listar, após a tabela atual, os modelos de cada provedor configurado, um por linha, com `*` no ativo (`  claude: * claude-opus-5-5, claude-sonnet-5-5, …` em linhas separadas). `/model <id> <modelo>` por texto chama `rememberModel(id, modelo)` além de `persistActive` (um único patch).

## R9. Testes

- **Unit** `tests/unit/session/history.test.ts`: store (carga, append, linhas corrompidas puladas, compactação > 2.000, erro de E/S não lança), `InputHistory.push` (dedupe consecutiva, limite), navegador puro (↑ do vazio, ↑ repetido para na mais antiga, ↓ devolve rascunho, envio zera cursor).
- **Unit** `tests/unit/config/models.test.ts`: `modelCatalog` (padrão, inclui `model` configurado, sem repetição), `learnModelPatch` (gera patch só quando novo; usa o global bruto).
- **Unit** `tests/unit/setup/modelFlow.test.ts`: agrupamento, navegação pulando não configurados e cabeçalhos, `customProvider` (bloqueia não configurado, Esc volta), `learn`.
- **Contract** `tests/contract/config-schema.test.ts`: `models` padrão no arquivo inicial, `[]` → padrão, duplicata e espaço rejeitados com caminho; `tests/contract/dialog-flows.test.ts`: teclas do `/model` (↑/↓ simples no prompt nunca rolam — `isScrollKey`).
- **Integration** `tests/integration/ui/history.test.tsx` (novo, com `MAESTRO_HOME` temporário via `tempHome`): ↑/↓ com mensagens e comandos, rascunho preservado, persistência entre dois `mountApp`, texto de diálogo ausente do arquivo, `/clear` não apaga histórico. `tests/integration/ui/dialogs.model.test.tsx`: grupos, troca cruzada, provedor na etapa de digitação, modelo aprendido aparece ao reabrir. `tests/integration/cli/nonInteractive.test.ts`: `-p` não cria `history.jsonl`; `/model` em `-p` lista modelos.
- **Security** `tests/unit/security/noSecrets.test.ts`: após o fluxo `/auth`, `history.jsonl` não contém a chave.
