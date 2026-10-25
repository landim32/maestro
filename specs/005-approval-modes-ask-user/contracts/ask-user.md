# Contract — Ferramenta `ask_user`

**Feature**: `005-approval-modes-ask-user` · **Date**: 2026-10-25  
Adaptado de `ask_user_question` do qwen-code (research R4); ver `THIRD_PARTY_NOTICES.md`.

## 1. Entrada (JSON Schema gerado do zod, enviado ao modelo)

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array", "minItems": 1, "maxItems": 4,
      "items": {
        "type": "object",
        "properties": {
          "question":    { "type": "string", "minLength": 1, "description": "The complete question to ask the user." },
          "header":      { "type": "string", "minLength": 1, "maxLength": 12, "description": "Very short label shown as a tag (max 12 chars)." },
          "options": {
            "type": "array", "minItems": 2, "maxItems": 4,
            "items": { "type": "object", "properties": { "label": {"type":"string"}, "description": {"type":"string"} }, "required": ["label","description"], "additionalProperties": false }
          },
          "multiSelect": { "type": "boolean", "default": false }
        },
        "required": ["question", "header", "options"], "additionalProperties": false
      }
    }
  },
  "required": ["questions"], "additionalProperties": false
}
```

Regras extras (zod `superRefine`): rótulos únicos dentro de uma pergunta; `question`/`header`/`label`/`description` não podem ser só espaços. Entrada inválida → `tool_result` de erro `invalid input for ask_user: <caminho>: <motivo>` (mecanismo já existente em `executeTool`), sem diálogo.

## 2. Descrição ao modelo (texto fixo em `askUser.ts`)

- Use this tool when you need a decision from the user to continue (choose an approach, pick a file, confirm an understanding). Do not use it for approvals of file writes or commands: those are handled by the approval mode.
- Offer concrete, mutually exclusive options; the user can always pick "Other" to type a free answer.
- Use `multiSelect: true` when several answers may apply.
- If you recommend an option, put it first and append "(Recommended)" to its label.
- Ask at most a few questions per call; the user answers them one at a time.

## 3. Diálogo

Renderizado no lugar do `ConfirmationDialog` (acima do prompt), com `DialogFrame`:

```
┌ Pergunta 1 de 2 · [Abordagem] ────────────────────────────┐
│ Qual abordagem devo seguir para o cache?                  │
│                                                           │
│ > 1. Em memória (Recommended)   Mais simples, sem deps     │
│   2. Redis                      Compartilhado entre nós    │
│   3. Outro…                     digite uma resposta        │
│                                                           │
│ ↑↓ navegar · 1-9 escolher · Enter confirmar · Esc cancelar │
└───────────────────────────────────────────────────────────┘
```

- Múltipla escolha: marcador `[x]`/`[ ]` antes do rótulo, dica `Espaço marcar`; Enter com nada marcado mostra `Marque ao menos uma opção (Espaço)`.
- "Outro…" selecionado abre um `TextField` inline (`Digite sua resposta`); Enter vazio mostra `Digite uma resposta ou volte com Esc`; Esc com texto **não** apaga o texto — cancela o diálogo inteiro (comportamento do qwen-code; documentado na dica).
- Lista maior que a altura disponível usa a janela do `SelectList` (`maxVisible`).
- Teclas: ↑/↓, dígitos 1–9, Espaço, Enter, Esc. Ctrl+C: primeira vez cancela a pergunta **e** a geração (como no diálogo de confirmação); segunda em 2 s sai.
- Enquanto `awaiting_answer`, o prompt fica inativo com placeholder `responda à pergunta acima`.

## 4. Saída (`tool_result`)

| Situação | `isError` | `output` |
|---|---|---|
| Respondida | false | `User has provided the following answers:\n\n**<header>**: <valor>\n…` (valor = rótulo; múltipla = rótulos unidos por `, `; Outro = texto aparado) |
| Cancelada (Esc / Ctrl+C) | false | `User declined to answer the questions.` |
| `-p` / sem UI | false | `Cannot ask the user: no interactive user is available (non-interactive mode).` |
| Geração cancelada durante a pergunta | true | `cancelled by user` (fluxo existente) |
| Entrada inválida | true | `invalid input for ask_user: …` |

## 5. Transcrição e histórico

- Ao concluir, a transcrição mostra uma linha por pergunta como entrada do usuário: `› [Abordagem] Em memória (Recommended)`; para "Outro…": `› [Abordagem] <texto>`.
- Nada do diálogo entra em `history.jsonl` (↑/↓) nem nos logs (`--debug` registra apenas `ask_user.answered { questions: 2, other: 1 }` / `ask_user.declined`).

## 6. Modo de aprovação

`ask_user` tem `kind: 'question'`: nunca passa por `needsConfirmation`; é exibida em todos os modos, inclusive `yolo`. Disponível com `--no-tools` (`toolsFor` devolve `[askUserTool]`).

## 7. Testes que fixam este contrato

- `tests/unit/tools/askUser.test.ts` — § 1 (JSON Schema via `z.toJSONSchema`), § 4 (formatação), sem `ctx.ask` → `NO_USER_TEXT`.
- `tests/unit/setup/askUserFlow.test.ts` — § 3 (reducer).
- `tests/integration/ui/dialogs.askUser.test.tsx` — § 3–6 com `FakeProvider` emitindo `tool_call ask_user` e verificando o `tool_result` recebido na próxima requisição; repetido em `yolo`.
- `tests/integration/cli/nonInteractive.test.ts` — § 4 linha `-p`.
- `tests/unit/security/noSecrets.test.ts` — § 5.
