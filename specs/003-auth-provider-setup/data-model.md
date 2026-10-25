# Data Model: Configuração de Provedores pela Sessão (/auth) e Seleção de Modelo (/model)

**Feature**: `003-auth-provider-setup` | **Date**: 2026-10-24

---

## 1. ConnectionMethod (`src/setup/methods.ts`)

```ts
type MethodId = 'claude-api' | 'claude-login' | 'qwen';

interface FieldSpec {
  key: 'protocol' | 'apiKey' | 'baseUrl' | 'model';
  label: string;
  kind?: 'text' | 'choice';   // choice: ↑↓ escolhe entre `options`
  options?: { value: string; label: string; description?: string }[];
  secret: boolean;            // digitação mascarada, exibição ****xxxx
  required: boolean;
  default?: string;           // pré-preenchido
  defaultFor?: (values) => string | undefined; // padrão dependente (endpoint por protocolo)
  knownDefaults?: readonly string[];           // valores tratados como "não editados"
  hint?: string;              // ex.: endpoints DashScope alternativos
  validate: (value: string) => string | undefined; // mensagem de erro
}

interface ConnectionMethod {
  id: MethodId;
  label: string;              // "Claude API" | "Claude Auth Login" | "Qwen"
  description: string;
  providerId: ProviderId;     // claude | qwen
  kind: 'fields' | 'login';
  fields: FieldSpec[];        // ordem de exibição
}
```

| id | fields (ordem) | padrões |
|---|---|---|
| `claude-api` | `apiKey` (secret, required), `baseUrl` (opcional), `model` (default `claude-opus-5-5`) | — |
| `claude-login` | — (kind `login`) | modelo mantém o configurado |
| `qwen` | `baseUrl` (default DashScope, hint intl), `apiKey` (secret, required), `model` (default `qwen3-coder-plus`) | — |

**Estado derivado por método** (`MethodStatus`): `not_configured` | `configured` | `active`, com `credentialSource` do `ProviderStatus` existente.

---

## 2. DialogState (no `SessionController`)

```ts
type DialogState =
  | { type: 'auth'; flow: AuthFlowState }
  | { type: 'model'; flow: ModelFlowState };
```

Invariantes: no máximo um diálogo aberto; só pode abrir com `session.state === 'idle'`; enquanto aberto, `InputPrompt` inativo e `useKeyboard` em modo diálogo; `/clear`, `/model`, `/auth` por texto são ignorados com aviso enquanto aberto.

---

## 3. AuthFlowState (`src/setup/authFlow.ts`)

```ts
type AuthFlowState =
  | { step: 'menu'; selected: number; methods: Array<{ method: ConnectionMethod; status: MethodStatus }> }
  | { step: 'fields'; method: ConnectionMethod; index: number; values: Record<string, string>; error?: string; editing: boolean /* provedor já configurado */ }
  | { step: 'testing'; method: ConnectionMethod; values: Record<string, string> }
  | { step: 'testFailed'; method: ConnectionMethod; values: Record<string, string>; result: ConnectionTestResult; selected: 0 | 1 | 2 /* corrigir | gravar sem testar | voltar */ }
  | { step: 'saving'; method: ConnectionMethod; values: Record<string, string>; verified: boolean }
  | { step: 'saveFailed'; method: ConnectionMethod; error: string }
  | { step: 'activate'; method: ConnectionMethod; selected: 0 | 1 /* sim | não */; warnings: string[] }
  | { step: 'done'; method: ConnectionMethod; activated: boolean; warnings: string[] }
  | { step: 'login.detect' }
  | { step: 'login.missing'; hints: string[]; selected: 0 | 1 /* tentar novamente | voltar */ }
  | { step: 'login.running'; url?: string; startedAt: number }
  | { step: 'login.failed'; reason: string; selected: 0 | 1 }
  | { step: 'login.done'; warnings: string[] }; // segue para 'activate'

type AuthFlowEvent =
  | { type: 'up' } | { type: 'down' } | { type: 'enter' } | { type: 'back' } | { type: 'cancel' }
  | { type: 'input'; value: string }                       // texto do campo atual
  | { type: 'testResult'; result: ConnectionTestResult }
  | { type: 'saved' } | { type: 'saveError'; error: string }
  | { type: 'antDetected'; found: boolean; hints: string[] }
  | { type: 'loginOutput'; url?: string }
  | { type: 'loginExit'; ok: boolean; reason?: string; warnings: string[] }
  | { type: 'activated'; warnings: string[] };
```

**Transições principais**:

