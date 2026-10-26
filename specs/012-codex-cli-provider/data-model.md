# Data Model: Provedor Codex

## CodexProviderSettings (`settings.providers.codex`)

| Campo | Tipo | Padrão | Regra |
|---|---|---|---|
| `_comment` | string | texto explicativo | opcional |
| `enabled` | boolean | `false` | só `/auth` → Codex ou edição manual liga (FR-003) |
| `model` | string não vazia | `gpt-6-luna` | repassado como `-m` |
| `models` | string[] | `['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna']` | catálogo do `/model`; os modelos usados são aprendidos como nos outros provedores |
| `effort` | `low\|medium\|high\|xhigh\|max` | `medium` | repassado como `model_reasoning_effort`; `overrides.effort` da rota prevalece |
| `command` | string | ausente | caminho ou nome do executável. Ausente = `codex.exe`, depois `codex` no PATH |

`strictObject`, como os demais provedores. Sem a chave, o comportamento é o atual (provedor desabilitado).

## ProviderId

`PROVIDER_IDS = ['claude', 'qwen', 'claude-code', 'codex']`. Uma rota pode apontar para `codex` (`routes.<nome>.provider`). `activeProvider: 'codex'` é aceito.

## CredentialSource

`credentials.codex = 'cli'` quando `enabled` e o executável é localizado. Caso contrário, `'none'`, e o status do provedor mostra "não configurado" com a dica de instalação.

## CodexStatus (resultado do `/auth`, nunca persistido)

| Campo | Tipo | Origem |
|---|---|---|
| `installed` | boolean | `locate` |
| `version` | string \| undefined | `codex --version` → `0.161.0` |
| `supported` | boolean | `version >= MIN_CODEX_VERSION` (`0.161.0`) |
| `loggedIn` | boolean | `codex login status`: "Logged in using …" ou "Not logged in" |
| `method` | `'chatgpt' \| 'api-key' \| 'other'` | só o tipo. O restante da linha é descartado (R9) |

Transições do diálogo (reaproveitando `login.*` do `authFlow`):

```text
login.detect ──(não instalado)──▶ login.install (dicas, tentar de novo)
     │
     └─(instalado)─▶ login.running ──(versão antiga)──▶ erro "atualize o Codex"
                          │──(Not logged in)──▶ erro "rode `codex login` num terminal"
                          │──(api-key)──▶ sucesso + aviso de créditos da OpenAI
                          └──(chatgpt)──▶ sucesso ("conta do ChatGPT") → habilita → oferece ativar
```

## CodexTurn (memória, um por pedido)

| Campo | Descrição |
|---|---|
| `dir` | pasta temporária `maestro-codex-*` com `instructions.md` (0600) e as imagens da última mensagem |
| `bridge` | `McpBridge` (url, token), só quando há ferramentas e `runTool` |
| `child` | processo `codex exec`, encerrado no Esc por `killTree` |
| `parser` | `CodexParserState`: `completed`, `usage`, `failure`, `messages` (contagem, para separar blocos), `warnings` (contagem) |

## CodexParserState → ProviderEvent

- `agent_message` → `text_delta` (prefixo `\n\n` a partir da segunda mensagem)
- `turn.completed` → `usage` + `done: end_turn`
- `turn.failed` / `error` → `failure` (o primeiro vence), depois `MaestroError` por `codexError`
- o resto → nada (os avisos só incrementam `warnings`)
