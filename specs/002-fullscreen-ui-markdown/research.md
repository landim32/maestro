# Research: Interface de Tela Cheia, Rolagem Interna, Banner e Markdown

**Feature**: `002-fullscreen-ui-markdown` | **Date**: 2026-10-24

Fontes: definições de tipos do Ink 8.0.0 instalado em `node_modules/ink`, inspeção do qwen code v0.26.1 (`packages/cli/src/ui`), versões no registro npm em 2026-10-24.

---

## R1. Por que a barra de rolagem cresce a cada tecla

**Diagnóstico**: O Ink redesenha o frame inteiro a cada mudança de estado. No buffer principal do terminal, ele só consegue apagar e reescrever as linhas que ainda estão **dentro da janela visível**. Como o `App` da feature 001 não limita a altura (cabeçalho + histórico inteiro + prompt), assim que a interface excede a altura do terminal cada redesenho empurra linhas antigas para o histórico de rolagem e repinta por cima — a cada tecla. É o mesmo problema que o qwen code resolve com o "viewport mode" (`alternateScreen`) e limitando a altura da região viva.

**Decision**: Renderizar com `render(..., { alternateScreen: true })` (opção nativa do Ink 8) **e** limitar o layout à altura do terminal: raiz `<Box height={rows} width={columns} flexDirection="column">` com `useWindowSize()`, e a área da conversa com `flexGrow={1} overflow="hidden"`.

**Rationale**: `alternateScreen` dá a tela alternativa (igual a vim/less/qwen code) com restauração automática do conteúdo original ao desmontar; limitar a altura garante que nenhum frame exceda a janela, o que elimina o crescimento mesmo em terminais sem tela alternativa.

**Alternatives considered**: usar `<Static>` para o histórico (modelo antigo do Gemini CLI/qwen code): mantém o histórico no scrollback do terminal, mas não dá rolagem interna nem tela fixa — contraria a spec. Escrever as sequências `\x1b[?1049h/l` manualmente: desnecessário, o Ink 8 já faz e cuida do teardown.

---

## R2. Rolagem interna e indicador

**Decision**: Viewport com `overflow="hidden"` e `contentOffsetY={offset}` (props nativas do Ink 8 feitas para "scrollable views"); altura do conteúdo medida com `useBoxMetrics(ref)` no `Box` interno; altura visível derivada do layout (linhas do terminal menos cabeçalho, prompt e status). Estado em um hook `useViewport`: `{ offset, contentHeight, viewportHeight, follow }`, onde `follow = true` cola ao final e qualquer rolagem manual para cima desliga `follow`; `End`, enviar mensagem ou rolar até o fim religam. Indicador: coluna de 1 caractere à direita do viewport, com um "polegar" (`█`) de tamanho proporcional sobre um trilho (`│`), só quando `contentHeight > viewportHeight`.

**Teclas** (via `useInput`, que já expõe `pageUp`, `pageDown`, `home`, `end`, `shift`): PageUp/PageDown = uma tela menos 1 linha; Shift+↑/↓ = 1 linha; Home/End = topo/fim. Setas sem modificador continuam no prompt.

**Mouse**: o Ink 8 não expõe eventos de mouse. Seguir o qwen code (`hooks/useMouseEvents.ts`): ao montar, se stdout for TTY, escrever `\x1b[?1002h\x1b[?1006h` (rastreamento de botões + formato SGR); ler `stdin` cru via `useStdin()` e interpretar `\x1b[<b;x;yM`: botão 64 = roda para cima, 65 = roda para baixo (3 linhas por evento); ao desmontar escrever `\x1b[?1002l\x1b[?1006l`. Terminais sem suporte simplesmente não enviam os eventos. Desligável por `ui.mouse: false`.

**Rationale**: zero dependências novas; usa primitivas documentadas do Ink 8; comportamento igual ao da referência.

**Alternatives considered**: bibliotecas de "scroll view" para Ink (todas pré‑Ink 8, sem `contentOffsetY`); rolar o terminal em vez do conteúdo (impossível na tela alternativa).

---

## R3. Banner "Maestro"

**Decision**: Arte em blocos Unicode (mesma técnica do `AsciiArt.ts` do qwen code: caracteres `█ ╗ ╔ ═ ║`) em duas variantes constantes: **grande** (6 linhas, ~70 colunas, exibida quando `columns ≥ 100`) e **compacta** (1 linha: `♪ Maestro` em negrito, exibida abaixo disso ou quando `rows < 20`). Cor com `ink-gradient` 4.x (peer `ink ≥ 6`, `react ≥ 19.2` — compatível com o projeto), gradiente ciano → magenta coerente com o cabeçalho atual; sem cor (`NO_COLOR`/`--no-color`) renderiza `<Text>` simples. O banner é o **primeiro item do transcript** (rola com o histórico, como no qwen code), e o cabeçalho fixo fica com 1 linha (provedor/modelo/cwd). Nunca é renderizado no modo `-p`.

