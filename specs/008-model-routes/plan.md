# Implementation Plan: Rotas por Modelo (chat, Spec Kit, GitHub, infra e comandos)

**Branch**: `008-model-routes` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-model-routes/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Rotas nomeadas (`chat`, `github`, `infra`, uma por comando de prompt e rotas do usuário) que apontam para provedor + modelo (+ `effort`/`maxTokens` opcionais), guardadas em `settings.routes`. Um pedido é resolvido por uma função pura (`forçada → comando → chat → ativo`, com fallback e avisos quando o provedor da rota está indisponível) e o turno roda no provedor da rota **sem trocar o provedor ativo**, sobre a mesma conversa (o histórico neutro já é convertido por provedor a cada chamada). O controller passa a manter um provedor por id; `runTurn` recebe modelo, ajustes e rota; respostas de rotas ≠ `chat` são marcadas na transcrição e a barra mostra a rota durante a geração. `/ask <rota> <pedido>` e os atalhos `/<rota>` acionam rotas de propósito. `/routes` abre um diálogo no molde do `/model` (reducer puro `routesFlow` + efeitos no `SetupDriver`) para escolher provedor/modelo, voltar ao padrão, criar e remover rotas, gravando no `settings.json` global. `-p` ganha `--route`. Nenhuma dependência nova. Detalhes em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.  
**Primary Dependencies**: existentes — `zod` 4 (seção `routes`), `ink` 8 (diálogo com `SelectList`/`TextField`), `yargs` (`--route`). Nenhuma nova.  
**Storage**: `settings.json` ganha a seção `routes` (global e projeto, precedência atual); gravação pela tela só no global via `config/writer.ts`. Nada mais persistido.  
**Testing**: `vitest`; reducers puros (`resolveRoute`, `routeEntries`, `routesFlowReducer`) testados por tabela; `mountApp` com um `FakeProvider` por id (`providers: { claude, qwen }`) para verificar qual provedor recebeu cada turno e o histórico enviado; `settingsWriter` injetado para a gravação.  
**Target Platform**: mesma da CLI (Windows, macOS, Linux).  
**Project Type**: CLI (mesmo pacote).  
**Performance Goals**: resolução de rota < 1 ms; abrir `/routes` < 100 ms com dezenas de comandos; nenhum custo adicional por turno além de obter o provedor do cache.  
**Constraints**: sem `routes` configuradas o comportamento é idêntico ao atual (testes existentes intactos); o provedor ativo nunca muda por causa de uma rota; chaves nunca aparecem na tela nem no log; `-p` cobre tudo (`--route`, `/routes` textual).  
**Scale/Scope**: 4 arquivos novos em `src/` (`routes/catalog.ts`, `routes/resolve.ts`, `setup/routesFlow.ts`, `ui/dialogs/RoutesDialog.tsx`), ~14 alterados (`config/{schema,defaults}.ts`, `providers/{types,claude,qwen,anthropicProtocol}.ts`, `session/{session,turn,controller,commands}.ts`, `speckit/{prompt,service}.ts`, `setup/{dialog,driver}.ts`, `ui/{App,hooks/useSession,components/MessageList,components/StatusBar,dialogs/DialogHost}.tsx`, `cli/{args,nonInteractive}.ts`, `index.ts`); ~7 arquivos de teste novos.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constituição v1.0.0.

| Gate | Pré‑Phase 0 | Pós‑Phase 1 |
|---|---|---|
| **I. Simplicidade / YAGNI** | PASS — um formato de rota; ausência = padrão; sem fork/sub-agentes (ficam para a próxima feature); sem deps | PASS — reaproveita `PromptTurn`, `SetupDriver`, `SelectList`/`TextField`, `writeSettings` |
| **II. CLI texto I/O** | PASS — `--route`, `/routes` textual em `-p`, rotas de comando valem em `-p` | PASS — contrato route-resolution § 5 |
| **III. Testabilidade** | PASS — `resolveRoute`, `routeEntries`, `routesFlowReducer` puros; efeitos no driver injetável; `FakeProvider` por id | PASS — research R11 |
| **IV. Segurança de credenciais** | PASS — rotas não carregam credenciais; tela mostra credenciais como o `/model` (mascaradas) | PASS — `noSecrets` ganha o caso `/routes` |
| **V. Observabilidade mínima** | PASS — `route.resolve { route, provider, model, via, fallbacks }`, `routes.write { route, action }` | PASS |
| **VI/VII. Open-source / atribuição** | PASS — sem código de terceiros | PASS |

**Violações a justificar**: nenhuma.

## Project Structure

### Documentation (this feature)

