# Data Model: Maestro CLI (MVP)

**Feature**: `001-maestro-cli-mvp` | **Date**: 2026-10-24

Entidades derivadas da seção *Key Entities* da spec. Tipos expressos em TypeScript por serem a linguagem escolhida (research R2); os nomes abaixo são o contrato interno entre `config/`, `providers/`, `session/`, `tools/` e `ui/`.

---

## 1. Settings (Configuração)

Representa o conteúdo de `settings.json` após merge global → projeto → env → args.

```ts
type ProviderId = "claude" | "qwen";

interface Settings {
  activeProvider: ProviderId;          // provedor usado ao iniciar
  providers: {
    claude: ClaudeProviderSettings;
    qwen: QwenProviderSettings;
  };
  tools: {
    enabled: boolean;                  // liga/desliga US3 (padrão: true)
    commandTimeoutMs: number;          // padrão 60_000
    maxOutputChars: number;            // padrão 20_000
  };
  ui: {
    color: boolean;                    // padrão: auto (TTY && !NO_COLOR)
  };
}

interface ProviderSettingsBase {
  enabled: boolean;                    // "ativado nas configurações" (FR-008)
  model: string;
  maxTokens: number;                   // padrão 16_000
}

interface ClaudeProviderSettings extends ProviderSettingsBase {
  apiKey?: string;                     // opcional — padrão: resolução do SDK (env/perfil)
  baseUrl?: string;                    // opcional — proxies compatíveis
  effort: "low" | "medium" | "high" | "xhigh" | "max"; // padrão "medium"
  fallbacks: boolean;                  // padrão true (server-side refusal fallback)
}

interface QwenProviderSettings extends ProviderSettingsBase {
  apiKey?: string;                     // ou env DASHSCOPE_API_KEY
  baseUrl: string;                     // padrão https://dashscope.aliyuncs.com/compatible-mode/v1
}
```

**Validações (zod, `config/schema.ts`)**:
- `activeProvider` ∈ `ProviderId`.
- `baseUrl` deve ser URL absoluta `http(s)://`; barra final é removida na normalização.
- `model` não vazio; `maxTokens` inteiro 1..200_000.
- Campos desconhecidos → erro com caminho (`providers.qwen.apiKeyy: unknown key`).
- Campo `_comment` (string) é permitido em qualquer nível e ignorado, para instruções no arquivo gerado.

**Origem das credenciais (resolvida em `config/loader.ts`, registrada para exibição)**:

| Provedor | Ordem de resolução | `credentialSource` exibido |
|---|---|---|
| claude | `providers.claude.apiKey` → `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → perfil `ant` (delegado ao SDK) | `config` / `env` / `profile` / `none` |
| qwen | `DASHSCOPE_API_KEY` → `providers.qwen.apiKey` | `env` / `config` / `none` |

---

## 2. ProviderStatus (estado de um provedor)

Derivado de `Settings` + ambiente; usado por `/model` e pela verificação de pré‑voo.

```ts
interface ProviderStatus {
  id: ProviderId;
  displayName: string;                 // "Claude (Anthropic)", "Qwen (Alibaba Cloud)"
  enabled: boolean;
  configured: boolean;                 // credenciais resolvidas (claude: sempre true se SDK encontrar algo)
  active: boolean;                     // é o provedor da sessão atual
  model: string;
  credentialSource: "config" | "env" | "profile" | "none";
  maskedKey?: string;                  // "****abcd" quando a chave vem de config/env
  missing?: string[];                  // ex.: ["apiKey"] — o que falta para ficar configurado
}
```

**Regra**: `configured = enabled && missing.length === 0`. Um provedor `enabled: false` nunca aparece como ativo e `/model <id>` para ele responde "desativado na configuração".

---

## 3. Message (unidade do histórico, neutra entre provedores)

```ts
type Role = "user" | "assistant" | "tool";

