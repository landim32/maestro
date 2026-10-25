# Contract — Seção `routes` do `settings.json`

**Feature**: `008-model-routes` · **Date**: 2026-10-25

## 1. Formato

```json
"routes": {
  "_comment": "…",
  "chat":           { "provider": "claude", "model": "claude-opus-5-5" },
  "github":         { "provider": "claude", "model": "claude-sonnet-5-5", "effort": "low" },
  "speckit.plan":   { "provider": "claude", "model": "claude-opus-5-5", "effort": "high" },
  "speckit.implement": { "provider": "qwen", "model": "qwen3-coder-plus", "maxTokens": 32000 },
  "review":         { "provider": "claude", "model": "claude-sonnet-5-5" }
}
```

| Chave | Regra |
|---|---|
| nome da rota | `^[a-z0-9][a-z0-9._-]*$`; erro `routes.<nome>: nome de rota inválido …` |
| `provider` | `claude` \| `qwen` (obrigatório) |
| `model` | token único sem espaços (obrigatório) |
| `effort` | `low` \| `medium` \| `high` (opcional; só o Claude aplica) |
| `maxTokens` | inteiro ≥ 1 (opcional) |
| chave desconhecida dentro do alvo | rejeitada com o caminho completo |

## 2. Semântica da ausência

- `routes.chat` ausente → a conversa usa o provedor/modelo ativo (`/model`, `--provider`, `--model`).
- `routes.<comando>` ausente → o comando segue `chat`.
- `routes.github` / `routes.infra` ausentes → seguem `chat` (continuam acionáveis por `/ask github …`).
- Uma chave com nome que não é `chat`/`github`/`infra` nem um comando de prompt existente é uma **rota de propósito do usuário** (acionável por `/ask <nome>` e `/<nome>`), ou, se já foi um comando, uma **rota de comando ausente** (mantida, sinalizada na tela, removível).

## 3. Precedência e gravação

- Leitura: `./.maestro/settings.json` sobrescreve o global **rota a rota** (`mergeSettings` atual, por chave de objeto).
- A tela `/routes` grava apenas no arquivo global (`writeSettings`, atômico, validado, preservando `_comment`); quando o projeto sobrescreve a rota editada, a tela avisa `sobrescrita por ./.maestro/settings.json` e mantém a gravação global.
- Remover = apagar a chave (`value: undefined`).

## 4. Testes que fixam este contrato

- `tests/contract/config-schema.test.ts` — § 1 (aceita o exemplo; rejeita nome inválido, provedor desconhecido, modelo com espaço, chave extra, `maxTokens: 0`; `_comment` permitido; `{}` → sem rotas).
- `tests/unit/routes/catalog.test.ts` — § 2 (entradas padrão × configuradas × do usuário × comando ausente; origem global/projeto).
- `tests/integration/ui/dialogs.routes.test.tsx` — § 3 (gravação via writer injetado; aviso de sobrescrita).
