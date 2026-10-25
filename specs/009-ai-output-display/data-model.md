# Data Model: Exibição da IA

Tudo aqui é estado em memória. Nada é persistido, nada vai ao modelo e nada vai ao log além de contagens.

## 1. Activity (`src/session/activity.ts`)

Estado efêmero do turno em andamento. Existe só entre o início e o fim do turno.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `phase` | `'waiting' \| 'responding' \| 'tool' \| 'confirm' \| 'question'` | começa em `waiting` |
| `verb` | `string` | sorteado de `WAIT_VERBS` no início; não muda no turno |
| `tool` | `string?` | rótulo da ferramenta em execução (fase `tool`) |
| `startedAt` | `number` | epoch ms do envio |
| `realOut` | `number` | soma dos `outputTokens` informados pelo provedor |
| `realIn` | `number` | soma dos `inputTokens` informados |
| `estChars` | `number` | caracteres recebidos desde o último `usage` (zera a cada `usage`) |
| `anyReal` | `boolean` | algum `usage` já chegou |

Valor exibido: `outTokens = realOut + ceil(estChars / 4)`. Ele é aproximado (`~`) enquanto `anyReal` for falso.

**Eventos e transições:**

| Evento | Efeito |
| --- | --- |
| `start { at, verb }` | estado novo, com `phase: waiting` |
| `delta { chars }` | `estChars += chars`; `phase: responding` (quando não está em `tool`, `confirm` ou `question`) |
| `usage { input, output }` | `realIn += input`; `realOut += output`; `estChars = 0`; `anyReal = true` |
| `toolStart { label }` | `phase: tool`; `tool = label` |
| `toolEnd` | `phase: waiting`; `tool = undefined` |
| `confirm { pending }` | `phase: confirm` com pending, ou volta a `waiting` sem ele |
| `question { pending }` | `phase: question` com pending, ou volta a `waiting` sem ele |

`summarize(state, { at, cancelled }) → TurnSummary`.

## 2. TurnSummary

| Campo | Tipo |
| --- | --- |
| `elapsedMs` | `number` |
| `outTokens` | `number` |
| `approximate` | `boolean` |
| `cancelled` | `boolean` |

Texto: `✻ 13s · ↓ 304 tokens`, ou `✻ interrompido · 4s · ↓ ~20 tokens`.

## 3. ToolResultDisplay (`ToolResult.display` → `ContentPart tool_result.display`)

Metadados de exibição. Os conversores de provedor não copiam este campo.

| Campo | Tipo | Origem |
| --- | --- | --- |
| `diff` | `FileDiff?` | `tool.diff(input)`, calculado antes da escrita |
| `autoMode` | `ApprovalMode?` | a ação foi liberada pelo modo |
| `declined` | `boolean?` | o usuário recusou |
| `speckitStep` | `string?` | o passo nativo do Spec Kit |
| `summary` | `string?` | resumo do passo do Spec Kit |

## 4. FileDiff (`src/tools/diff.ts`)

| Campo | Tipo | Regra |
| --- | --- | --- |
| `path` | `string` | caminho relativo, como foi pedido |
| `kind` | `'new' \| 'edit' \| 'unchanged' \| 'eol' \| 'binary' \| 'large'` | ver research R8 |
| `added` | `number` | linhas `+` |
| `removed` | `number` | linhas `-` |
| `newLines` | `number` | total de linhas do conteúdo novo |
| `hunks` | `DiffHunk[]` | vazio para `unchanged`, `eol`, `binary` e `large` |

`DiffHunk = { lines: DiffLine[] }`

`DiffLine = { type: '+' | '-' | ' '; oldNo?: number; newNo?: number; text: string }`

O texto não traz o fim de linha.

**Invariantes:**
- `added` é o número de linhas `+` em `hunks`, e `removed` o de linhas `-`.
- Os números de linha são crescentes dentro de cada trecho.
- Há no máximo 3 linhas de contexto (`' '`) antes e depois de cada mudança.
- `kind: 'new'` equivale a um trecho com todas as linhas `+`, numeradas de 1 em diante.

## 5. ToolDisplay (`src/ui/toolDisplay.ts`, derivado)

`describeCall(name, input, platform) → { label, arg }`

`describeResult(name, input, part) → { tone: 'ok' | 'error' | 'muted', lines: string[], diff?: FileDiff, more?: number }`

## 6. Mudanças em tipos existentes

- `ToolDefinition.diff?: (input, ctx) => Promise<FileDiff>`, implementado só por `write_file`.
- `ToolResult.display?: ToolResultDisplay`.
- `PendingToolAction.diff?: FileDiff`.
- `ContentPart` `tool_result` ganha `display?: ToolResultDisplay`.
- `TurnCallbacks.onUsage?: (inputTokens, outputTokens) => void`.
- `SessionController.activity?: Activity`, exposto no snapshot do `useSession`.
