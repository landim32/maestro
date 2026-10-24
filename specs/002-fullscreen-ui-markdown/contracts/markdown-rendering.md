# Contract: Renderização de Markdown no Terminal

**Feature**: `002-fullscreen-ui-markdown` | **Módulo**: `src/ui/markdown/`

## 1. API

```ts
// parse.ts
export function parseMarkdown(source: string): Root;            // mdast, memoizado por source

// Markdown.tsx
export function Markdown(props: { source: string; width: number; color: boolean; streaming?: boolean }): JSX.Element;

// highlight.ts
export function highlight(code: string, lang?: string): HighlightedLine[]; // [{ spans: [{ text, token? }] }]
export const SUPPORTED_LANGUAGES: readonly string[];
```

Entrada: texto markdown (possivelmente parcial). Saída: árvore de componentes Ink com largura máxima `width`.

## 2. Mapeamento visual

| Elemento | Com cor | Sem cor |
|---|---|---|
| Heading 1 | negrito, ciano, sublinhado por `═` na largura do texto | negrito + `═` |
| Heading 2 | negrito, ciano | negrito |
| Heading 3–6 | negrito, prefixo `### ` em cinza | negrito + prefixo |
| Parágrafo | texto normal, quebra por largura | igual |
| **negrito** | bold | bold |
| *itálico* | italic | italic |
| ~~tachado~~ | strikethrough cinza | strikethrough |
| `código` | fundo cinza escuro, texto amarelo | entre crases |
| Link | texto sublinhado azul + ` (url)` em cinza quando o texto ≠ url | texto + ` (url)` |
| Lista | `•` por nível (nível 2: `◦`, nível 3+: `▪`), recuo 2 espaços por nível | igual |
| Lista numerada | `1.`, `2.` … respeitando `start` | igual |
| Tarefa | `☐` / `☑` | `[ ]` / `[x]` |
| Citação | barra `│` cinza + recuo 2, texto itálico | `│` + recuo |
| Bloco de código | moldura `round` cinza, rótulo da linguagem no canto superior esquerdo, destaque por token | moldura + rótulo, sem cores |
| Tabela | cabeçalho negrito, separador `─`, colunas alinhadas por `align` e largura visual, células truncadas com `…` para caber em `width` | igual sem negrito |
| Linha horizontal | `─` × `width` em cinza | igual |
| HTML cru | texto literal em cinza | literal |
| Imagem | `[imagem: alt] (url)` | igual |

## 3. Destaque de sintaxe

Linguagens registradas no `lowlight` (aliases entre parênteses): `typescript` (ts), `javascript` (js, jsx, tsx→typescript), `json`, `python` (py), `bash` (sh, shell, zsh), `powershell` (ps1, pwsh), `markdown` (md), `yaml` (yml), `xml` (html), `css`, `sql`, `go`, `rust` (rs), `java`, `csharp` (cs), `diff`, `ini` (toml como ini), `dockerfile`. Linguagem ausente ou desconhecida → sem destaque, com moldura e rótulo `text`/nome informado.

Tokens → cores (tema padrão): `keyword` magenta, `string` verde, `number` amarelo, `comment` cinza itálico, `function`/`title` ciano, `type`/`built_in` azul, `attr`/`property` ciano claro, `literal` amarelo, `operator`/`punctuation` branco, `variable` padrão.

## 4. Invariantes de streaming

1. `Markdown({ source: full })` produz o mesmo frame que a sequência `Markdown({ source: full.slice(0, k) })` para `k` crescente até `full.length` **no último passo** (teste: alimentar deltas de 1–7 caracteres e comparar `lastFrame()` final com renderização única).
2. Fence aberto sem fechamento é renderizado como bloco de código (o remark já faz isso).
3. Nenhum caractere de `source` desaparece: para todo texto de nós `text`/`inlineCode`/`code`, o conteúdo concatenado é substring preservada da fonte (teste com 20 fixtures malformadas: negrito aberto, link sem fechamento, tabela sem separador, lista sem espaço).
4. Nunca lança: qualquer exceção do parser cai em `<Text>{source}</Text>` literal.

## 5. Largura e truncamento

- `width` recebido pelo componente = largura do transcript − 1 (indicador) − 2 (margem).
- Blocos de código não quebram linhas; linhas maiores que `width - 4` são truncadas com `…` (conteúdo íntegro permanece no histórico; só a exibição trunca).
- Tabelas: largura ideal por coluna = max(largura visual das células); se a soma + separadores > `width`, as colunas mais largas são reduzidas proporcionalmente até caber (mín. 3 colunas visíveis por célula); células truncadas com `…`.
- Largura visual via `string-width` (CJK = 2, emoji = 2, combinantes = 0).

## 6. Fora do escopo do renderizador

- Mensagens do usuário e resultados de ferramentas (texto literal).
- Modo `-p` (texto cru em stdout).
- Fórmulas LaTeX, diagramas Mermaid (exibidos como bloco de código com rótulo).

## 7. Fixtures de teste (mínimo)

`tests/fixtures/markdown/`: `headings.md`, `inline.md`, `lists.md`, `code-ts.md`, `code-unknown.md`, `code-unclosed.md`, `table.md`, `table-wide.md`, `blockquote.md`, `mixed-real-answer.md` (resposta real de modelo de código), `malformed-*.md` (≥ 5). Snapshots com cor e sem cor em largura 80.
