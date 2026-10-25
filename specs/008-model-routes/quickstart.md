# Quickstart — Rotas por Modelo

**Branch**: `008-model-routes` · **Date**: 2026-10-25

## Preparação

```bash
npm install
npm run build && node dist/index.js      # ou: npm run dev
```

Configure os dois provedores (`/auth`), ou pelo menos o Claude e um Qwen com chave, para ver o roteamento entre modelos.

## Cenários de verificação

1. **US1 – Tela**: `/routes` abre a lista com `chat`, `github`, `infra` e um bloco "Comandos" com todos os `/speckit.*` de prompt, cada um com provedor/modelo e `padrão (segue …)`. Esc fecha sem gravar.
2. **US1 – Rotear um comando**: em `/routes`, selecione `speckit.specify` → "Escolher provedor e modelo" → `qwen` → `qwen3-coder-plus`. A tela confirma e `settings.json` ganha `routes["speckit.specify"]`. Envie `/speckit.specify Adicionar login`: a transcrição mostra `⇢ speckit.specify · qwen / qwen3-coder-plus` acima da resposta e a barra mostra `rota: speckit.specify` enquanto gera. Em seguida "resuma o que fizemos": responde o Claude (sem marca) e cita o que o Qwen produziu.
3. **US1 – Voltar ao padrão**: `/routes` → `speckit.specify` → "Voltar ao padrão": a chave some do arquivo e a linha volta a `padrão (segue chat)`.
4. **US2 – Comandos novos**: `/speckit.init --upgrade` (ou crie `.maestro/commands/revisar.md`), reabra `/routes`: a rota nova está na lista. `/help` não mostra rota para `/clear`, `/model`, `/speckit.status`.
5. **US3 – `/ask` e atalhos**: `/ask github resuma o PR #6` roda na rota `github`; `/github …` e `/infra …` idem; `/ask` sozinho avisa com a lista de rotas. Em `/routes` → "Nova rota…" → `review` → Claude/Sonnet: `/ask review …` e `/review …` passam a funcionar e aparecem no `/help`.
6. **US4 – Fallback**: rote `speckit.plan` para `qwen` e desabilite o Qwen em `settings.json` (`providers.qwen.enabled: false`). `/speckit.plan` avisa `Rota speckit.plan indisponível (provedor qwen desabilitado); usando chat.` e responde pelo Claude; `/routes` marca a rota como `indisponível`.
7. **US4 – Contexto**: com `chat` no Claude e `github` no Qwen, diga ao Claude "o número secreto é 42" e depois `/ask github qual é o número secreto?` — o Qwen responde 42 (o histórico inteiro foi enviado). Com `--debug`, o `route.resolve` do log tem rota, provedor, modelo e `via`, sem conteúdo.
8. **Projeto sobrescreve**: crie `./.maestro/settings.json` com `routes.chat` apontando para o Qwen; `/routes` mostra `projeto` na origem; ao editar `chat` na tela, o aviso de sobrescrita aparece e o arquivo global é gravado.
9. **`-p`**: `node dist/index.js -p "/routes"` imprime a tabela; `node dist/index.js -p --route infra "como escalar o container?"` força a rota; `--route nada` sai com código 2 e lista as rotas em stderr.
10. **Sem configuração**: apague `routes` do `settings.json`: tudo se comporta como antes da feature (`/model` troca a conversa inteira; nenhuma marca na transcrição).

## Testes automatizados

```bash
npm test                 # inclui tests/unit/routes/*, tests/unit/setup/routesFlow.test.ts, tests/contract/routes.test.ts,
                         # tests/integration/ui/{routes,dialogs.routes}.test.tsx
npm run lint && npm run typecheck && npm run format:check
```
