# Implementation Plan: Interface de Tela Cheia, Rolagem Interna, Banner e Markdown

**Branch**: `002-fullscreen-ui-markdown` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-fullscreen-ui-markdown/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Reescrever a camada de interface (`src/ui/`) do Maestro para: (1) renderizar na tela alternativa do terminal com layout limitado à altura da janela, eliminando o crescimento do scrollback a cada tecla; (2) rolar a conversa dentro de um viewport próprio com indicador de posição, teclado e roda do mouse; (3) exibir um banner "Maestro" em arte de blocos com gradiente ao iniciar; (4) formatar as respostas do modelo interpretando markdown (remark + GFM) com destaque de sintaxe (lowlight), inclusive durante o streaming. Nada muda em `session/`, `providers/`, `tools/` ou no modo `-p`; apenas `cli/interactive.ts`, `cli/args.ts` (flag `--no-altscreen`) e `config/schema.ts` (`ui.altScreen`, `ui.mouse`) são tocados fora de `ui/`. Detalhes em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack da feature 001.  
**Primary Dependencies**: existentes: `ink` 8.0.0 (usa `alternateScreen`, `useWindowSize`, `overflow="hidden"` + `contentOffsetY`, `useBoxMetrics`, `useInput` com `pageUp/pageDown/home/end/shift`, `useStdin`), `react` 19. Novas: `unified`, `remark-parse`, `remark-gfm`, `lowlight`, `string-width`, `ink-gradient` (ver research R8).  
**Storage**: nenhuma mudança; duas chaves novas em `settings.json` (`ui.altScreen`, `ui.mouse`).  
**Testing**: `vitest` + `ink-testing-library` com stdout de tamanho controlado; snapshots de markdown; teste de igualdade incremental vs. única.  
**Target Platform**: Windows Terminal, console padrão do Windows (conhost com VT), Terminal.app/iTerm2, emuladores Linux.  
**Project Type**: CLI (mesmo pacote).  
**Performance Goals**: tecla de rolagem < 100 ms e digitação < 50 ms com conversa de 5.000 linhas (SC‑004); reflow após resize < 1 s (SC‑003).  
**Constraints**: 0 linhas adicionadas ao scrollback do terminal (SC‑001); restauração do console ao sair (SC‑002); modo `-p` inalterado (SC‑007); nenhuma dependência nativa.  
**Scale/Scope**: ~15 arquivos novos/alterados em `src/ui/`, 3 fora dela; 6 dependências novas.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A constituição continua sendo o template não ratificado. Gates avaliados contra os princípios padrão, como na feature 001.

| Gate (princípio padrão) | Pré‑Phase 0 | Pós‑Phase 1 |
|---|---|---|
| **Simplicidade / YAGNI** | PASS — usa primitivas nativas do Ink 8 em vez de bibliotecas de scroll; remark substitui ~1.200 linhas de parser próprio | PASS — 6 dependências novas, todas justificadas em R8; nenhuma abstração sem uso |
| **CLI texto I/O** | PASS — `-p` permanece texto cru em stdout | PASS — contrato em [contracts/terminal-io.md](./contracts/terminal-io.md) |
| **Testabilidade** | PASS — viewport, parser e banner são puros/testáveis com stdout falso | PASS — estratégia em research R7 |
| **Segurança de credenciais** | PASS — sem impacto | PASS |
| **Observabilidade mínima** | PASS — aviso único quando degrada (sem tela alternativa / terminal pequeno) | PASS |

**Violações a justificar**: nenhuma.

## Project Structure

### Documentation (this feature)