| De | Evento | Para |
|---|---|---|
| menu | up/down | menu (seleção circular) |
| menu | enter em `fields` | fields(index 0, valores = atuais ou padrões, editing = configurado) |
| menu | enter em `login` | login.detect (efeito: `locateAnt`) |
| menu | back/cancel | fecha o diálogo |
| fields | input | fields (valores atualizados, erro limpo) |
| fields | enter | valida campo: erro → fields(error); ok → próximo campo ou **testing** (efeito: `testConnection`) |
| fields | back | campo anterior, ou menu se index 0 |
| testing | testResult ok | saving(verified true) (efeito: `writeSettings`) |
| testing | testResult falha | testFailed |
| testing | cancel | fields (último campo) |
| testFailed | enter "corrigir" | fields no campo indicado por `result.field` |
| testFailed | enter "gravar sem testar" | saving(verified false) |
| testFailed | enter "voltar" | menu |
| saving | saved | activate(warnings: sobrescrita por projeto, env com precedência) |
| saving | saveError | saveFailed |
| saveFailed | enter | menu |
| activate | enter "sim" | done(activated true) (efeito: `switchProvider` + gravar `activeProvider`) |
| activate | enter "não" / back | done(activated false) |
| done | enter/back/cancel | fecha o diálogo |
| login.detect | antDetected found | login.running (efeito: `runLogin`) |
| login.detect | antDetected !found | login.missing |
| login.missing | enter "tentar novamente" | login.detect |
| login.missing | enter "voltar" / back | menu |
| login.running | loginOutput | login.running(url) |
| login.running | loginExit ok | login.done → activate |
| login.running | loginExit !ok | login.failed(reason) |
| login.running | cancel/back | menu (efeito: kill do processo) |
| login.failed | enter "tentar novamente" | login.detect |
| login.failed | enter "voltar" | menu |

`cancel` (Esc) em qualquer estado sem transição própria → fecha o diálogo sem gravar.

---

## 4. ModelFlowState (`src/setup/modelFlow.ts`)

> **Superseded (2026-10-25)** pela feature 004: a lista passou a ter uma entrada por modelo (`ModelEntry`), ganhou a etapa `customProvider` e o reducer recebe um contexto `{ statuses, settings, activeModel }`. Ver `specs/004-history-model-catalog/data-model.md` § 3. O texto abaixo descreve a versão original.

```ts
interface ModelItem {
  providerId: ProviderId;
  model: string;
  active: boolean;
  configured: boolean;        // itens não configurados são exibidos desativados
  credentialSource: CredentialSource;
  maskedKey?: string;
}

type ModelFlowState =
  | { step: 'list'; items: ModelItem[]; selected: number }           // último item virtual: "Digitar outro modelo…"
  | { step: 'custom'; providerId: ProviderId; value: string; error?: string }
  | { step: 'applying'; providerId: ProviderId; model: string }
  | { step: 'done'; providerId: ProviderId; model: string }
  | { step: 'failed'; error: string };
```

Transições: `list` up/down pulam itens desativados; enter em item → `applying` (efeito: `switchProvider` + patch `activeProvider`/`providers.<id>.model`); enter em "Digitar outro modelo…" → `custom` com o provedor do item destacado; `custom` enter → `applying`; `applying` saved → `done` → fecha; erro → `failed` → enter fecha.

---

## 5. ConnectionTestResult (`src/setup/connectionTest.ts`)

```ts
type ConnectionTestResult =
  | { ok: true; latencyMs: number }
  | { ok: false; category: 'auth' | 'network' | 'timeout' | 'model' | 'provider'; message: string; field?: 'protocol' | 'apiKey' | 'baseUrl' | 'model' };
```

Mapeamento: `auth` → `apiKey`; `network`/`timeout` → `baseUrl`; `model` (404 / "model not found") → `model`; `provider` → sem campo (mostra mensagem).

---

## 6. LoginResult e AntCli (`src/setup/antCli.ts`)

```ts
interface AntLocation { path: string; source: 'PATH' | 'default-dir' }
interface LoginRun { url?: string; promise: Promise<LoginResult>; cancel(): void }
type LoginResult = { ok: true; summary: string } | { ok: false; reason: string; cancelled?: boolean };
interface AntStatus { loggedIn: boolean; summary: string }  // summary = linha "Logged in to …" ou "not configured"
```

Argumentos exatos: `ant auth login --timeout 5m`; `ant auth status`.

---

## 7. SettingsPatch (`src/config/writer.ts`)

```ts
type SettingsPatch = Array<{ path: string; value: unknown }>; // ex.: { path: 'providers.qwen.apiKey', value: 'sk-…' }
interface WriteResult { path: string; overriddenByProject: string[] }  // caminhos que o ./.maestro/settings.json sobrescreve
```

Regras: ler bruto → aplicar patch (criando objetos intermediários) → `settingsSchema.safeParse` (falha = não grava) → escrever `settings.json.tmp` → renomear. `_comment` e chaves desconhecidas no arquivo do usuário são preservadas (o schema é `strict`, portanto chaves desconhecidas já causariam erro na carga; o writer só preserva `_comment`).

---

## 8. Alterações em entidades existentes

- `ProviderStatus`: + `verified?: boolean` (false quando gravado sem teste e ainda sem resposta bem‑sucedida).
- `SessionController`: + `dialog`, `openDialog(type)`, `closeDialog()`, `dispatchDialog(event)`, `applySettings(settings, credentialSources)`; `interactive === false` faz `/auth` e `/model` (sem args) emitirem apenas aviso.
