---

description: "Task list for Interface de Tela Cheia, Rolagem Interna, Banner e Markdown"
---

# Tasks: Interface de Tela Cheia, Rolagem Interna, Banner e Markdown

**Input**: Design documents from `/specs/002-fullscreen-ui-markdown/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (ui-layout.md, markdown-rendering.md, terminal-io.md), quickstart.md

**Tests**: O plano define a estratégia de testes (research R7, contratos § "Testes derivados/de contrato"): `vitest` + `ink-testing-library` com stdout de tamanho controlado, snapshots de markdown e igualdade incremental vs. única. As tarefas de teste abaixo implementam exatamente esses casos. Nenhum teste acessa rede.

**Organization**: Tarefas agrupadas por história de usuário. A feature toca quase só `src/ui/`; `session/`, `providers/`, `tools/` e o modo `-p` não mudam.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: História a que a tarefa pertence (US1, US2, US3, US4)
- Caminhos exatos em cada descrição

## Path Conventions

Projeto único: `src/` e `tests/` na raiz, conforme plan.md § Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependências novas e utilitários de teste para medir frames.

- [x] T001 Instalar dependências em `package.json`: `npm install unified remark-parse remark-gfm lowlight string-width ink-gradient` e `npm install -D @types/mdast`; confirmar `npm run build` verde
- [x] T002 [P] Criar helper `renderSized(element, { columns, rows })` em `tests/helpers/renderSized.ts` que usa `ink-testing-library` com um stdout falso (`columns`, `rows`, `isTTY: true`) e expõe `lastFrame()`, `frameHeight()` (nº de linhas do último frame), `stdin.write`, `rerender`, `unmount`, `writes` (tudo escrito no stdout, para inspecionar sequências de escape)
- [x] T003 [P] Criar diretório `tests/fixtures/markdown/` com os arquivos `headings.md`, `inline.md`, `lists.md`, `code-ts.md`, `code-unknown.md`, `code-unclosed.md`, `table.md`, `table-wide.md`, `blockquote.md`, `mixed-real-answer.md` e `malformed-{bold,link,table,list,fence}.md` conforme contracts/markdown-rendering.md § 7

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Capacidades do terminal, flags/config e utilitário de largura, usados por todas as histórias.

**⚠️ CRITICAL**: Nenhuma história pode começar antes desta fase terminar.

- [x] T004 Adicionar `altScreen: z.boolean().default(true)` e `mouse: z.boolean().default(true)` a `uiSettingsSchema` em `src/config/schema.ts`; atualizar `INITIAL_SETTINGS` em `src/config/defaults.ts` com o bloco `ui` (`color` omitido, `altScreen: true`, `mouse: true`)
- [x] T005 [P] Adicionar opção `--no-altscreen` (`altscreen`, boolean, default true) em `src/cli/args.ts` e campo `altScreen: boolean` em `ParsedArgs`
- [x] T006 [P] Criar `src/utils/width.ts` com `visualWidth(s)` (string-width), `truncateToWidth(s, max, ellipsis = '…')` e `padToWidth(s, width, align: 'left'|'right'|'center')`
- [x] T007 Criar hook `useTerminalCapabilities({ settings, flags, env })` em `src/ui/hooks/useTerminalCapabilities.ts` retornando `TerminalCapabilities` (data-model § 1): `columns`/`rows` de `useWindowSize()`, `color` de `colorEnabled()`, `altScreen = settings.ui.altScreen && flags.altScreen && !env.MAESTRO_NO_ALTSCREEN && isTTY`, `mouse = settings.ui.mouse && isTTY`, `compact = rows < 20 || columns < 100`, `tooSmall = rows < 12 || columns < 40`; exportar também a função pura `computeCapabilities(input)` para testes e para `interactive.ts`
- [x] T008 Estender `InteractiveOptions`/`runInteractive` em `src/cli/interactive.ts` para receber `settings`, `args` (altScreen, color) e `env`, calcular `computeCapabilities` antes do `render`, e passar `capabilities` como prop para `App`; em `src/index.ts` repassar `loaded.settings`, `args` e `process.env`
- [x] T009 [P] Testes: `tests/unit/ui/capabilities.test.ts` (tabela de casos para `compact`/`tooSmall`/`altScreen`/`mouse` com flag, env, settings e `isTTY`); `tests/unit/cli/args.test.ts` (+ `--no-altscreen` → `altScreen: false`); `tests/contract/config-schema.test.ts` (+ `ui.altScreen`/`ui.mouse` defaults e tipos); `tests/unit/utils/width.test.ts` (CJK = 2 colunas, emoji, truncamento com `…`, padding por alinhamento)

**Checkpoint**: build e testes verdes; `maestro --no-altscreen` aceito; `settings.ui` com as duas chaves.

---

## Phase 3: User Story 1 – Interface estável que ocupa a tela inteira (Priority: P1) 🎯 MVP

**Goal**: Frame sempre com altura = linhas do terminal, tela alternativa com restauração ao sair, reflow em resize, modo compacto/mínimo. Digitar não cresce o scrollback.

**Independent Test**: Terminal de 30 linhas, digitar 200 caracteres: barra de rolagem do terminal parada e prompt fixo; resposta longa mantém prompt/status na base; `/exit` restaura o console. Em 10×30, aviso de tamanho mínimo e funcionamento normal.

### Implementation for User Story 1

- [x] T010 [US1] Reescrever `src/ui/App.tsx` com raiz `<Box width={caps.columns} height={caps.rows} flexDirection="column">` e regiões na ordem: `Header` (1 linha) → `Transcript` (`flexGrow={1}`, `overflow="hidden"`, `minHeight={3}`) → `ConfirmationDialog` (quando pendente, `maxHeight={Math.floor(rows/2)}`) → `InputPrompt` (1–10 linhas) → `StatusBar` (1 linha); receber `capabilities` por prop e repassar `compact`/`tooSmall`/`color`
- [x] T011 [P] [US1] Reescrever `src/ui/components/Header.tsx` como 1 linha sem borda: `maestro v0.1.0 · claude / claude-opus-5-5 · <cwd truncado por largura>` usando `truncateToWidth` para caber em `columns`
- [x] T012 [P] [US1] Criar `src/ui/components/Transcript.tsx` (versão sem rolagem nesta fase): `Box` externo `flexGrow={1} overflow="hidden"` contendo `MessageList`; sempre exibe o **final** do conteúdo (ancora pela base usando `justifyContent="flex-end"` ou offset = altura do conteúdo − altura visível, medido com `useBoxMetrics`)
- [x] T013 [P] [US1] Atualizar `src/ui/components/InputPrompt.tsx`: quebrar o texto digitado em linhas de largura `columns - 4`, crescer até 10 linhas e, acima disso, exibir só as últimas 10 mantendo o cursor visível; aceitar colagem multilinha (`\n` preservado)
- [x] T014 [P] [US1] Atualizar `src/ui/components/StatusBar.tsx`: receber `capabilities`; em `compact` mostrar dicas curtas; em `tooSmall` mostrar `terminal too small (min 40x12)` em amarelo no lugar das dicas; aceitar `transientNotice?: string` (usado para `alt screen off`)
- [x] T015 [US1] Em `src/cli/interactive.ts`: `render(..., { exitOnCtrlC: false, patchConsole: true, alternateScreen: caps.altScreen })`; quando `!caps.altScreen`, definir `transientNotice = 'alt screen off'` por 5 s via estado no `App`; garantir `unmount()` também em `SIGINT`/`uncaughtException` para restaurar o console
- [x] T016 [P] [US1] Testes: `tests/integration/ui/App.layout.test.tsx` com `renderSized` em 24×80, 40×120 e 10×30: `frameHeight() <= rows` após montagem, após 200 teclas, após resposta de 300 linhas do `fakeProvider` e após `rerender` com novo tamanho; nº de linhas do frame idêntico antes/depois de digitar 50 caracteres; em 10×30 o frame contém `terminal too small`; `tests/unit/ui/InputPrompt.test.tsx` (+ crescimento até 10 linhas e corte acima); `tests/contract/terminal-io.test.ts` (parte 1: `interactive.ts` passa `alternateScreen` igual a `caps.altScreen` — verificar via spy em `render` do `ink`)

**Checkpoint**: interface fixa na tela, sem crescimento do scrollback; `--no-altscreen` mostra aviso e mantém altura limitada.

---

## Phase 4: User Story 2 – Rolar a conversa dentro da interface (Priority: P1)

**Goal**: Viewport com `contentOffsetY`, teclas Page Up/Down, Home/End, Shift+↑/↓, roda do mouse, indicador lateral, modo "colado ao fim" e aviso de conteúdo novo.

**Independent Test**: Após 5 respostas longas, Page Up mostra o histórico e o indicador sobe; End volta ao fim; nova resposta com visão rolada mostra `↓ novo conteúdo`; enviar mensagem salta ao fim; roda do mouse rola 3 linhas.

### Implementation for User Story 2

- [x] T017 [US2] Criar hook `useViewport({ contentHeight, viewportHeight })` em `src/ui/hooks/useViewport.ts` implementando `ViewportState` e todas as transições de data-model § 3 (`scrollBy`, `pageUp`, `pageDown`, `home`, `end`, `reset`, auto‑follow quando o conteúdo cresce, clamp em resize, `newBelow`); exportar reducer puro `viewportReducer(state, action)` para testes
- [x] T018 [US2] Atualizar `src/ui/components/Transcript.tsx`: `Box` externo `overflow="hidden" contentOffsetY={offset}`; `Box` interno com `ref` medido por `useBoxMetrics` → `contentHeight`; `viewportHeight` medido no externo; integrar `useViewport`; expor ações via `ref`/callback para `App` (`scrollBy`, `end`, `reset`)
- [x] T019 [P] [US2] Criar `src/ui/components/ScrollIndicator.tsx` (coluna de 1 caractere: trilho `│` cinza, polegar `█` ciano, tamanho/posição conforme data-model § 3; renderiza `null` quando não há overflow) e posicioná-lo à direita do conteúdo em `Transcript.tsx` (conteúdo com `width = columns - 1`)
- [x] T020 [P] [US2] Adicionar em `src/ui/components/Transcript.tsx` a linha sobreposta `↓ novo conteúdo (End)` em amarelo na base do viewport quando `newBelow`
- [x] T021 [US2] Estender `src/ui/hooks/useKeyboard.ts`: `pageUp`/`pageDown` → `viewport.pageUp()/pageDown()`, `home`/`end` → `viewport.home()/end()`, `shift && upArrow/downArrow` → `scrollBy(∓1)`; garantir que essas teclas não chegam ao `InputPrompt` (checar em `InputPrompt` e ignorar `key.pageUp/pageDown/home/end` e `key.shift && setas`)
- [x] T022 [US2] Criar hook `useMouseWheel({ enabled, onWheel })` em `src/ui/hooks/useMouseWheel.ts`: ao montar com `enabled`, escrever `\x1b[?1002h\x1b[?1006h` em `stdout`; ler `stdin` via `useStdin()` (`setRawMode` já ativo pelo Ink), interpretar `\x1b[<(\d+);(\d+);(\d+)[Mm]`: botão 64 → `onWheel(-3)`, 65 → `onWheel(+3)`, outros → descartar; ao desmontar escrever `\x1b[?1002l\x1b[?1006l`; exportar `parseSgrMouse(chunk)` puro; impedir que sequências de mouse cheguem ao `InputPrompt` (filtro em `InputPrompt`: ignorar `input` que comece com `\x1b[<`)
- [x] T023 [US2] Ligar tudo em `src/ui/App.tsx`: `useMouseWheel({ enabled: caps.mouse, onWheel: scrollBy })`; ao enviar mensagem chamar `viewport.end()`; em `/clear` (`controller` emite `change` com histórico vazio) chamar `viewport.reset()`; `StatusBar` recebe dica `PgUp/PgDn scroll`
- [x] T024 [P] [US2] Teste unitário `tests/unit/ui/useViewport.test.ts`: cada linha da tabela de transições de data-model § 3 (clamp, follow liga/desliga, `newBelow`, resize com e sem follow, `end` limpa `newBelow`)
- [x] T025 [P] [US2] Teste de integração `tests/integration/ui/App.scroll.test.tsx` com `renderSized` 24×80 e `fakeProvider` com respostas de 60 linhas: PageUp muda o conteúdo visível e o frame contém `█`; End volta ao fim; com visão rolada, nova resposta mostra `↓ novo conteúdo`; enviar mensagem leva ao fim; sem overflow o indicador não aparece
- [x] T026 [P] [US2] Teste de contrato `tests/contract/terminal-io.test.ts` (parte 2): com `mouse=true` e `isTTY=true`, `writes` contém `\x1b[?1002h\x1b[?1006h` após montar e `\x1b[?1002l\x1b[?1006l` após `unmount`; com `mouse=false` nenhuma; `parseSgrMouse('\x1b[<64;10;5M')` → `{ wheel: -1 }`, `65` → `{ wheel: +1 }`, `0` → `null`; injetar `\x1b[<0;10;5M` em `stdin` não altera o texto do prompt

**Checkpoint**: histórico navegável por teclado e mouse, com indicador; US1 continua estável.

---

## Phase 5: User Story 3 – Banner "Maestro" ao iniciar (Priority: P2)

**Goal**: Logo em arte de blocos com gradiente como primeiro item da conversa, variante compacta e sem cor, nunca no modo `-p`.

**Independent Test**: 120 colunas → logo grande colorido legível; 80 colunas → `♪ Maestro`; `NO_COLOR` → sem cores; `-p` → nada do banner na saída.

### Implementation for User Story 3

- [x] T027 [P] [US3] Criar `src/ui/banner.ts` com `LARGE_BANNER` (6 linhas de arte em blocos Unicode formando "MAESTRO", largura ≤ 70 colunas, caracteres `█ ╗ ╔ ╝ ╚ ═ ║`), `COMPACT_BANNER = '♪ Maestro'`, e `pickBannerVariant(caps): 'large' | 'compact' | 'none'` conforme data-model § 6; validar em teste que todas as linhas do banner grande têm a mesma largura visual
- [x] T028 [US3] Criar `src/ui/components/Banner.tsx`: `large` → `<Gradient colors={['cyan', 'magenta']}>` (ink-gradient) envolvendo as linhas quando `color`, senão `<Text bold>`; `compact` → `<Text bold color="cyan">`; abaixo do banner uma linha `v0.1.0 · claude / modelo · cwd` em cinza; `none` → `null`
- [x] T029 [US3] Em `src/ui/components/MessageList.tsx` renderizar `{ kind: 'banner' }` como primeiro `TranscriptItem` (data-model § 4) quando `pickBannerVariant(caps) !== 'none'`; garantir que `/clear` mantém o banner (o item não depende do histórico); confirmar que `src/cli/nonInteractive.ts` nunca renderiza componentes (sem alteração necessária, apenas teste)
- [x] T030 [P] [US3] Testes: `tests/unit/ui/banner.test.tsx` (`renderSized` 120×40 → frame contém as linhas de `LARGE_BANNER`; 80×24 → contém `♪ Maestro` e não contém `█`; 30×10 → nenhum dos dois; `NO_COLOR` → frame sem sequências `\x1b[3`); `tests/integration/cli/nonInteractive.test.ts` (+ asserção: stdout/stderr não contêm `Maestro` em blocos nem `♪`)

**Checkpoint**: identidade visual presente; nada muda no modo `-p`.

---

## Phase 6: User Story 4 – Respostas em markdown formatadas (Priority: P2)

**Goal**: mdast (remark + GFM) → componentes Ink com destaque de sintaxe (lowlight), tabelas alinhadas, streaming incremental idêntico à renderização única, texto cru preservado no `-p`.

**Independent Test**: Resposta com título, lista aninhada, negrito, código em linha, bloco TypeScript e tabela: nenhum símbolo cru, bloco com moldura + rótulo + cores por token, tabela alinhada; comparação visual com o qwen code.

### Implementation for User Story 4

- [x] T031 [P] [US4] Criar `src/ui/markdown/parse.ts`: `parseMarkdown(source)` com `unified().use(remarkParse).use(remarkGfm)`, memoizado (LRU de 64 entradas por `source`), `try/catch` devolvendo `{ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: source }] }] }` em falha
- [x] T032 [P] [US4] Criar `src/ui/markdown/highlight.ts`: `createLowlight()` registrando `typescript` (ts, tsx), `javascript` (js, jsx), `json`, `python` (py), `bash` (sh, shell, zsh), `powershell` (ps1, pwsh), `markdown` (md), `yaml` (yml), `xml` (html), `css`, `sql`, `go`, `rust` (rs), `java`, `csharp` (cs), `diff`, `ini` (toml), `dockerfile`; `highlight(code, lang)` → `HighlightedLine[]` (`{ spans: [{ text, token? }] }`) percorrendo o hast e quebrando por `\n`; linguagem desconhecida → spans sem token; exportar `SUPPORTED_LANGUAGES` e `resolveLanguage(alias)`
- [x] T033 [P] [US4] Criar `src/ui/markdown/theme.ts`: mapa token hljs → cor/estilo (contracts/markdown-rendering.md § 3) e estilos por elemento (heading, inlineCode, link, blockquote, table header, rule); função `styleFor(token, color: boolean)` que devolve `{}` quando `color=false`
- [x] T034 [US4] Criar `src/ui/markdown/Inline.tsx`: renderiza filhos inline (`text`, `strong`, `emphasis`, `delete`, `inlineCode`, `link` com ` (url)` quando texto ≠ url, `break`, `image` → `[imagem: alt] (url)`, `html` literal) como `<Text>` aninhados, aplicando `theme`
- [x] T035 [P] [US4] Criar `src/ui/markdown/CodeBlock.tsx`: `Box borderStyle="round" borderColor="gray"` com rótulo da linguagem na primeira linha, linhas de `highlight()` renderizadas como `<Text>` por span com `styleFor`, linhas truncadas com `…` em `width - 4` (sem quebra), variante sem cor
- [x] T036 [P] [US4] Criar `src/ui/markdown/Table.tsx`: calcula larguras ideais por coluna com `visualWidth`, reduz proporcionalmente as colunas mais largas até caber em `width` (mín. 3), trunca células com `…`, alinha por `align`, cabeçalho negrito e separador `─`; cada linha como `<Text>` monoespaçado
- [x] T037 [US4] Criar `src/ui/markdown/Markdown.tsx`: componente `Markdown({ source, width, color, streaming })` que chama `parseMarkdown` e mapeia nós para `Heading`, `Paragraph`, `List`/`ListItem` (marcadores `•`/`◦`/`▪`, numeração com `start`, tarefas `☐`/`☑`), `Blockquote`, `CodeBlock`, `Table`, `thematicBreak` (`─` × width), `html` literal, conforme contracts/markdown-rendering.md § 2; memoizado por `(source, width, color)`
- [x] T038 [US4] Em `src/ui/components/MessageList.tsx`: mensagens `assistant` passam a renderizar `<Markdown source={text} width={width} color={caps.color} streaming={isLast && generating} />` e a resposta parcial em streaming também passa por `Markdown`; `user` e `tool` continuam `<Text>` literal; itens concluídos memoizados por `message.id` (`React.memo` com comparação por id/width/color)
- [x] T039 [P] [US4] Testes de snapshot `tests/unit/ui/markdown/Markdown.test.tsx`: para cada fixture de `tests/fixtures/markdown/` renderizar em largura 80 com cor e sem cor (`renderSized`) e comparar `toMatchSnapshot()`; asserções explícitas: `headings.md` não contém `#` cru nos níveis 1–2; `inline.md` não contém `**` nem `` ` ``; `code-ts.md` contém rótulo `typescript` e moldura `╭`; `table.md` tem colunas alinhadas (mesma posição do `│` em todas as linhas); `table-wide.md` cabe em 80 colunas e contém `…`
- [x] T040 [P] [US4] Teste `tests/unit/ui/markdown/highlight.test.ts`: cada linguagem suportada e alias resolve; `keyword` detectado em TS/Python/Go; linguagem desconhecida devolve spans sem token; código com `\n` final não gera linha extra
- [x] T041 [P] [US4] Teste `tests/integration/ui/streaming.test.tsx`: para `mixed-real-answer.md` e `code-unclosed.md`, alimentar `Markdown` com prefixos crescentes (deltas de 1–7 caracteres via `rerender`) e verificar que o `lastFrame()` final é idêntico ao da renderização única; verificar que em um prefixo com fence aberto o frame já contém a moldura de código
- [x] T042 [P] [US4] Teste `tests/unit/ui/markdown/malformed.test.tsx`: para cada `malformed-*.md`, o texto plano do frame (sem ANSI, sem marcadores adicionados) contém todo o texto alfanumérico da fonte (nenhuma perda, FR‑018); `parseMarkdown` nunca lança (fuzz leve com 200 strings aleatórias de símbolos markdown)

**Checkpoint**: respostas legíveis como no qwen code; `-p` inalterado (teste existente).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Desempenho, portabilidade, documentação e validação final.

- [x] T043 [P] Teste de desempenho `tests/integration/ui/perf.test.tsx`: transcript com 5.000 linhas (50 mensagens de 100 linhas de markdown); medir tempo de `PageUp` (`rerender` até frame estável) < 100 ms e de uma tecla no prompt < 50 ms; se falhar, aplicar memoização adicional em `MessageList.tsx`/`Markdown.tsx` (ex.: pré‑renderizar mensagens concluídas em `useMemo` por id)
- [x] T044 [P] Teste de resize `tests/integration/ui/App.resize.test.tsx`: durante streaming (fakeProvider com `delayMs`), `rerender` com 120×40 → 80×25 → 100×30; frame sempre ≤ rows; texto final da resposta igual ao esperado (nada perdido); com `follow` a visão fica no fim, sem `follow` o `offset` é clampado
- [x] T045 [P] Atualizar `README.md` (seção Uso: rolagem, `--no-altscreen`, `ui.altScreen`/`ui.mouse`, banner/markdown), `specs/002-fullscreen-ui-markdown/quickstart.md` se algo mudou, e `CLAUDE.md` (Project Structure com `src/ui/markdown/` e novos hooks; Code Style: "UI nunca escreve sequências de escape fora de `useMouseWheel`/Ink")
- [ ] T046 Verificar manualmente no Windows Terminal e no console padrão (`conhost`) com `node dist/index.js` e `--no-altscreen`: sem crescimento do scrollback, restauração ao sair, roda do mouse, banner; registrar resultado em `specs/002-fullscreen-ui-markdown/checklists/requirements.md` § Notes
- [x] T047 Limpeza final: `npm run lint && npm run format && npm test` verdes; remover código morto do `Header`/`MessageList` antigos; confirmar que a suíte da feature 001 (incl. `tests/integration/cli/nonInteractive.test.ts` e `tests/unit/security/`) continua passando (SC‑007)
- [ ] T048 Executar a validação visual de `specs/002-fullscreen-ui-markdown/quickstart.md` § "Validação visual por história" com provedor real e comparar com o qwen code na mesma pergunta (SC‑006); registrar em `specs/002-fullscreen-ui-markdown/checklists/requirements.md` § Notes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 primeiro (dependências); T002 e T003 em paralelo.
- **Foundational (Phase 2)**: depende de Phase 1. T004, T005, T006 em paralelo → T007 → T008 → T009. BLOQUEIA as histórias.
- **US1 (Phase 3)**: depende de Phase 2. T010 primeiro (layout raiz); T011–T014 em paralelo; T015 após T010; T016 ao final.
- **US2 (Phase 4)**: depende de US1 (T010, T012). T017 → T018; T019, T020 em paralelo após T018; T021, T022 após T017; T023 após T018–T022; T024–T026 em paralelo ao final.
- **US3 (Phase 5)**: depende de Phase 2 e de T012/T018 (`Transcript`/`MessageList`). T027 → T028 → T029; T030 ao final. Pode rodar em paralelo com US2.
- **US4 (Phase 6)**: depende de Phase 2 e de T012 (`MessageList`). T031, T032, T033 em paralelo → T034 → T035, T036 em paralelo → T037 → T038; T039–T042 em paralelo ao final. Pode rodar em paralelo com US2/US3.
- **Polish (Phase 7)**: depende das histórias concluídas; T043–T045 em paralelo; T046–T048 sequenciais.

### User Story Dependencies

- **US1 (P1)**: só Foundational. Entrega a correção do bug principal sozinha.
- **US2 (P1)**: precisa do `Transcript` de US1 (passa a rolar em vez de ancorar no fim).
- **US3 (P2)**: precisa de `MessageList`; independente de US2/US4.
- **US4 (P2)**: precisa de `MessageList`; independente de US2/US3.

### Parallel Opportunities

- Phase 2: T004, T005, T006.
- US1: T011, T012, T013, T014 (quatro componentes).
- US2: T019 ∥ T020; T021 ∥ T022; T024 ∥ T025 ∥ T026.
- US3 ∥ US4 ∥ US2 após US1 (três desenvolvedores).
- US4: T031 ∥ T032 ∥ T033; T035 ∥ T036; T039 ∥ T040 ∥ T041 ∥ T042.
- Polish: T043 ∥ T044 ∥ T045.

---

## Parallel Example: User Story 4

```bash
Task: "Criar src/ui/markdown/parse.ts"
Task: "Criar src/ui/markdown/highlight.ts"
Task: "Criar src/ui/markdown/theme.ts"
# depois:
Task: "Criar src/ui/markdown/CodeBlock.tsx"
Task: "Criar src/ui/markdown/Table.tsx"
# testes ao final, em paralelo:
Task: "tests/unit/ui/markdown/Markdown.test.tsx"
Task: "tests/unit/ui/markdown/highlight.test.ts"
Task: "tests/integration/ui/streaming.test.tsx"
Task: "tests/unit/ui/markdown/malformed.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2.
2. Phase 3 (US1): layout de altura fixa + `alternateScreen`.
3. **PARAR e VALIDAR**: digitar não cresce o scrollback; sair restaura o console. Esse é o bug relatado e já justifica uma entrega.

### Incremental Delivery

1. US1 → correção do defeito.
2. US2 → rolagem interna (sem ela, o histórico fica inacessível na tela alternativa; entregar logo após US1).
3. US4 → markdown (maior ganho de legibilidade).
4. US3 → banner.
5. Polish.

### Parallel Team Strategy

Após US1: Dev A → US2; Dev B → US4; Dev C → US3; todos → Polish.

---

## Notes

- Tarefas [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Nenhuma mudança em `src/session/`, `src/providers/`, `src/tools/` nem em `src/cli/nonInteractive.ts`; a suíte da feature 001 deve continuar verde em todos os checkpoints.
- Sequências de escape só podem ser escritas por `useMouseWheel` (mouse) e pelo Ink (tela alternativa); nunca pelos componentes.
- Commit após cada tarefa ou grupo lógico; a feature 001 deve ser commitada antes de iniciar T001.
