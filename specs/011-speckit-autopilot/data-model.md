# Data Model: Modo autopiloto

## 1. Story (`stories.ts`)

| Campo | Tipo | Regra |
| --- | --- | --- |
| `index` | `number` | posição no arquivo, a partir de 1 |
| `title` | `string` | texto do título `##`, ou o primeiro parágrafo quando o arquivo não tem títulos |
| `body` | `string` | texto até o próximo `##`, sem espaços nas pontas; não pode ser vazio |
| `hash` | `string` | sha256 de `title + body`, usado para detectar mudança na retomada |

## 2. AutopilotSettings (`settings.autopilot`)

| Chave | Tipo | Padrão |
| --- | --- | --- |
| `verify.command` | `string[]` | derivado do `package.json` (scripts `test`, `lint`, `build` existentes) |
| `verify.maxAttempts` | `int 0–10` | 3 |
| `verify.timeoutMs` | `int ≥ 1000` | 600000 |
| `limits.turns` | `0` (sem limite) ou `int ≥ 7` | 0 |
| `limits.minutes` | `int ≥ 0` (0 = sem limite; esperas por limite de taxa não contam) | 0 |
| `limits.tokens` | `int ≥ 0` (0 = sem teto) | 0 |
| `commitPrefix` | `'fix:' \| 'feat:'` | `'fix:'` |
| `push` | `boolean` | `false` |
| `merge` | `boolean` (exige `push`) | `false` |
| `prBase` | `string?` | branch em que a execução começou |

## 3. Run (`.specify/autopilot.json`)

| Campo | Tipo | Regra |
| --- | --- | --- |
| `version` | `1` | |
| `id` | `string` | `YYYYMMDD-HHMMSS` |
| `input` | `string` | caminho relativo do arquivo de histórias |
| `inputHash` | `string` | sha256 do arquivo |
| `baseBranch` | `string` | branch do início |
| `status` | `'active' \| 'interrupted' \| 'stopped' \| 'done'` | |
| `pid` | `number` | processo dono quando `active` |
| `stopped?` | `{ story, step, gate, reason }` | quando `stopped` |
| `stories` | `StoryRun[]` | |

## 4. StoryRun

| Campo | Tipo |
| --- | --- |
| `title`, `hash` | da Story |
| `feature?` | `NNN-nome`, depois do specify |
| `branch?` | igual à feature |
| `status` | `'pending' \| 'running' \| 'done' \| 'stopped'` |
| `usage` | `{ turns, ms, inputTokens, outputTokens }` |
| `steps` | `Record<StepName, StepRun>` |
| `pr?` | `{ url, number }` |

`StepName = 'specify' | 'clarify' | 'plan' | 'tasks' | 'analyze' | 'implement' | 'verify'`.

## 5. StepRun

| Campo | Tipo |
| --- | --- |
| `status` | `'pending' \| 'running' \| 'done' \| 'failed' \| 'interrupted'` |
| `rounds` | `number`: turnos extras ("continue", resposta a pergunta, correção) |
| `attempts` | `number`: tentativas de correção (analyze, verify) |
| `sha?` | commit do passo |
| `ms`, `tokens` | consumo |
| `gate?` | `{ ok, reason }`: o último resultado do portão |

## 6. Decision (registro `.jsonl` e `decisions.md`)

| Campo | Tipo |
| --- | --- |
| `at` | ISO 8601 |
| `story`, `feature`, `step` | |
| `kind` | `'options' \| 'text'` |
| `question` | `string` |
| `options?` | `{ label, description, recommended }[]` |
| `choice` | `string \| string[]`: rótulo(s) ou texto |
| `rationale` | `string` (≤ 3 frases) |
| `followedRecommendation?` | `boolean` |
| `provider`, `model` | da rota `autopilot.decide` |

O `.jsonl` também recebe linhas `{ at, event: 'step' | 'gate' | 'commit' | 'stop', … }` para auditoria.

## 7. Reducer (`flow.ts`)

**Estado:** `{ run: Run, cursor: { story, step }, pending?: Effect }`

**Eventos:**

| Evento | Significado |
| --- | --- |
| `start` / `resume` | estado inicial com cursor no primeiro passo não concluído |
| `turnDone { stopReason, usage, text }` | um turno do passo terminou |
| `gate { ok, verdict: 'advance' \| 'continue' \| 'answer' \| 'fix' \| 'stop', reason }` | resultado do portão |
| `committed { sha }` | commit do passo feito |
| `verifyDone { ok, output }` | o comando de verificação terminou |
| `cancelled` / `rateLimited` | o passo vira `interrupted` e a execução também |
| `limitExceeded { which }` | teto da história estourado; a história e a execução param |

**Efeitos** (que o driver executa e responde com o próximo evento):

| Efeito | O que faz |
| --- | --- |
| `clearSession` | limpa a sessão antes de um passo novo |
| `runTurn { text }` | `/speckit.<passo> …`, `continue`, uma resposta do decisor ou um prompt de correção |
| `evaluateGate` | avalia o portão do passo |
| `runVerify` | roda o comando de verificação |
| `commit` | commita o passo |
| `pushAndPr` | envia a branch e abre o PR |
| `saveState` | grava o estado |
| `report` | gera o relatório final |

**Transições de passo:** `pending → running → (done | failed | interrupted)`. Só `done` avança o cursor. `failed` faz `story.status = 'stopped'` e `run.status = 'stopped'`. `interrupted` faz `run.status = 'interrupted'`.
