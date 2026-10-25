# Data Model — Histórico de Entradas e Catálogo de Modelos por Provedor

**Branch**: `004-history-model-catalog` · **Date**: 2026-10-25

## 1. Histórico de entradas

### 1.1 Entrada (linha do `history.jsonl`)

```ts
interface HistoryEntry {
  t: string;    // ISO-8601 do envio (informativo; não usado na navegação)
  text: string; // entrada exatamente como enviada (pode ter '\n')
}
```

Regras: `text.trim() !== ''`; linhas que não forem JSON válido com `text: string` são ignoradas na carga.

### 1.2 `InputHistory` (memória)

```ts
interface InputHistory {
  readonly entries: readonly string[]; // mais antiga → mais recente, ≤ HISTORY_LIMIT
  push(text: string): boolean;         // false se vazio ou igual à última; true se acrescentou (e persistiu)
}
const HISTORY_LIMIT = 1000;
const HISTORY_COMPACT_AT = 2000; // linhas no arquivo que disparam reescrita na carga
```

### 1.3 `HistoryStore` (efeito injetável)

```ts
interface HistoryStore {
  load(): string[];          // nunca lança; [] em erro (motivo vai para o logger)
  append(text: string): void; // nunca lança
}
```

Implementações: `fileHistoryStore(path, logger)` (produção) e `memoryHistoryStore()` (testes / `-p`).

### 1.4 Navegação (pura)

```ts
interface HistoryCursor {
  index: number | null; // null = editando (fora do histórico)
  draft: string;        // texto em edição guardado ao entrar no histórico
}
type Dir = 'up' | 'down';
function historyNavigate(
  cursor: HistoryCursor, dir: Dir, items: readonly string[], current: string,
): { cursor: HistoryCursor; value: string };
```

Transições:

| Estado | Tecla | Resultado |
|---|---|---|
| `index=null`, `items` vazio | ↑ | sem mudança |
| `index=null` | ↑ | `draft=current`, `index=len-1`, `value=items[len-1]` |
| `index=i>0` | ↑ | `index=i-1`, `value=items[i-1]` |
| `index=0` | ↑ | sem mudança (mais antiga) |
| `index=null` | ↓ | sem mudança |
| `index=i<len-1` | ↓ | `index=i+1`, `value=items[i+1]` |
| `index=len-1` | ↓ | `index=null`, `value=draft` |
| qualquer | Enter | envia `value`; `cursor={null,''}` |
| qualquer | digitação | `value` muda; o cursor **sai** do histórico (`index=null`, `draft=''`) — o texto editado é o novo rascunho |

## 2. Catálogo de modelos

### 2.1 `settings.json`

```jsonc
"providers": {
  "claude": {
    "model": "claude-opus-5-5",
    "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]
  },
  "qwen": {
    "model": "qwen3-coder-plus",
    "models": ["qwen3-coder-plus", "qwen3-coder-flash", "qwen3-max"]
  }
}
```

Esquema: `models: string[]` opcional; cada item `^\S+$`; sem repetidos; `[]` ≡ ausente → padrão do provedor (`DEFAULTS.<id>.models`).

Mensagens de validação (prefixadas pelo caminho):

| Caso | Mensagem |
|---|---|
| item vazio / com espaço | `providers.qwen.models.1: must be a single non-empty token` |
| repetido | `providers.qwen.models: duplicate model 'qwen3-max'` |
| tipo errado | `providers.qwen.models: expected array` (texto do zod formatado por `formatZodIssues`) |

### 2.2 Catálogo efetivo

```ts
function modelCatalog(settings: Settings, id: ProviderId): string[];
// = dedupe([...settings.providers[id].models, settings.providers[id].model])
```

Invariantes: nunca vazio; contém o modelo configurado; ordem do arquivo preservada (modelo configurado fora da lista vai ao fim).

### 2.3 Aprender um modelo

```ts
function learnModelPatch(globalRaw: Json, id: ProviderId, model: string): SettingsPatchEntry[];
// [] se `model` já está em providers.<id>.models do arquivo global bruto (ou é o padrão quando a chave está ausente);
// senão [{ path: `providers.${id}.models`, value: [...atual-ou-padrão, model] }]
```

## 3. `ModelFlowState` (revisado)

```ts
interface ModelEntry {
  providerId: ProviderId;
  model: string;
  active: boolean;        // provedor ativo E modelo ativo
  configured: boolean;    // do ProviderStatus; false → entrada desativada
  credentialSource: CredentialSource;
  maskedKey?: string;
}
interface ProviderChoice { id: ProviderId; configured: boolean; hint?: string }

type ModelFlowState =
  | { step: 'list'; items: ModelEntry[]; selected: number }   // selected === items.length → "Digitar outro modelo…"
  | { step: 'customProvider'; providers: ProviderChoice[]; selected: number }
  | { step: 'custom'; providerId: ProviderId; value: string; error?: string }
  | { step: 'applying'; providerId: ProviderId; model: string; learn: boolean }
  | { step: 'done'; providerId: ProviderId; model: string; warning?: string }
  | { step: 'failed'; error: string }
  | { step: 'closed' };

type ModelFlowEvent =
  | { type: 'up' } | { type: 'down' } | { type: 'enter' } | { type: 'back' } | { type: 'cancel' }
  | { type: 'input'; value: string }
  | { type: 'applied'; warning?: string }
  | { type: 'applyError'; error: string };
```

Transições novas/alteradas:

| De | Evento | Para |
|---|---|---|
| `list` (custom selecionado) | enter | `customProvider` (selected = provedor ativo se configurado, senão primeiro configurado, senão 0) |
| `customProvider` | up/down | próximo provedor **configurado** (cíclico); se nenhum, mantém |
| `customProvider` | enter | `custom { providerId, value: modelo atual do provedor }` se configurado; senão sem mudança |
| `customProvider` | back | `list` (itens re‑semeados pelo driver) |
| `custom` | back | `customProvider` |
| `custom` | enter (não vazio) | `applying { learn: !catalog.includes(model) }` — `catalog` fornecido ao reducer como parâmetro `catalogs: Record<ProviderId, string[]>` |
| `applying` | applied | `done { warning? }` |
| `applying` | applyError | `failed` |

`initialModelFlow(statuses, settings, activeModel)` constrói `items` percorrendo os provedores na ordem `PROVIDER_IDS` e, para cada um, `modelCatalog(settings, id)`; `active` quando `s.active && model === activeModel`; se o modelo ativo não estiver no catálogo (ex.: `--model`), é inserido como última entrada do grupo.

## 4. Controller

```ts
interface ControllerOptions {
  // …existentes
  history?: InputHistory; // ausente em -p e em testes que não precisam
}
class SessionController {
  readonly history?: InputHistory;
  submit(input) { this.history?.push(input); /* antes de executeSlash */ … }
  rememberModel(id: ProviderId, model: string): SettingsPatchEntry[]; // learnModelPatch sobre readRawSettings(global)
  persistActive(model?: string): void; // + rememberModel quando model informado
}
```

`useSession` expõe `historyItems: controller.history?.entries ?? []` (substitui `userInputs`).
