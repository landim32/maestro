# Contract: Interface de Provedores de Modelo

**Feature**: `001-maestro-cli-mvp` | **Arquivo**: `src/providers/types.ts`

Este é o contrato interno que torna os provedores plugáveis (FR‑028). A sessão (`session/turn.ts`) depende **apenas** desta interface; nenhum tipo de SDK atravessa esta fronteira.

## 1. Interface

```ts
import type { Message, ProviderId, ProviderStatus } from "./types.js";
import type { ToolDefinition } from "../tools/types.js";

export interface ProviderRequest {
  messages: Message[];            // histórico neutro completo (ver data-model § 3)
  system: string;                 // system prompt do Maestro (fixo por sessão)
  tools: ToolDefinition[];        // [] quando ferramentas desligadas
  model?: string;                 // sobrescrita por sessão; senão o da config
  signal: AbortSignal;            // cancelamento (Esc / Ctrl+C / -p interrompido)
}

export type ProviderEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; callId: string; name: string; input: unknown }  // emitido quando o bloco fecha (input já parseado)
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "cancelled" }
  | { type: "error"; error: MaestroError };

export interface ModelProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  status(): ProviderStatus;                              // sem rede
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
}

export type ProviderFactory = (settings: Settings) => ModelProvider;
```

## 2. Garantias que todo provedor deve cumprir

1. **Ordem**: zero ou mais `text_delta` / `tool_call`, no máximo um `usage`, e exatamente um evento terminal (`done` **ou** `error`). Nada depois do terminal.
2. **Cancelamento**: ao `signal.abort()`, o provedor encerra o stream e emite `done` com `stopReason: "cancelled"` em até 500 ms; não emite `error` por cancelamento.
3. **`tool_call`** só é emitido com `input` já convertido para objeto JSON (argumentos em string JSON são parseados pelo provedor; falha de parse → `error` com `category: "provider"`).
4. **Erros** são sempre mapeados para `MaestroError` (data-model § 6) com `providerId` preenchido; nunca vaza exceção do SDK pelo iterador.
5. **Segredos** nunca aparecem em `MaestroError.message`/`hint`.
6. **Sem efeitos colaterais**: o provedor não executa ferramentas nem altera o histórico; isso é responsabilidade de `session/turn.ts`.
7. **`status()`** não faz rede: verifica apenas config/env (e, no Claude, se o SDK consegue resolver alguma credencial).

## 3. Loop de turno (em `session/turn.ts`, independente de provedor)

```text
loop:
  events = provider.stream({ messages: history, system, tools, signal })
  consume events → UI (text_delta), coleta tool_calls
  on done(stopReason):
    "tool_use"  → para cada tool_call: validar input (zod) → se requiresConfirmation: UI pede y/n
                  → executar ou recusar → push Message(tool, tool_result)
                  → push Message(assistant, [text..., tool_call...]) ANTES dos resultados
                  → repetir loop
    "end_turn"  → push Message(assistant, text); fim
    "max_tokens"→ push parcial; avisar "response truncated (max_tokens)"; fim
    "refusal"   → avisar "the provider declined this request"; fim
    "cancelled" → push parcial se não vazio; fim
  on error → exibir MaestroError; fim (histórico sem assistant vazio)
```

Limite de segurança: no máximo **10 iterações** de ferramenta por turno; ao exceder, o turno termina com aviso.

## 4. Mapeamento por provedor

### 4.1 `claude` (`@anthropic-ai/sdk`)