**Rationale**: evita gastar 6 linhas fixas em terminais pequenos; é o comportamento da referência; `ink-gradient` é o mesmo pacote usado pelo qwen code.

**Alternatives considered**: `figlet`/`cfonts` (fontes dinâmicas, dependência maior e saída menos controlada); banner fixo no cabeçalho (rejeitado por consumir altura).

---

## R4. Renderização de markdown

**Decision**: Parse com `unified` + `remark-parse` + `remark-gfm` (mdast com tabelas, tachado, listas de tarefas) e um renderizador próprio mdast → componentes Ink (`src/ui/markdown/`). Destaque de sintaxe com `lowlight` 3.x (highlight.js em modo hast) registrando apenas as linguagens exigidas em FR‑016, mapeando classes `hljs-*` para cores do Ink. Tabelas alinhadas com `string-width` (largura visual, cobre CJK/emoji) e truncadas com `…` por coluna quando excedem a largura disponível. Blocos de código com moldura (`borderStyle="round"`) e rótulo da linguagem.

**Streaming**: a mensagem em andamento é re‑parseada a cada delta (texto parcial); mensagens concluídas são memoizadas por `id`. O remark trata um fence não fechado como bloco de código até o fim do texto, o que atende FR‑017 sem heurísticas. Para evitar re‑render caro em respostas muito longas, o parse da mensagem parcial é limitado a um debounce de 1 frame (`maxFps` do Ink já coalesce). Markdown malformado nunca perde texto: o remark é tolerante por construção.

**Não interativo**: `-p` continua escrevendo o texto cru em stdout (FR‑021). Resultados de ferramentas e mensagens do usuário: `<Text>` literal (FR‑020).

**Rationale**: o qwen code usa `lowlight` + `string-width` + um parser linha a linha escrito à mão (`utils/MarkdownDisplay.tsx`, ~1.200 linhas). Reaproveitar o remark dá o mesmo resultado visual com muito menos código próprio e cobertura de GFM completa; o custo são ~15 pacotes pequenos de dependência transitiva (todos ESM, sem binários nativos).

**Alternatives considered**: `marked` + `marked-terminal` (gera string ANSI, não componentes — perde layout por largura e não integra com rolagem/medida do Ink); parser linha a linha próprio como o qwen code (mais código e bugs em tabelas/listas aninhadas); `cli-highlight` (embrulha highlight.js igualmente, mas gera string ANSI).

---

## R5. Capacidades do terminal e degradação

**Decision**: Hook `useTerminalCapabilities` que consolida: `columns`/`rows` (`useWindowSize`), cor (`colorEnabled`), tela alternativa (ligada por padrão; desligável por `--no-altscreen`, `ui.altScreen: false` ou `MAESTRO_NO_ALTSCREEN=1`), mouse (`ui.mouse`, padrão `true`, só com TTY). Tamanho mínimo 12×40: abaixo disso, modo compacto (sem banner, cabeçalho de 1 linha, status de 1 linha) e uma linha de aviso com o tamanho mínimo. Quando a tela alternativa está desligada, a altura continua limitada (R1), então não há crescimento do scrollback; apenas o conteúdo anterior do console fica coberto em vez de restaurado.

**Rationale**: FR‑005/FR‑006; o Ink ignora `alternateScreen` quando não interativo, então não há caminho de falha.

---

## R6. Redimensionamento

**Decision**: `useWindowSize()` re‑renderiza em `resize`; o viewport recalcula `viewportHeight` e, se `follow`, reposiciona no fim; se não, mantém `offset` limitado ao novo máximo. Durante streaming nada é perdido porque o texto vive no estado da sessão, não na tela.

---

## R7. Testes

**Decision**: `ink-testing-library` com `stdout` falso de tamanho controlado (`columns`/`rows`) para verificar: altura do frame nunca excede `rows`; rolagem muda o conteúdo visível; indicador aparece só quando há overflow; banner por variante; snapshots de markdown (cada elemento de FR‑015) com e sem cor; igualdade entre renderização incremental (alimentando deltas) e única. Teste de contrato dos escapes de mouse (sequências exatas escritas/limpas). O modo `-p` existente garante FR‑021 (teste já presente).

---

## R8. Dependências novas

| Pacote | Versão | Uso |
|---|---|---|
| `unified` | ^11.0.5 | pipeline de parse |
| `remark-parse` | ^11.0.0 | markdown → mdast |
| `remark-gfm` | ^4.0.1 | tabelas, tachado, tarefas, autolinks |
| `lowlight` | ^3.3.0 | destaque de sintaxe (highlight.js) |
| `string-width` | ^8.3.0 | largura visual para tabelas/banner |
| `ink-gradient` | ^4.0.1 | gradiente do banner |
| `@types/mdast` (dev) | ^4 | tipos do mdast |

Sem dependências nativas; portabilidade Windows/macOS/Linux preservada.
