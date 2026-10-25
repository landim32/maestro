# Data Model: Modos de Aprovação (TAB), `ask_user` e Créditos ao qwen-code

**Feature**: `005-approval-modes-ask-user` | **Date**: 2026-10-25

---

## 1. ApprovalMode e política (`src/tools/approval.ts`)

```ts
export const APPROVAL_MODES = ['default', 'auto-edit', 'auto', 'yolo'] as const; // ordem do ciclo
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export type ToolKind = 'read' | 'edit' | 'command' | 'question'; // propriedade da ferramenta
export type ActionKind = 'read' | 'edit' | 'command' | 'destructive' | 'question'; // após classificar

export interface ApprovalModeInfo {
  id: ApprovalMode;
  label: string;   // 'Pedir permissão' | 'Aceitar edições' | 'Automático' | 'YOLO'
  short: string;   // 'ask' | 'edits' | 'auto' | 'YOLO' (barra de status compacta)
  danger: 'none' | 'warn' | 'high'; // default/auto-edit → none|warn; auto → warn; yolo → high
  description: string; // uma linha para /help e /approval-mode
}

export interface DestructivePattern { id: string; pattern: RegExp; reason: string }
export const DESTRUCTIVE_PATTERNS: readonly DestructivePattern[]; // research R3

export function parseApprovalMode(value: string): ApprovalMode | undefined; // trim+lower; 'auto_edit'/'autoedit' → 'auto-edit'
export function nextApprovalMode(mode: ApprovalMode, dir: 1 | -1): ApprovalMode; // ciclo fechado
export function isDestructiveCommand(command: string): DestructivePattern | undefined; // testa cada segmento (; && || |)
export function classifyAction(tool: { kind: ToolKind }, input: unknown): { kind: ActionKind; reason?: string };
export function needsConfirmation(mode: ApprovalMode, kind: ActionKind): boolean;
export function approvalModeInfo(mode: ApprovalMode): ApprovalModeInfo;
```

**Tabela `needsConfirmation`** (FR-003; `read` e `question` nunca passam por aqui — `question` sempre pergunta ao usuário por definição):

| mode \ kind | edit | command | destructive |
|---|---|---|---|
| `default` | true | true | true |
| `auto-edit` | false | true | true |
| `auto` | false | false | true |
| `yolo` | false | false | false |

**Invariantes**: `nextApprovalMode` percorre `APPROVAL_MODES` circularmente nos dois sentidos; `classifyAction` só devolve `destructive` para `kind === 'command'` com `isDestructiveCommand(input.command)`; o confinamento à pasta (`resolveInsideCwd`) continua dentro das ferramentas e **não** depende do modo.

---

## 2. Alterações em `ToolDefinition` e `ToolContext` (`src/tools/types.ts`)

```ts
export type ToolName = 'read_file' | 'list_directory' | 'write_file' | 'run_command' | 'ask_user';

export interface ToolDefinition<I = unknown> {
  name: ToolName;
  description: string;
  inputSchema: z.ZodType<I>;
  kind: ToolKind;                       // substitui requiresConfirmation
  preview?: (input: I, ctx: ToolContext) => Promise<string>;
  run: (input: I, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  settings: ToolsSettings;
  /** Present only in interactive sessions; `ask_user` uses it. */
  ask?: (request: AskUserRequest) => Promise<AskUserOutcome>;
}

export interface PendingToolAction {
  callId: string;
  tool: ToolDefinition;
  input: unknown;
  previewText: string;
  /** Why confirmation is required in the current mode (e.g. destructive pattern), when not the default rule. */
  reason?: string;
  mode: ApprovalMode;
  resolve: (approved: boolean) => void;
}
```

Mapeamento: `read_file`, `list_directory` → `read`; `write_file` → `edit`; `run_command` → `command`; `ask_user` → `question`.

---

## 3. `ask_user` (`src/tools/askUser.ts`)

```ts
export const askUserInputSchema = z.strictObject({
  questions: z.array(
    z.strictObject({
      question: z.string().trim().min(1),
      header: z.string().trim().min(1).max(12),
      options: z.array(
        z.strictObject({ label: z.string().trim().min(1), description: z.string().trim().min(1) }),
      ).min(2).max(4).superRefine(/* rótulos únicos */),
      multiSelect: z.boolean().default(false),
    }),
  ).min(1).max(4),
});
export type AskUserInput = z.infer<typeof askUserInputSchema>;

export interface AskUserRequest { callId: string; questions: AskUserInput['questions'] }
export type Answer = { kind: 'options'; labels: string[] } | { kind: 'other'; text: string };
export type AskUserOutcome = { answered: true; answers: Answer[] } | { answered: false };

export function formatAnswers(questions, answers): string; // 'User has provided the following answers:\n\n**<header>**: <valor>'
export const DECLINED_TEXT = 'User declined to answer the questions.';
export const NO_USER_TEXT = 'Cannot ask the user: no interactive user is available (non-interactive mode).';
export const askUserTool: ToolDefinition<AskUserInput>; // kind: 'question'; run: ctx.ask ? … : { isError: false, output: NO_USER_TEXT }
```

`answers[i]` corresponde a `questions[i]`; múltipla escolha junta rótulos com `, `; `other` devolve o texto aparado. Cancelamento devolve `{ isError: false, output: DECLINED_TEXT }` (FR-015: não é erro de ferramenta).