| Maestro | SDK |
|---|---|
| Cliente | `new Anthropic({ apiKey?, baseURL? })` — sem argumentos quando a config não define nada (resolve env/perfil) |
| Chamada | `client.beta.messages.stream({ model, max_tokens, system, messages, tools, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort } })` quando `fallbacks: true`; senão `client.messages.stream({...})` sem `betas`/`fallbacks` |
| `thinking` | omitido (adaptativo por padrão no Opus 5.5; `disabled`/`budget_tokens` retornam 400) |
| `Message(user, text)` | `{ role: "user", content: text }` |
| `Message(assistant, [text, tool_call])` | `{ role: "assistant", content: [{type:"text",text}, {type:"tool_use", id: callId, name, input}] }` |
| `Message(tool, [tool_result...])` | `{ role: "user", content: [{type:"tool_result", tool_use_id: callId, content: output, is_error}] }` — **todos** os resultados do mesmo turno em uma única mensagem |
| `ToolDefinition` | `{ name, description, input_schema: zodToJsonSchema(inputSchema), strict: true }` |
| `text_delta` | evento `content_block_delta` com `delta.type === "text_delta"` |
| `tool_call` | ao `content_block_stop` de um bloco `tool_use` (input acumulado de `input_json_delta` e parseado) |
| `done.stopReason` | `finalMessage().stop_reason` mapeado 1:1; `refusal` lê `stop_details` para a mensagem |
| Erros | `AuthenticationError`→auth; `APIConnectionError`→network; `RateLimitError`→rate_limit; `BadRequestError` com "context"/"prompt is too long"→context_length; `APIError`→provider |
| Hint de auth | `"No Claude credentials found. Run 'ant auth login' or export ANTHROPIC_API_KEY."` |

### 4.2 `qwen` (`openai`, DashScope compatible‑mode)

| Maestro | SDK |
|---|---|
| Cliente | `new OpenAI({ apiKey, baseURL })` — `apiKey` obrigatório (status `not configured` se ausente) |
| Chamada | `client.chat.completions.create({ model, max_tokens, messages, tools, stream: true, stream_options: { include_usage: true } }, { signal })` |
| `system` | primeira mensagem `{ role: "system", content }` |
| `Message(user, text)` | `{ role: "user", content: text }` |
| `Message(assistant, [text, tool_call])` | `{ role: "assistant", content: text \|\| null, tool_calls: [{ id: callId, type: "function", function: { name, arguments: JSON.stringify(input) } }] }` |
| `Message(tool, [tool_result])` | uma mensagem `{ role: "tool", tool_call_id: callId, content: output }` **por resultado** (erros vão como texto prefixado `"ERROR: "`) |
| `ToolDefinition` | `{ type: "function", function: { name, description, parameters: zodToJsonSchema(inputSchema) } }` |
| `text_delta` | `chunk.choices[0].delta.content` |
| `tool_call` | acumula `delta.tool_calls[i].function.arguments` por índice; emite ao `finish_reason` (`"tool_calls"`) após `JSON.parse` |
| `done.stopReason` | `stop`→end_turn; `tool_calls`→tool_use; `length`→max_tokens; `content_filter`→refusal |
| `usage` | último chunk com `usage` (graças a `include_usage`) |
| Erros | `OpenAI.AuthenticationError`→auth; `APIConnectionError`→network; `RateLimitError`→rate_limit; 400 com "context length"/"maximum context"→context_length; `APIError`→provider |
| Hint de auth | `"Qwen API key missing or invalid. Set DASHSCOPE_API_KEY or providers.qwen.apiKey in settings.json."` |

### 4.3 `fake` (apenas testes, `tests/helpers/fakeProvider.ts`)

Implementa `ModelProvider` com um roteiro de eventos pré‑definido. Usado por testes de `session/turn.ts`, do modo `-p` e da UI. Não é registrado em produção.

## 5. Registro

```ts
// src/providers/registry.ts
const factories: Record<ProviderId, ProviderFactory> = { claude: createClaudeProvider, qwen: createQwenProvider };
export function createProvider(id: ProviderId, settings: Settings): ModelProvider;
export function listStatuses(settings: Settings, activeId: ProviderId): ProviderStatus[];
```

Adicionar um provedor = criar `providers/<id>.ts` que exporta uma `ProviderFactory`, registrar em `factories` e estender `ProviderId` + schema de config. Nenhuma mudança em `session/`, `tools/` ou `ui/`.

## 6. Testes de contrato derivados

- Para cada provedor real (com SDK mockado) e para o `fake`: as garantias 1–4 da § 2 (ordem de eventos, cancelamento em ≤ 500 ms, `tool_call` com objeto, erro mapeado).
- Fixtures de conversão: histórico neutro com `user → assistant(tool_call) → tool → assistant(text)` convertido para o formato Anthropic e para o formato OpenAI, comparados com snapshots.
- `status()` de cada provedor nos cenários: sem credenciais, credencial por env, credencial por config.
