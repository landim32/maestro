# Contract — Resolução de rota e turno roteado

**Feature**: `008-model-routes` · **Date**: 2026-10-25

## 1. Ordem de resolução

| Passo | Fonte | Quando |
|---|---|---|
| 1 | rota forçada | `/ask <rota> …`, atalho `/<rota> …`, `--route <rota>` |
| 2 | rota do comando | comando de prompt em execução (`kind: 'prompt'`): `routes.<nome do comando>` |
| 3 | `routes.chat` | mensagem comum ou passos anteriores sem alvo |
| 4 | provedor/modelo ativo | `routes.chat` ausente ou indisponível |

Em cada passo com alvo, o provedor precisa estar **configurado e habilitado**; senão o passo é registrado em `fallbacks` com o motivo (`unconfigured` \| `disabled` \| `unknown`) e a resolução segue.

## 2. Avisos

| Situação | Aviso (transcrição, `warn`) |
|---|---|
| rota forçada/do comando indisponível | `Rota <nome> indisponível (<motivo>); usando chat.` |
| `chat` configurada e indisponível | `Rota chat indisponível (<motivo>); usando o provedor ativo.` — uma vez por sessão |
| `/ask` sem rota ou rota desconhecida | `Uso: /ask <rota> <pedido>. Rotas: chat, github, infra, …` — nada é enviado |
| `--route` desconhecida em `-p` | stderr `maestro: rota desconhecida '<nome>'. Rotas: …`, saída `2` |

Motivos em texto: `provedor qwen não configurado` / `provedor qwen desabilitado` / `rota desconhecida`.

## 3. Requisição ao provedor

- `messages`: **todo** o `session.history` (todas as rotas), convertido pelo provedor da rota como hoje.
- `model`: o da rota; `overrides.effort`/`maxTokens` quando definidos (o Claude aplica ambos; o Qwen aplica só `maxTokens`).
- `system`: o prompt de sistema da sessão + bloco de orientação da rota (`github`, `infra`) quando houver.
- O provedor ativo da sessão **não muda**; `/model` continua controlando a `chat` padrão.
- Ferramentas, modo de aprovação, `ask_user`, interceptação do Spec Kit: iguais ao turno comum.

## 4. Transcrição, barra e log

- A resposta é gravada com `Message.route = <rota>`; quando `route !== 'chat'`, a transcrição mostra `⇢ <rota> · <provedor> / <modelo>` acima do texto.
- Enquanto gera: barra `thinking…  ·  rota: <rota>` (só para rotas ≠ `chat`).
- `--debug`: `route.resolve { route, provider, model, via, fallbacks }` por turno; nunca conteúdo nem credenciais.

## 5. `-p`

- `maestro -p "/speckit.plan" ` usa `routes['speckit.plan']`; `maestro -p --route infra "…"` força `infra`.
- `maestro -p "/routes"` imprime: `nome  provedor / modelo  origem  disponibilidade` para todas as rotas conhecidas.

## 6. Testes que fixam este contrato

- `tests/unit/routes/resolve.test.ts` — § 1 (tabela de resolução e fallbacks).
- `tests/contract/routes.test.ts` — § 3–5 com `FakeProvider` por id (modelo/overrides recebidos; histórico completo enviado ao segundo provedor; `Message.route`; `-p --route`; `/routes` em `-p`).
- `tests/integration/ui/routes.test.tsx` — § 2 e § 4 (avisos de fallback, marca na transcrição, barra de status).