---

## 4. AskUserFlowState (`src/setup/askUserFlow.ts`, reducer puro)

```ts
export type AskUserFlowState =
  | { step: 'question'; index: number; questions: Question[]; answers: Answer[];
      selected: number;              // 0..options.length (último = "Outro…")
      checked: boolean[];            // múltipla escolha
      other: string; otherActive: boolean; error?: string }
  | { step: 'done'; answers: Answer[] }
  | { step: 'cancelled' };

export type AskUserKey =
  | { type: 'up' } | { type: 'down' } | { type: 'enter' } | { type: 'cancel' }
  | { type: 'space' } | { type: 'digit'; n: number } | { type: 'input'; value: string };

export function initialAskUserFlow(questions: Question[]): AskUserFlowState;
export function askUserReducer(state: AskUserFlowState, key: AskUserKey): AskUserFlowState;
```

**Transições** (`step: 'question'`):

| Evento | Efeito |
|---|---|
| `up`/`down` | move `selected` circularmente entre opções e "Outro…"; `otherActive = selected === options.length` |
| `digit n` (1 ≤ n ≤ options.length) | `selected = n-1`; em escolha única equivale a `enter`; em múltipla, alterna `checked[n-1]` |
| `space` | múltipla: alterna `checked[selected]` (sem efeito em "Outro…"); única: ignorado |
| `input value` | só com `otherActive`: `other = value`; `error` limpo |
| `enter` em opção, escolha única | `answers[index] = { options: [label] }` → próxima pergunta ou `done` |
| `enter` em opção, múltipla | se nenhum `checked` → `error = 'Marque ao menos uma opção (Espaço)'`; senão `answers[index] = { options: labels marcados }` → próxima ou `done` |
| `enter` em "Outro…" | `other.trim() === ''` → `error = 'Digite uma resposta ou volte com Esc'`; senão `answers[index] = { other }` → próxima ou `done` |
| `cancel` | `cancelled` (todas as perguntas, mesmo as já respondidas, são descartadas) |

"Próxima pergunta" reinicia `selected = 0`, `checked = []`, `other = ''`. O flow nunca mantém texto de "Outro…" após `done`/`cancelled`.

---

## 5. Session e Controller

```ts
// src/session/session.ts
export type SessionState = 'idle' | 'generating' | 'awaiting_confirmation' | 'awaiting_answer';
pendingQuestion?: PendingQuestion;            // { request: AskUserRequest; resolve(outcome: AskUserOutcome) }
setPendingQuestion(q: PendingQuestion | undefined): void;   // state ↔ awaiting_answer / generating
// endGeneration() também limpa pendingQuestion

// src/session/controller.ts
approvalMode: ApprovalMode;                   // inicial: settings.tools.approvalMode
cycleApprovalMode(dir: 1 | -1): ApprovalMode; // emite change + transient
setApprovalMode(mode: ApprovalMode): void;
transient?: { text: string; seq: number };    // aviso curto para a barra de status
questionFlow?: AskUserFlowState;              // enquanto state === 'awaiting_answer'
dispatchQuestion(key: AskUserKey): void;      // reduz; em done/cancelled resolve pendingQuestion
```

`runTurn` recebe `TurnOptions.approvalMode: () => ApprovalMode` e `TurnCallbacks.ask?` / `onAutoApproved?(name, summary, mode)`. `submit()` passa `ask` quando `interactive`; `-p` não passa.

**Invariantes**: no máximo um de `pendingConfirmation`/`pendingQuestion`; `cancel()` da sessão (Esc duplo/Ctrl+C) aborta e resolve a pergunta pendente como não respondida; `cycleApprovalMode` nunca toca `pendingConfirmation`.

---

## 6. Configuração e argumentos

```ts
// src/config/schema.ts
export const approvalModeSchema = z.enum(APPROVAL_MODES);
tools: { …, approvalMode: approvalModeSchema.default('default') }

// src/config/loader.ts
LoadOverrides { …, approvalMode?: ApprovalMode }  // applyOverrides → tools.approvalMode

// src/cli/args.ts
ParsedArgs { …, approvalMode?: ApprovalMode }
--approval-mode <default|auto-edit|auto|yolo>   // parseApprovalMode; inválido → UsageError
--yolo                                          // atalho de --approval-mode yolo
```

Precedência: `--yolo` > `--approval-mode` > env (não há) > projeto > global > `default`.

---

## 7. Comando `/approval-mode`

`/approval-mode` sem argumento mostra o modo atual e a lista com descrições; `/approval-mode <modo>` troca (sessão) com aviso; valor inválido → aviso com os aceitos. Em `-p` apenas informa (o modo vem dos argumentos). Entra em `DEFAULT_COMMANDS` e no `/help`.

---

## 8. Avisos de terceiros (`THIRD_PARTY_NOTICES.md`)

Estrutura por projeto: nome, repositório, titulares de copyright, licença (SPDX), commit/versão de referência, tabela `arquivo do Maestro → arquivo de origem`, seguido do texto integral da Apache License 2.0. O teste de atribuição extrai as linhas da tabela (`| \`src/...\` |`) e verifica o cabeçalho `SPDX-License-Identifier: Apache-2.0` + `qwen-code` nas primeiras 12 linhas de cada arquivo.