```text
specs/008-model-routes/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── routes-config.md       # seção routes: formato, ausência, precedência, gravação
│   ├── route-resolution.md    # ordem de resolução, avisos, requisição, transcrição/barra/log, -p
│   └── routes-dialog.md       # diálogo /routes, /ask, atalhos
├── checklists/requirements.md
└── tasks.md                   # /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── routes/
│   ├── catalog.ts                    # NOVO: PURPOSE_ROUTES, ROUTE_GUIDANCE, routeEntries, aliasCommands (puro)
│   └── resolve.ts                    # NOVO: resolveRoute (puro): forçada → comando → chat → ativo, fallbacks
├── config/
│   ├── schema.ts                     # routeNameSchema, routeTargetSchema, routesSettingsSchema; settings.routes
│   └── defaults.ts                   # INITIAL_SETTINGS.routes (_comment)
├── providers/
│   ├── types.ts                      # ProviderRequest.overrides; Message.route
│   ├── anthropicProtocol.ts          # aplica overrides.effort/maxTokens
│   ├── claude.ts, qwen.ts            # passam req.overrides (Qwen: só maxTokens)
├── session/
│   ├── session.ts                    # pushAssistant(parts, providerId, model?, route?)
│   ├── turn.ts                       # TurnOptions.model/overrides/route → request e pushAssistant
│   ├── controller.ts                 # providerFor(id) cache; currentRoute; submit(opts.route); resolveRoute + avisos + log; refreshCommands com atalhos
│   └── commands.ts                   # SlashCommand.kind; /ask; /routes; /help
├── speckit/
│   ├── prompt.ts                     # PromptTurn.route?
│   └── service.ts                    # promptCommands() com kind: 'prompt'
├── setup/
│   ├── routesFlow.ts                 # NOVO: reducer puro do diálogo /routes
│   ├── dialog.ts                     # DialogState += routes
│   └── driver.ts                     # openRoutes, dispatchRoutes, runRoutesEffect (writeSettings/reload/refreshCommands)
├── ui/
│   ├── dialogs/RoutesDialog.tsx      # NOVO
│   ├── dialogs/DialogHost.tsx        # roteia type === 'routes'
│   ├── components/MessageList.tsx    # linha ⇢ rota · provedor / modelo
│   ├── components/StatusBar.tsx      # rota: <nome> enquanto gera
│   ├── hooks/useSession.ts, App.tsx  # currentRoute
├── cli/
│   ├── args.ts                       # --route
│   └── nonInteractive.ts             # route → submit; /routes textual
└── index.ts                          # valida --route contra as rotas conhecidas

tests/
├── unit/routes/{resolve,catalog}.test.ts
├── unit/setup/routesFlow.test.ts
├── unit/session/commands.test.ts     # /ask, atalhos, /routes -p
├── contract/config-schema.test.ts    # seção routes
├── contract/routes.test.ts           # resolução ↔ requisição, Message.route, --route
├── integration/ui/routes.test.tsx    # dois provedores, contexto compartilhado, fallback, marcas
├── integration/ui/dialogs.routes.test.tsx
└── unit/security/noSecrets.test.ts   # + /routes
```

**Structure Decision**: projeto único existente; a lógica de rotas fica em `src/routes/` (puro), o diálogo segue o padrão `setup/*Flow.ts` + `ui/dialogs/*Dialog.tsx`, e as mudanças de execução ficam em `session/`.

## Complexity Tracking

Nenhuma violação da constituição.

## Phase 0 — Research

Concluída em [research.md](./research.md): estado atual (R0), modelo de rota (R1), comandos com rota (R2), resolução e fallback (R3), turno em outro provedor (R4), `/ask` e atalhos (R5), diálogo (R6), transcrição/barra (R7), `-p` (R8), validação (R9), logs (R10), testes (R11).

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md): configuração, catálogo, resolução, turno roteado, comandos, reducer do diálogo, UI, CLI.
- [contracts/routes-config.md](./contracts/routes-config.md), [contracts/route-resolution.md](./contracts/route-resolution.md), [contracts/routes-dialog.md](./contracts/routes-dialog.md).
- [quickstart.md](./quickstart.md): 10 cenários manuais.
- Agent context: `CLAUDE.md` atualizado pelo script.

## Phase 2 — Ordem sugerida para o `/speckit.tasks`

1. **Fundação**: `routes/catalog.ts` + `routes/resolve.ts` (puros, com testes); esquema `routes` + defaults + teste de contrato; `ProviderRequest.overrides` + `Message.route` + provedores; `pushAssistant(route)`; `runTurn` com `model/overrides/route`; `providerFor` no controller; `SlashCommand.kind` + `PromptTurn.route`; `mountApp` com `providers` por id já existe.
2. **US1/US2 (rotas por comando)**: `submit` resolve a rota, avisa fallbacks, loga `route.resolve`; `MessageList`/`StatusBar`/`useSession`; `refreshCommands` após `applySettings`; teste de integração `routes.test.tsx` (dois provedores, contexto compartilhado).
3. **US1 (tela)**: `routesFlow.ts` + testes; `dialog.ts`/`driver.ts`; `RoutesDialog.tsx` + `DialogHost`; `/routes`; `dialogs.routes.test.tsx`.
4. **US3**: `/ask`, `aliasCommands`, `/help`, `ROUTE_GUIDANCE`; testes de comandos.
5. **US4/CLI**: `--route`, `/routes` em `-p`, aviso único da `chat`; `tests/contract/routes.test.ts`; `noSecrets`.
6. **Polish**: README (seção "Rotas por modelo", tabela de comandos, exemplo de configuração), CLAUDE.md, quickstart.
