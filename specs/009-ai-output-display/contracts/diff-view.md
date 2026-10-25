# Contract: Diff de escrita (US3, FR-016–FR-020)

## 1. `fileDiff(oldText: string | null, newText: string, path: string): FileDiff`

| Entrada | `kind` | Corpo |
| --- | --- | --- |
| `oldText === null` | `new` | um trecho com todas as linhas `+`, numeradas a partir de 1 |
| textos iguais | `unchanged` | vazio |
| iguais depois de normalizar CRLF → LF | `eol` | vazio |
| NUL em algum dos textos | `binary` | vazio |
| algum dos textos com mais de 1 MB | `large` | vazio, com `added`/`removed` = 0 |
| outros casos | `edit` | trechos do `structuredPatch` com contexto 3 |

A comparação não leva em conta a falta de quebra de linha no fim do arquivo, e esse caso não gera uma linha `\ No newline` no corpo.

## 2. Cabeçalho

| `kind` | Diálogo de confirmação | Transcrição |
| --- | --- | --- |
| `edit` | `src/a.ts · +2 −1` | `⎿  +2 −1 linhas` |
| `new` | `src/a.ts · arquivo novo · 30 linhas` | `⎿  arquivo novo · 30 linhas` |
| `unchanged` | `src/a.ts · sem alterações` | `⎿  sem alterações` |
| `eol` | `src/a.ts · só troca de fim de linha (CRLF ↔ LF)` | `⎿  só troca de fim de linha` |
| `binary` / `large` | `src/a.ts · conteúdo binário ou grande demais para exibir` | o mesmo resumo |

## 3. Linhas

```text
  41    const a = 1;
  42 -  const b = 2;
  42 +  const b = 3;
  43 +  const c = 4;
  44    return a + b;
```

- A coluna de número tem a largura do maior número exibido. A linha `-` mostra o número antigo, e a linha `+` e o contexto mostram o número novo.
- Remoções aparecem em vermelho e adições em verde. Sem cor, o prefixo `-`/`+` continua sendo o que distingue as linhas.
- Linhas longas quebram dentro do bloco, porque o `Text` usa `wrap`, alinhado depois da coluna do número.
- Entre um trecho e outro aparece uma linha `  ⋮`.

## 4. Limites

- **Transcrição**: 40 linhas de corpo, mais `… +N linhas`.
- **Diálogo**: o `maxLines` atual, derivado da altura do terminal.
- O arquivo novo segue os mesmos limites.

## 5. Origem e momento

- O `executeTool` chama `tool.diff(input, ctx)` uma vez, antes da política de aprovação. O mesmo `FileDiff` vai para `PendingToolAction.diff` e para `ToolResult.display.diff`.
- O `preview` em texto do `write_file` continua como antes. A primeira linha dele é o anúncio do `-p` e da ação automática (`new file: a.txt (1 lines)`, `edit: a.txt (+1 −1)`), e mudar esse texto mudaria o stderr do `-p`. O `formatDiffText` fica disponível para o formato genérico.
- Uma escrita recusada não guarda o diff no resultado. O resultado mostra só `recusado pelo usuário`.