interface Message {
  id: string;                          // uuid
  role: Role;
  content: ContentPart[];
  createdAt: Date;
  providerId?: ProviderId;             // só em role = "assistant"
  model?: string;                      // só em role = "assistant"
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_call"; callId: string; name: string; input: unknown }        // em assistant
  | { type: "tool_result"; callId: string; output: string; isError: boolean }; // em tool
```

**Regras**:
- O histórico começa sempre com `user`.
- Um `assistant` com `tool_call` é obrigatoriamente seguido por um `tool` com um `tool_result` para **cada** `callId` (mesmo que o usuário tenha recusado: `isError: true`, `output: "user declined"`).
- Mensagens vazias nunca entram no histórico (FR‑007).
- Conversão para o formato de cada SDK acontece apenas dentro do provedor (ver contracts/provider-interface.md).

---

## 4. Session

```ts
type SessionState = "idle" | "generating" | "awaiting_confirmation";

interface Session {
  cwd: string;
  activeProviderId: ProviderId;
  history: Message[];
  state: SessionState;
  pendingConfirmation?: PendingToolAction;
  abortController?: AbortController;   // presente em "generating"
}
```

**Máquina de estados**:

| De | Evento | Para | Efeito |
|---|---|---|---|
| idle | usuário envia texto | generating | push `user`; inicia turno; cria `AbortController` |
| generating | `text_delta` | generating | acumula na resposta parcial exibida |
| generating | `tool_call` que não exige confirmação | generating | executa; push `tool`; reenvia |
| generating | `tool_call` que exige confirmação | awaiting_confirmation | define `pendingConfirmation` |
| awaiting_confirmation | usuário aprova | generating | executa; push `tool`; reenvia |
| awaiting_confirmation | usuário recusa | generating | push `tool` com `isError: true`; reenvia |
| generating | `done` | idle | push `assistant`; limpa `abortController` |
| generating | Esc / Ctrl+C | idle | `abort()`; push `assistant` com conteúdo parcial (se não vazio) |
| generating | `error` | idle | exibe `MaestroError`; **não** faz push de assistant vazio |
| idle | `/clear` | idle | `history = []` |
| idle | `/model <id>` | idle | troca `activeProviderId`; histórico preservado |
| qualquer | `/exit` ou Ctrl+C duplo | (encerra) | aborta geração em curso; sai com código 0 |

**Invariantes**: só existe um turno em andamento por vez; `/model` e `/clear` são rejeitados com aviso enquanto `state !== "idle"`.

---

## 5. ToolDefinition e PendingToolAction

```ts
interface ToolDefinition<I = unknown> {
  name: "read_file" | "list_directory" | "write_file" | "run_command";
  description: string;                 // enviado ao modelo
  inputSchema: ZodSchema<I>;           // validado antes de executar (input do modelo é não confiável)
  requiresConfirmation: boolean;       // write_file, run_command = true
  preview?: (input: I, ctx: ToolContext) => Promise<string>; // texto exibido antes da confirmação (diff, comando)
  run: (input: I, ctx: ToolContext) => Promise<ToolResult>;
}

interface ToolContext { cwd: string; signal: AbortSignal; settings: Settings["tools"]; }
interface ToolResult { output: string; isError: boolean; }

interface PendingToolAction {
  callId: string;
  tool: ToolDefinition;
  input: unknown;
  previewText: string;
  resolve: (approved: boolean) => void;
}
```

**Validações de sandbox (`tools/sandbox.ts`)**: `resolved = path.resolve(cwd, input.path)`; rejeita se `!resolved.startsWith(cwd + path.sep) && resolved !== cwd`; rejeita symlink que escape de `cwd` (`fs.realpath`). Erro → `ToolResult { isError: true, output: "path outside workspace" }` e aviso na UI (FR‑022).

---

## 6. MaestroError (erro apresentado ao usuário)

```ts
interface MaestroError {
  providerId?: ProviderId;
  category: "auth" | "network" | "rate_limit" | "context_length" | "invalid_config" | "provider" | "tool" | "unknown";
  message: string;                     // humano, sem segredos
  hint?: string;                       // ex.: "Run `ant auth login` or export ANTHROPIC_API_KEY"
  cause?: unknown;                     // erro original, só em --debug
}
```

**Mapeamento (em `utils/errors.ts`)**:

| Origem | category |
|---|---|
| `Anthropic.AuthenticationError`, `OpenAI.AuthenticationError`, 401/403 | auth |
| `APIConnectionError`, `ECONNREFUSED`, `ENOTFOUND`, timeout | network |
| `RateLimitError`, 429 | rate_limit |
| 400 com mensagem contendo "context"/"too long"/"maximum context" | context_length |
| zod error no `settings.json` | invalid_config |
| outros `APIError` | provider |

---

## Relações

```text
Settings 1──* ProviderStatus (um por ProviderId)
Session  1──1 ProviderId ativo
Session  1──* Message (ordenadas)
Message(assistant) 1──* ContentPart(tool_call) 1──1 ContentPart(tool_result) na Message(tool) seguinte
ToolDefinition *──1 registry; PendingToolAction 1──1 ToolDefinition
```
