# Contract: eventos do `codex exec --json`

`parseCodexLine(line, st)` é puro e devolve `ProviderEvent[]`. Linhas que não são JSON ou têm tipo desconhecido são ignoradas.

| Linha (observada no 0.161.0) | Saída |
|---|---|
| `{"type":"item.completed","item":{"type":"agent_message","text":"T"}}` | `text_delta "T"` (a partir da 2ª mensagem, `"\n\n" + T`) |
| `{"type":"turn.completed","usage":{"input_tokens":I,"cached_input_tokens":C,"output_tokens":O,"reasoning_output_tokens":R}}` | `st.completed = true`, `st.usage = {inputTokens: I, outputTokens: O + R}` |
| `{"type":"error","message":M}` | `st.failure ??= M` |
| `{"type":"turn.failed","error":{"message":M}}` | `st.failure ??= M` |
| `{"type":"item.completed","item":{"type":"error",…}}` | `st.warnings++` (não fatal) |
| `thread.started`, `turn.started`, `item.started`, `item.updated`, `reasoning`, `mcp_tool_call` | nada |

No fim do processo (`codex.ts`):

1. cancelado → `done: cancelled`
2. erro de spawn → `ENOENT`: `invalid_config` (não encontrado), outro: `provider`
3. `st.failure` → `error: codexError(st.failure)`
4. sem `st.completed` → `provider`: "o Codex terminou sem resposta (código N): <última linha do stderr, redigida>"
5. senão → `usage` (se houver) e `done: end_turn`

## `codexError(message, now)` → `MaestroError` (providerId `codex`)

Quando `message` contém um JSON (`{"type":"error","status":S,"error":{"message":m,"code":k}}`), `S`, `m` e `k` saem dele. Sem JSON, a mensagem é usada inteira. O texto sempre passa por `redact`.

| Condição (na ordem) | Categoria | Mensagem / extras |
|---|---|---|
| `S` 429, `k = usage_limit_reached` ou o texto contém `usage limit` / `rate limit` | `rate_limit` | `retryAfterMs` vem de `try again in N s`/`ms`/`seconds`, ou de `try again at <data>` menos `now` mais 5 s, quando for possível interpretar |
| `S` 401/403, ou o texto contém `not logged in` / `log in` / `login` | `auth` | dica: "faça login no Codex: rode `codex login` num terminal" |
| `k = model_not_found` | `provider` | `m` (ex.: "The 'x' model is not supported when using Codex with a ChatGPT account.") |
| outro | `provider` | `m` ou o texto |
