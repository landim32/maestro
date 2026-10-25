# Research — Rotas por Modelo

**Branch**: `008-model-routes` · **Date**: 2026-10-25

Levantamento do estado atual e decisões técnicas. Nenhum `NEEDS CLARIFICATION` ficou aberto.

## R0. Estado atual

| Aspecto | Hoje | Lacuna frente à spec |
|---|---|---|
| Provedor/modelo | Um provedor ativo por sessão (`session.activeProviderId`, `modelOverride`); `SessionController.activeProvider` cria e guarda **uma** instância; `/model` troca para a sessão inteira | Falta usar provedor/modelo diferentes por turno sem trocar o ativo |
| Turno | `runTurn(session, provider, opts)` envia `messages: session.history` e `model: session.modelOverride` | Falta receber modelo (e ajustes) do turno; falta marcar a resposta com a rota |
| Comandos | `SlashCommand.run` devolve `PromptTurn { display, prompt }` para comandos de prompt (Spec Kit); o controller roda o turno com o provedor ativo | Falta saber quais comandos são "de prompt" e resolver a rota pelo nome |
| Configuração | `settings.json` com `activeProvider`, `providers.<id>`, `tools`, `ui`, `speckit`; precedência args > env > projeto > global; `writeSettings(patch)` com `value === undefined` removendo chave; `projectOverrides(paths, cwd)` diz quais caminhos o projeto sobrescreve | Falta a seção `routes` e a validação dos nomes |
| Diálogos | `DialogState = auth | model`; reducers puros (`modelFlow.ts`) + `SetupDriver` para efeitos; `DialogHost` escolhe o componente; `SelectList`, `TextField`, `ResultView` reutilizáveis | Falta o diálogo `/routes` |
| Transcrição | `Message.providerId`/`model` já existem nas respostas; `MessageList` não os mostra | Falta mostrar rota/modelo quando diferem da `chat` |
| `-p` | `runNonInteractive` → `controller.submit(prompt)`; `--provider`/`--model` trocam o ativo | Falta `--route` |
| Provedores | `claude` lê `effort`/`maxTokens` de `settings.providers.claude`; `qwen` idem para `maxTokens` | Faltam ajustes por requisição |

## R1. Modelo de rota

**Decision**: uma rota é `{ provider, model, effort?, maxTokens? }` gravada em `routes.<nome>`; a ausência da chave significa **padrão**: `chat` segue o provedor/modelo ativo, qualquer outra rota segue `chat`. Rotas de propósito criadas pelo usuário precisam de alvo (não há "seguir" para elas, seria o mesmo que não existir).

**Rationale**: um único formato para todas as rotas; o padrão "ausência = segue" mantém o `settings.json` pequeno e o comportamento atual intacto (SC-006). Ajustes `effort`/`maxTokens` por rota atendem ao "modelo forte para planejar, barato para implementar" sem novas chaves por provedor.

**Alternatives considered**: `"routes": { "speckit.plan": "chat" }` como string de encaminhamento (rejeitado: duplica o padrão e cria ciclos a validar); rotas com prompt de sistema editável (`system`) — fica para quando houver agentes de arquivo (007/009), onde isso já existe no frontmatter.

## R2. Quais comandos têm rota

**Decision**: `SlashCommand` ganha `kind?: 'prompt'`; os comandos de prompt do Spec Kit (`promptCommands()`) e qualquer comando de `.maestro/commands/`/pasta da integração são `prompt`; `/ask` e os atalhos de propósito também. A lista de rotas de comando é derivada em tempo real de `controller.commands.filter(c => c.kind === 'prompt')`, então `/speckit.init` e novos arquivos aparecem sem reinício (FR-012). Comandos sem `kind` (`/help`, `/clear`, `/model`, `/auth`, `/mouse`, `/routes`, `/speckit.init`, `/speckit.status`) não têm rota.