```text
specs/002-fullscreen-ui-markdown/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ui-layout.md            # regiões, alturas, modos, teclas, indicador
│   ├── markdown-rendering.md   # mapeamento mdast → visual, linguagens, invariantes de streaming
│   └── terminal-io.md          # sequências escritas/lidas, flags, env, settings
├── checklists/requirements.md
└── tasks.md                    # /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── cli/
│   ├── args.ts                 # + --no-altscreen
│   └── interactive.ts          # render({ alternateScreen }), ativa/desativa mouse, aviso de degradação
├── config/
│   └── schema.ts               # + ui.altScreen (bool, default true), ui.mouse (bool, default true)
├── utils/
│   └── width.ts                # wrappers de string-width (truncate/pad por largura visual)
└── ui/
    ├── App.tsx                 # layout raiz: Box height=rows; Header(1 linha) | Transcript(flexGrow) | Confirmation | Input | Status
    ├── banner.ts               # arte em blocos (grande/compacta) e escolha por capacidades
    ├── components/
    │   ├── Banner.tsx          # gradiente (ink-gradient) ou texto simples
    │   ├── Header.tsx          # 1 linha: provedor/modelo · cwd · versão
    │   ├── Transcript.tsx      # viewport rolável: overflow=hidden + contentOffsetY, mede conteúdo, indicador, aviso "↓ novo"
    │   ├── ScrollIndicator.tsx
    │   ├── MessageList.tsx     # itens: banner, mensagens (Markdown p/ assistant, Text p/ user/tool), notices
    │   ├── InputPrompt.tsx     # + crescimento até 10 linhas e rolagem interna do texto
    │   ├── StatusBar.tsx       # + dicas de rolagem; aviso de tamanho mínimo
    │   └── ConfirmationDialog.tsx
    ├── markdown/
    │   ├── parse.ts            # unified().use(remarkParse).use(remarkGfm) → mdast (memo por texto)
    │   ├── Markdown.tsx        # mdast → Ink (heading, paragraph, list, blockquote, code, table, thematicBreak, html como texto)
    │   ├── Inline.tsx          # strong, emphasis, delete, inlineCode, link, text, break
    │   ├── CodeBlock.tsx       # moldura, rótulo da linguagem, linhas destacadas
    │   ├── Table.tsx           # colunas alinhadas por largura visual, truncamento
    │   ├── highlight.ts        # lowlight com linguagens registradas; hast → spans coloridos
    │   └── theme.ts            # cores por token hljs e por elemento; variante sem cor
    └── hooks/
        ├── useTerminalCapabilities.ts  # columns, rows, color, altScreen, mouse, compact, tooSmall
        ├── useViewport.ts              # offset, follow, scrollBy/page/home/end, clamp, newBelow
        ├── useMouseWheel.ts            # ?1002h/?1006h, parse SGR, wheel → scrollBy(±3)
        ├── useKeyboard.ts              # + PageUp/PageDown/Home/End/Shift+↑↓ → viewport
        └── useSession.ts

tests/
├── unit/ui/markdown/*.test.tsx      # cada elemento FR-015; highlight; tabela larga; sem cor; malformado
├── unit/ui/banner.test.ts(x)        # variantes por colunas/linhas/cor
├── unit/ui/useViewport.test.ts      # clamp, follow, newBelow, resize
├── integration/ui/App.layout.test.tsx # frame ≤ rows em 24/40 linhas; digitação não altera altura; rolagem; indicador
├── integration/ui/streaming.test.tsx  # incremental == única
└── contract/terminal-io.test.ts      # sequências de mouse escritas/limpas; flag/env/settings → capacidades
```

**Structure Decision**: A feature fica contida em `src/ui/` mais três pontos de integração. O módulo `ui/markdown/` é isolado (recebe string, devolve elementos Ink) para poder ser testado por snapshot e reutilizado futuramente em painéis de agentes.

## Complexity Tracking

Nenhuma violação. Tabela intencionalmente vazia.

## Phase 0 — Research (concluída)

[research.md](./research.md): R1 causa raiz e correção do scrollback (alternateScreen + altura limitada); R2 viewport com `contentOffsetY`, teclas e mouse SGR; R3 banner em blocos com gradiente, como primeiro item do transcript; R4 remark + GFM + lowlight, streaming por re‑parse da mensagem parcial; R5 capacidades e degradação; R6 resize; R7 testes; R8 dependências. Nenhum `NEEDS CLARIFICATION` pendente.

## Phase 1 — Design (concluída)

- [data-model.md](./data-model.md) — `TerminalCapabilities`, `ViewportState`, `TranscriptItem`, `RenderedBlock`, `BannerVariant`, transições do viewport.
- [contracts/ui-layout.md](./contracts/ui-layout.md), [contracts/markdown-rendering.md](./contracts/markdown-rendering.md), [contracts/terminal-io.md](./contracts/terminal-io.md).
- [quickstart.md](./quickstart.md) — como instalar as dependências, rodar e validar visualmente cada história.
- `CLAUDE.md` atualizado pelo script de contexto.

## Phase 2 — Próximo passo

`/speckit.tasks`. Ordem sugerida: capacidades + layout de altura limitada + alternateScreen (US1) → viewport e indicador (US2) → banner (US3) → markdown (US4) → polish (desempenho com 5.000 linhas, portabilidade).

## Riscos

| Risco | Mitigação |
|---|---|
| Console padrão do Windows (conhost) sem VT habilitado não entra na tela alternativa | O Ink só ativa em modo interativo; altura limitada evita o scrollback mesmo assim; `--no-altscreen` como escape |
| Eventos de mouse SGR chegando como texto no prompt em terminais parciais | Filtro na leitura de stdin descarta sequências `\x1b[<...M/m`; desligável por `ui.mouse: false` |
| Re‑parse do markdown a cada delta em respostas muito longas | Memo por mensagem concluída; parse só da parcial; medir com 50 KB de texto (meta < 50 ms por tecla) |
| `ink-gradient` 4 com Ink 8 (peer `>=6`) | Smoke test no quickstart; fallback para `<Text color>` simples se falhar |
| Medição de altura via `useBoxMetrics` atrasada em 1 frame | `useViewport` recalcula no efeito pós‑render e re‑clampa |
