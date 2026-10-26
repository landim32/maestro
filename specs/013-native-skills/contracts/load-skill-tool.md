# Contrato: ferramenta `load_skill`

## 1. Definição enviada ao modelo

| Campo         | Valor |
| ------------- | ----- |
| `name`        | `load_skill` |
| `description` | `Load a skill listed in the system prompt: returns its SKILL.md instructions and the list of its reference files. Pass "file" (a path relative to the skill folder, as listed) to read one reference file instead.` |
| `kind`        | `read`: nunca pede confirmação |

Schema de entrada (zod → JSON Schema):

```ts
z.object({
  name: z.string().min(1).describe('Skill name, exactly as listed in the system prompt.'),
  file: z.string().min(1).optional().describe('Reference file relative to the skill folder.'),
})
```

`file` é `.optional()`, nunca `.default`, para continuar não obrigatório no JSON Schema.

**Disponibilidade**: a ferramenta só está presente quando o catálogo tem ao menos uma skill válida. Com o catálogo vazio, a lista de ferramentas é idêntica à de hoje.

## 2. Saída sem `file`

```text
# Skill: <name>
Source: projeto (.claude/skills)

<corpo do SKILL.md sem o cabeçalho, trim>

## Reference files (3)
- references/erros.md
- templates/endpoint.ts
- examples/README.md

Read one with load_skill(name: "<name>", file: "<path>").
```

- Sem arquivos de referência, a última parte vira a linha `## Reference files (0)`, e a dica é omitida.
- Com mais de 100 arquivos, a lista termina com `- … +N more`.
- A listagem é recursiva até 3 níveis, ignora pastas `.*` e `node_modules` e deixa o próprio `SKILL.md` de fora. A ordem é alfabética e o separador é `/`.
- A saída inteira passa por `truncate(…, tools.maxOutputChars)`.
- `display.skill` é `{ name, source, ok: true, lines: <linhas do corpo>, files: <n> }`.

## 3. Saída com `file`

```text
# Skill file: <name>/<file> (<n> lines)
<conteúdo>
```

`display.skill` é `{ name, source, file, ok: true, lines }`.

## 4. Erros

Todos com `isError: true` e o turno continua:

| Situação | `output` |
| -------- | -------- |
| Nome desconhecido | `unknown skill "<name>". Available: a, b, c` (até 50 nomes, depois `…`) |
| `file` absoluto ou fora da pasta, depois de `realpath` | `file outside the skill folder: <file>` |
| `file` inexistente | `file not found in skill <name>: <file>` |
| `file` é uma pasta | `<file> is a directory; pick a file from the reference list` |
| Mais de 256 KB | `file too large (<bytes> bytes)` |
| NUL nos primeiros 8 000 bytes | `not a text file: <file>` |
| `SKILL.md` sumiu desde a inicialização | `skill <name> is no longer available (SKILL.md not found)` |

Em todo erro, `display.skill` traz `ok: false`. `source` vem quando o nome existe, e `file` quando foi pedido.

## 5. Transcrição (`ui/toolDisplay.ts`)

| Chamada | Linha `⏺` | Linha `⎿` (ok) |
| ------- | --------- | -------------- |
| `{ name }` | `Skill(<name>)` | `<n> linhas · <m> arquivos de referência` (com plural e singular) |
| `{ name, file }` | `Skill(<name>/<file>)`, cortado no meio | `Leu <n> linhas` |

Os erros seguem a regra geral de `describeResult`: tom `error` e as primeiras linhas da saída.

## 6. Log de depuração

O evento `skill.load` leva `{ name, source, file?, ok, bytes }` e nunca conteúdo. Ele é coberto por `noSecrets`.