**Rationale**: o próprio comando declara se chama o modelo; nada de lista fixa a manter.

## R3. Resolução e fallback

**Decision**: função pura `resolveRoute(input)` em `src/routes/resolve.ts`:

```
entrada: { forced?: string; command?: string; routes: RoutesSettings; statuses: ProviderStatus[]; active: { provider, model } }
saída:   { route: string; target: { provider, model, effort?, maxTokens? }; via: 'forced'|'command'|'chat'|'active'; fallbacks: Array<{ route: string; reason: string }> }
```

Ordem: `forced` → `command` → `chat` → ativo. Em cada passo, uma rota com alvo cujo provedor está indisponível (`!configured || !enabled`) gera um `fallback` com o motivo e segue para o próximo. `forced` inexistente é erro (o `/ask` avisa antes de chegar aqui). O controller transforma `fallbacks` em avisos (um por rota; a indisponibilidade da `chat` avisa uma vez por sessão, FR-011).

**Rationale**: reducer puro, testável por tabela; os avisos nascem da mesma estrutura que o log (`route.resolve`).

## R4. Executar um turno em outro provedor

**Decision**: `SessionController` passa a manter um cache `providers: Map<ProviderId, ModelProvider>` (`providerFor(id)`), invalidado por `applySettings` como hoje; `activeProvider` vira `providerFor(session.activeProviderId)`. `runTurn` ganha `opts.model?`, `opts.overrides?: { effort?, maxTokens? }` e `opts.route?`; o `ProviderRequest` ganha `overrides?` que `claude.ts`/`qwen.ts` aplicam sobre a configuração (`effort` só no Claude; Qwen ignora com nota no código). As respostas são gravadas com `pushAssistant(parts, provider.id, model, route)` (campo novo `Message.route`).

**Rationale**: o histórico neutro já é convertido por provedor a cada chamada; só muda **qual** provedor e **qual** modelo recebem a requisição. Nenhuma cópia de contexto é necessária (FR-006).

**Alternatives considered**: trocar o provedor ativo temporariamente e restaurar (rejeitado: estado mutável durante um turno assíncrono, `/model` durante a resposta ficaria inconsistente); sessão separada por rota (rejeitado: contraria o contexto compartilhado).

## R5. `/ask` e atalhos de propósito

**Decision**: `/ask <rota> <pedido>` é um comando de prompt fixo que devolve `PromptTurn { display: '/ask github …', prompt: <pedido>, route: 'github' }` (`PromptTurn.route?` novo). Para cada rota de propósito (`chat`, `github`, `infra`, criadas pelo usuário) o controller gera um atalho `/<rota> <pedido>` equivalente, **exceto** quando o nome colide com um comando existente (o comando vence; a tela marca "atalho indisponível"). As rotas `github` e `infra` acrescentam um bloco curto de orientação ao prompt de sistema do turno (`ROUTE_GUIDANCE` em `src/routes/catalog.ts`); `chat` e rotas do usuário não acrescentam nada.

**Rationale**: reaproveita o mecanismo de `PromptTurn` da 006; atalhos são comandos normais e aparecem no `/help` e nas sugestões do prompt.

## R6. Tela `/routes`

**Decision**: reducer puro `src/setup/routesFlow.ts` no molde de `modelFlow.ts`:

- `list`: linhas = cabeçalho "Rotas", rotas de propósito, cabeçalho "Comandos", rotas de comando, entrada final "Nova rota…". Cada linha mostra `nome  provedor / modelo  (origem)` e `indisponível`/`comando ausente` quando for o caso; `(padrão)` para quem segue.
- `action` (Enter numa rota): "Escolher provedor e modelo", "Voltar ao padrão" (ou "Remover rota" para rotas do usuário), "Voltar".
- `provider`: provedores configurados (como `customProvider` do `/model`).
- `model`: catálogo do provedor + "Digitar outro modelo…" → `custom` (TextField).
- `newRoute`: TextField para o nome (validação de formato e colisão com rotas/comandos).
- `applying` → `done | failed` → `closed`; `cancel` fecha sempre.

