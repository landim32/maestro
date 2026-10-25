# Contract — Diálogo `/routes` e comandos `/ask` e atalhos

**Feature**: `008-model-routes` · **Date**: 2026-10-25

## 1. Abrir

- `/routes` (interativo, sessão ociosa, nenhum outro diálogo): abre o diálogo "Rotas por modelo". Enquanto o modelo responde: aviso `Aguarde a resposta terminar antes de abrir um diálogo.` (regra atual).
- `-p`: imprime a tabela textual (contracts/route-resolution.md § 5).

## 2. Lista

```
Rotas por modelo                                  (↑↓ navegar · Enter abrir · Esc fechar)
  Rotas
  ● chat            claude / claude-opus-5-5          padrão (segue o ativo)
  ○ github          claude / claude-sonnet-5-5        global
  ○ infra           qwen / qwen3-coder-plus           projeto · indisponível
  ○ review          claude / claude-sonnet-5-5        global · atalho /review
  Comandos
  ○ speckit.specify claude / claude-opus-5-5          padrão (segue chat)
  ○ speckit.plan    claude / claude-opus-5-5 · high   global
  ○ speckit.implement qwen / qwen3-coder-plus         global
  ○ speckit.old     qwen / qwen3-coder-plus           global · comando ausente
  + Nova rota…
```

- Ordem: `chat`, `github`, `infra`, rotas do usuário (alfabética), comandos (ordem de `/help`), "Nova rota…".
- Para quem segue, a coluna provedor/modelo mostra o **valor resolvido** e a origem diz `padrão (segue o ativo|chat)`.
- `indisponível` quando o provedor do alvo não está configurado/habilitado; `comando ausente` para rotas de comando sem comando; `atalho /nome` ou `atalho em colisão` para rotas de propósito.

## 3. Ações sobre uma rota (Enter)

| Opção | Disponível | Efeito |
|---|---|---|
| Escolher provedor e modelo | sempre | → lista de provedores configurados → lista de modelos do provedor + "Digitar outro modelo…" → grava `routes.<rota>` |
| Voltar ao padrão | rotas fixas e de comando com valor configurado | apaga `routes.<rota>` |
| Remover rota | rotas do usuário e rotas de comando ausente | apaga `routes.<rota>` (e o atalho `/<rota>` some) |
| Voltar | sempre | volta à lista |

Esc em qualquer passo volta um nível; na lista, fecha sem gravar. Ctrl+C fecha.

## 4. Nova rota

- "Nova rota…" → campo de texto para o nome. Validação ao Enter: formato (`minúsculas, dígitos, ".", "-", "_"`), não vazio, não colidir com rota existente ou comando (`já existe um comando /nome`). Válido → escolha de provedor e modelo (uma rota nova sempre nasce com alvo).
- Após gravar: `Rota review criada → claude / claude-sonnet-5-5. Use /ask review … ou /review …`.

## 5. Gravação e feedback

- Gravação no arquivo global, validada e atômica; o modelo digitado entra no catálogo do provedor (como no `/model`).
- Resultado: `done` com mensagem (`Rota speckit.plan → claude / claude-opus-5-5 (high)`), `failed` com o erro de escrita; Enter/Esc fecham.
- Vale imediatamente: `controller.reloadSettings()` + `refreshCommands()` (atalhos novos aparecem nas sugestões e no `/help`).
- Nunca mostra chaves: credenciais aparecem como no `/model` (`chave ****abcd`, `perfil`, `ambiente`).

## 6. `/ask` e atalhos

- `/ask <rota> <pedido>`: `rota` conhecida (propósito ou comando) → turno na rota com `display` = linha digitada; sem rota/pedido ou rota desconhecida → aviso com a lista de rotas, nada enviado.
- `/<rota> <pedido>` para rotas de propósito sem colisão com comandos; aparece no `/help` como `/<rota> <pedido>  (atalho da rota <rota>)` e nas sugestões do prompt.
- `/help` ganha `/routes` e `/ask`.

## 7. Testes que fixam este contrato

- `tests/unit/setup/routesFlow.test.ts` — § 2–4 (reducer: ordem, navegação, ações por tipo, validação do nome, efeitos).
- `tests/integration/ui/dialogs.routes.test.tsx` — § 1–5 fim a fim (`settingsWriter` injetado, `mountApp` com dois provedores).
- `tests/unit/session/commands.test.ts` — § 6 (`/ask`, atalhos, colisão, `/routes` em `-p`).
