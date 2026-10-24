# Data Model: Interface de Tela Cheia, Rolagem Interna, Banner e Markdown

**Feature**: `002-fullscreen-ui-markdown` | **Date**: 2026-10-24

Entidades novas da camada de UI. As entidades da feature 001 (`Session`, `Message`, `Notice`) não mudam.

---

## 1. TerminalCapabilities

```ts
interface TerminalCapabilities {
  columns: number;            // useWindowSize
  rows: number;
  color: boolean;             // colorEnabled()
  altScreen: boolean;         // settings.ui.altScreen && !--no-altscreen && !MAESTRO_NO_ALTSCREEN && isTTY
  mouse: boolean;             // settings.ui.mouse && isTTY
  compact: boolean;           // rows < 20 || columns < 100  → banner compacto, status curto
  tooSmall: boolean;          // rows < 12 || columns < 40   → aviso de tamanho mínimo, sem banner
}
```

**Regras**: `MIN_ROWS = 12`, `MIN_COLUMNS = 40`, `COMPACT_ROWS = 20`, `COMPACT_COLUMNS = 100`. Recalculado a cada resize.

---

## 2. LayoutRegions (derivado)

```ts
interface LayoutRegions {
  header: 1;                               // sempre 1 linha
  status: 1;
  input: number;                           // 1..10 linhas (cresce com o texto digitado)
  confirmation: number;                    // 0 quando não há diálogo; senão min(linhas da prévia + 4, rows/2)
  transcript: number;                      // rows - header - status - input - confirmation (≥ 3)
}
```

**Invariante**: a soma é exatamente `rows`; nenhum frame pode ter altura > `rows` (verificado em teste de layout).

---

## 3. ViewportState

```ts
interface ViewportState {
  offset: number;          // primeira linha visível do conteúdo (0 = topo)
  contentHeight: number;   // linhas totais do transcript renderizado (useBoxMetrics)
  viewportHeight: number;  // LayoutRegions.transcript
  follow: boolean;         // true = colado ao final
  newBelow: boolean;       // true quando chegou conteúdo com follow=false
}
```

**Derivados**: `maxOffset = max(0, contentHeight - viewportHeight)`; `scrollable = contentHeight > viewportHeight`; `atBottom = offset >= maxOffset`.

**Transições**:

| Estado / evento | Efeito |
|---|---|
| `scrollBy(delta)` | `offset = clamp(offset + delta, 0, maxOffset)`; `follow = atBottom`; se `atBottom` então `newBelow = false` |
| `pageUp` / `pageDown` | `scrollBy(∓(viewportHeight - 1))` |
| `home` | `offset = 0; follow = false` |
| `end` | `offset = maxOffset; follow = true; newBelow = false` |
| conteúdo cresce (`contentHeight` ↑) com `follow` | `offset = maxOffset` |
| conteúdo cresce com `!follow` | `offset` mantido; `newBelow = true` |
| resize (`viewportHeight` muda) | se `follow`: `offset = maxOffset`; senão `offset = min(offset, maxOffset)` |
| usuário envia mensagem | `end` |
| `/clear` | `offset = 0; follow = true; newBelow = false` |

**Indicador** (`ScrollIndicator`): visível só se `scrollable`. Altura do trilho = `viewportHeight`; tamanho do polegar = `max(1, round(viewportHeight * viewportHeight / contentHeight))`; posição = `round((viewportHeight - thumb) * offset / maxOffset)`.

---

## 4. TranscriptItem

```ts
type TranscriptItem =
  | { kind: 'banner' }                                   // sempre o primeiro, só se !tooSmall
  | { kind: 'message'; message: Message; streaming: boolean }
  | { kind: 'notice'; notice: Notice };
```

**Renderização por tipo de mensagem**:

| `message.role` | Componente | Observação |
|---|---|---|
| `user` | `<Text>` literal com prefixo `›` | nunca markdown (FR‑020) |
| `assistant` | `<Markdown source={text} streaming />` + lista de `tool_call` em cinza | markdown completo (FR‑015) |
| `tool` | `<Text dimColor>` literal, 1 linha por resultado, truncado | nunca markdown (FR‑020) |

Mensagens concluídas são memoizadas por `message.id`; só a mensagem em streaming é re‑renderizada a cada delta.

---

## 5. RenderedBlock (saída do parser markdown)

mdast (de `remark-parse` + `remark-gfm`) mapeado para componentes. Nós suportados e seus atributos relevantes:

| Nó mdast | Atributos usados | Componente |
|---|---|---|
| `heading` | `depth` 1–6 | `Heading` (cor/negrito por nível; `#`‑prefixo visual nos níveis 3+) |
| `paragraph` | — | `Paragraph` (inline) |
| `strong`, `emphasis`, `delete`, `inlineCode`, `link`, `text`, `break` | `url` | `Inline` |
| `list` / `listItem` | `ordered`, `start`, `checked`, profundidade | `List` (marcador `•`/`n.`/`☐`/`☑`, recuo 2 por nível) |
| `blockquote` | — | `Blockquote` (barra `│` cinza + recuo) |
| `code` | `lang`, `value` | `CodeBlock` (moldura, rótulo, destaque) |
| `table` / `tableRow` / `tableCell` | `align` | `Table` (largura visual, truncamento) |
| `thematicBreak` | — | linha `─` na largura disponível |
| `html` | `value` | texto literal em cinza |
| `image` | `alt`, `url` | `[imagem: alt] (url)` |

**Invariantes**: nenhum caractere de texto do fonte é perdido (FR‑018); `render(parse(partial + rest)) === render(parse(full))` ao final do streaming (FR‑017).

---

## 6. BannerVariant

```ts
type BannerVariant = 'large' | 'compact' | 'none';
// large:   columns ≥ 100 && rows ≥ 20 && !tooSmall   → 6 linhas de arte em blocos
// compact: !tooSmall e não large                      → 1 linha "♪ Maestro" em negrito
// none:    tooSmall
```

Cor: gradiente ciano→magenta quando `color`; texto simples caso contrário.

---

## 7. Settings (adições)

```ts
ui: {
  color?: boolean;      // existente
  altScreen: boolean;   // default true
  mouse: boolean;       // default true
}
```

Validação: booleanos; chaves desconhecidas continuam rejeitadas.