Efeitos no `SetupDriver`: `writeSettings([{ path: 'routes.<nome>', value: alvo | undefined }])` + `reloadSettings()` + aprender o modelo no catálogo (`rememberModel`). A origem de cada valor vem de `readRawSettings(globalPath)` × `projectOverrides(['routes.<nome>'], cwd)`; o projeto só é lido.

**Rationale**: mesma arquitetura dos diálogos existentes (reducer puro + driver injetável), componentes `SelectList`/`TextField`/`ResultView` reutilizados; a lista deriva de `controller.commands` e `controller.settings.routes`.

**Alternatives considered**: editar um arquivo `routes.json` separado (rejeitado: precedência global/projeto já existe no `settings.json`); tela em formulário livre (rejeitado: o padrão lista+Enter já é o da UI).

## R7. Transcrição e barra de status

**Decision**: `MessageList` mostra, acima de uma resposta cuja `route` não é `chat`, uma linha dim `⇢ github · qwen / qwen3-coder-plus`; a barra de status mostra `rota: github` ao lado de `thinking…` enquanto `controller.currentRoute` estiver definido. Respostas da `chat` ficam como hoje (sem ruído).

## R8. `-p` e argumentos

**Decision**: `--route <rota>` em `args.ts`; `runNonInteractive` passa `{ route }` ao `submit`, que o trata como `forced`. Rota inexistente → mensagem em stderr e saída `2` (uso inválido), como `--provider` desconhecido hoje.

## R9. Validação e configuração

**Decision**: `routesSchema = z.record(routeNameSchema, routeTargetSchema)` com `_comment` permitido; `routeNameSchema = /^[a-z0-9][a-z0-9._-]*$/`; `routeTargetSchema = z.strictObject({ provider: providerIdSchema, model: modelNameSchema, effort?: effortSchema, maxTokens?: int ≥ 1 })`. `settings.routes` tem `prefault({})`. Mensagens de erro seguem `formatZodIssues` (caminho + motivo). `INITIAL_SETTINGS` ganha `routes` com `_comment` explicando o padrão.

## R10. Logs e segurança

**Decision**: evento `route.resolve { route, provider, model, via, fallbacks: [{route, reason}] }` por turno; `routes.write { route, action }` ao gravar. Nunca valores de credenciais (as rotas não têm credenciais); o teste `noSecrets` ganha um caso para a tela `/routes` (chaves mascaradas como no `/model`).

## R11. Testes

- **Unit**: `tests/unit/routes/resolve.test.ts` (tabela: forçada/comando/chat/ativo, fallbacks encadeados, rota inexistente), `tests/unit/routes/catalog.test.ts` (rotas fixas, atalhos e colisões, lista de comandos de prompt), `tests/unit/setup/routesFlow.test.ts` (navegação, ações, nova rota, validação de nome, remover só rotas do usuário), `tests/unit/session/commands.test.ts` (`/ask`, atalhos, `/routes` em `-p`).
- **Contract**: `tests/contract/config-schema.test.ts` (seção `routes`), `tests/contract/routes.test.ts` (resolução ↔ requisição: provedor/modelo/overrides recebidos pelo `FakeProvider`; `Message.route`; `--route`).
- **Integration (UI)**: `tests/integration/ui/dialogs.routes.test.tsx` (abrir, trocar provedor/modelo, voltar ao padrão, nova rota, Esc; gravação via `settingsWriter` injetado), `tests/integration/ui/routes.test.tsx` (dois `FakeProvider`s: comando no Qwen e conversa no Claude compartilham o histórico; transcrição marca a rota; fallback com aviso; barra mostra a rota).
- **Security**: `tests/unit/security/noSecrets.test.ts` (+ tela `/routes` e log `route.resolve` sem chaves).
