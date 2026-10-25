# Implementation Plan: Colar Arquivos, Copiar Seleção e Colagens Grandes no Console

**Branch**: `007-paste-copy-console` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-paste-copy-console/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Três recursos de console no espírito do qwen-code. (1) **Colagens grandes** detectadas pelo `usePaste` do Ink (bracketed paste) viram um marcador indivisível no prompt — um code point de uso privado ligado a um registro de chips — exibido como `[Pasted text #N +L lines]`; no envio o marcador é expandido para o conteúdo completo em bloco delimitado, enquanto transcrição e histórico guardam só o rótulo. (2) **Arquivos colados/arrastados** são reconhecidos como caminhos e viram marcadores `[Arquivo: …]` (texto, lido no envio) ou `[Imagem: …]` (parte `image` para provedores com suporte, Claude), com recusas explicadas para binários, tamanhos e caminhos fora da pasta. (3) **Copiar selecionando com o mouse**: o rastreamento SGR já ativo passa a tratar botão/arrasto/soltar, a seleção é guardada em coordenadas de conteúdo, o destaque é desenhado por overlay, e o texto é extraído do último frame (um `FrameRecorder` envolve o stdout) e copiado pelo utilitário do sistema ou OSC 52; `/mouse` alterna o rastreamento. Nenhuma dependência nova. Detalhes em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.  
**Primary Dependencies**: existentes — `ink` 8 (`usePaste`, `useBoxMetrics` com `left/top`, `useInput`), `node:child_process` (`execFile` para clip/pbcopy/xclip/wl-copy/xsel), `node:fs` (anexos), `zod` (limites). Nenhuma nova.  
**Storage**: `settings.json` ganha `ui.pasteCollapseLines`, `ui.attachMaxBytes`, `ui.attachMaxTotalBytes`, `ui.imageMaxBytes`; `history.jsonl` continua texto (rótulos); nada mais persistido.  
**Testing**: `vitest`; `renderSized`/`mountApp` com `stdin` falso para colagens (`\x1b[200~…\x1b[201~`) e relatos SGR; `copyToClipboard` com `exec` e `stdout` injetados; `FakeProvider` para verificar o texto/partes recebidos.  
**Target Platform**: Windows Terminal/ConPTY, macOS Terminal/iTerm2, Linux (X11/Wayland); cópia por utilitário do sistema com OSC 52 como alternativa.  
**Project Type**: CLI (mesmo pacote).  
**Performance Goals**: colapso de 500 linhas < 100 ms; destaque de seleção no mesmo frame do movimento; cópia < 200 ms; captura de frame sem custo perceptível (apenas guarda a última string).  
**Constraints**: campos de diálogo e `-p` nunca colapsam/anexam; conteúdo colado nunca entra em `history.jsonl`/logs; o lado esquerdo da barra de status não é cortado; mouse desligado = zero sequências escritas; imagens só com `capabilities.images`.  
**Scale/Scope**: 7 arquivos novos em `src/` (`ui/chips.ts`, `ui/attachments.ts`, `ui/selection.ts`, `ui/frameRecorder.ts`, `ui/hooks/useMouseSelection.ts`, `utils/clipboard.ts`, `ui/components/ChipPanel.tsx`), ~12 alterados; ~9 arquivos de teste novos.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constituição v1.0.0.

| Gate | Pré‑Phase 0 | Pós‑Phase 1 |
|---|---|---|
| **I. Simplicidade / YAGNI** | PASS — marcador = 1 code point; sem reescrever o editor; sem deps | PASS — captura do frame em vez de renderização offscreen |
| **II. CLI texto I/O** | PASS — `-p` intacto | PASS |
| **III. Testabilidade** | PASS — chips, anexos, seleção e clipboard puros/injetáveis | PASS — research R12 |
| **IV. Segurança de credenciais** | PASS — conteúdo colado fora de histórico e logs; chaves em diálogos não colapsam | PASS — contrato paste-chips § 4 |
| **V. Observabilidade mínima** | PASS — `paste.chip { kind, lines/bytes }`, `clipboard.copy { method, ok, lines }` sem conteúdo | PASS |
| **VI/VII. Open-source / atribuição** | PASS — sem código de terceiros copiado (o comportamento do qwen-code é inspiração; UI própria) | PASS |

**Violações a justificar**: a UI passa a escrever uma segunda sequência de escape própria (OSC 52 em `utils/clipboard.ts`), além do rastreamento do mouse. Justificada: é a única via de cópia em sessões remotas; fica isolada num módulo com teste, e `CLAUDE.md` registra a exceção.

## Project Structure

### Documentation (this feature)

```text
specs/007-paste-copy-console/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── paste-chips.md       # colagem → marcador, edição, envio, histórico, limites
│   ├── attachments.md       # caminhos, classificação, envio, configuração
│   └── mouse-selection.md   # eventos SGR, coordenadas, modos, cópia, /mouse, frame
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── ui/
│   ├── chips.ts                      # NOVO: ChipRegistry, chipChar/chipIdOf/chipLabel, labelChips/relinkChips/expandChips
│   ├── attachments.ts                # NOVO: splitPastedPaths, resolvePastedPath, classifyPath, IMAGE_TYPES, rejectionMessage
│   ├── selection.ts                  # NOVO: selectionReducer, selectedRange, extractText, isSelected (puro)
│   ├── frameRecorder.ts              # NOVO: FrameRecorder (stdout proxy + último frame sem ANSI), ContentLineCache, screenToContent
│   ├── hooks/useMouseSelection.ts    # NOVO: press/drag/release → reducer → copy; convive com useMouseWheel (mesmo canal SGR)
│   ├── hooks/useMouseWheel.ts        # parseSgrMouse exporta também button/press/drag; `enabled` vem do controller
│   ├── components/InputPrompt.tsx    # usePaste; chips na largura/renderização; Ctrl+O; onSubmit(PromptSubmission); relink no histórico
│   ├── components/ChipPanel.tsx      # NOVO: painel de expansão (Ctrl+O)
│   ├── components/Transcript.tsx     # useBoxMetrics top/left → geometry; overlay de seleção (inverse por célula)
│   ├── components/MessageList.tsx    # (sem mudança de conteúdo; recebe selection para o overlay por linha)
│   ├── components/StatusBar.tsx      # `mouse desligado`; transient `copiado (N linhas)`
│   ├── hooks/useSession.ts, App.tsx  # chips, mouseEnabled, geometry, onCopy → controller.showTransient
├── cli/interactive.ts                # envolve stdout no FrameRecorder antes do render
├── session/
│   ├── session.ts                    # pushUser(text, display?, extra?: ContentPart[])
│   ├── controller.ts                 # chips: ChipRegistry; mouseEnabled/setMouse; submit(PromptSubmission | string); logs paste.chip / clipboard.copy
│   └── commands.ts                   # /mouse [on|off]; /help
├── providers/
│   ├── types.ts                      # ContentPart image; ModelProvider.capabilities
│   ├── anthropicProtocol.ts, claude.ts  # image → bloco base64; capabilities.images = true
│   └── qwen.ts                       # descarta image com aviso
├── config/schema.ts, defaults.ts     # ui.* limites + comentário
└── utils/clipboard.ts                # NOVO: copyToClipboard (execFile em ordem, OSC 52)

tests/
├── unit/ui/{chips,attachments,selection}.test.ts, unit/ui/InputPrompt.paste.test.tsx, unit/ui/frameRecorder.test.ts   # NOVOS
├── unit/utils/clipboard.test.ts                                                                                       # NOVO
├── integration/ui/paste.test.tsx, integration/ui/mouseSelection.test.tsx                                               # NOVOS
├── contract/terminal-io.test.ts, contract/conversion.test.ts, contract/config-schema.test.ts                           # estendidos
├── unit/session/commands.test.ts, unit/security/noSecrets.test.ts                                                      # estendidos
└── helpers/appHarness.tsx                                                                                              # KEYS.paste(text), KEYS.mouse(button,x,y,release), ctrlO
```

**Structure Decision**: tudo que é lógica pura (chips, anexos, seleção, extração, clipboard) fica em módulos sem React para teste direto; os hooks (`usePaste` no prompt, `useMouseSelection`) só ligam eventos a esses módulos. O marcador como code point de uso privado evita reescrever o editor; o `FrameRecorder` no `interactive.ts` é a única mudança no caminho de saída e é transparente (repassa cada `write`). O registro de chips vive no controller (por sessão) para que o histórico ↑/↓ e o `submit` o compartilhem.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| OSC 52 escrito pela UI (`utils/clipboard.ts`) | cópia em SSH/terminais sem utilitário local | sem ela a cópia falharia exatamente onde a seleção nativa já é mais difícil; módulo isolado e testado |

## Phase 0 — Research (concluída)

[research.md](./research.md): R0 estado atual; R1 `usePaste`; R2 marcadores PUA; R3 blocos delimitados; R4 caminhos; R5 seleção e captura de frame; R6 clipboard; R7 `/mouse`; R8 Ctrl+O; R9 imagens por provedor; R10 configuração; R11 histórico; R12 testes. Sem `NEEDS CLARIFICATION`.

## Phase 1 — Design (concluída)

- [data-model.md](./data-model.md) — chips, anexos, `PromptSubmission`, `ContentPart image`/`capabilities`, reducer de seleção, geometria/frame, clipboard, controller/config/barra.
- [contracts/paste-chips.md](./contracts/paste-chips.md), [contracts/attachments.md](./contracts/attachments.md), [contracts/mouse-selection.md](./contracts/mouse-selection.md).
- [quickstart.md](./quickstart.md).
- `CLAUDE.md` atualizado pelo script de contexto.

## Phase 2 — Próximo passo

`/speckit.tasks`. Ordem sugerida: fundação (`chips.ts`, `attachments.ts`, `selection.ts`, `clipboard.ts`, `frameRecorder.ts`, schema/defaults, `ContentPart image` + conversões, helpers de teste) → US1 (`usePaste` + chips no prompt, Ctrl+O, `PromptSubmission`, controller/session, histórico com relink, testes) → US2 (caminhos → chips, recusas, leitura no envio, testes) → US3 (`useMouseSelection`, geometria no `Transcript`, overlay, `FrameRecorder` no `interactive.ts`, `/mouse`, barra, testes) → US4 (imagens: capacidade do provedor, bloco base64, testes) → polish (README, `/help`, CLAUDE.md, quickstart).

## Riscos

| Risco | Mitigação |
|---|---|
| Terminal sem bracketed paste | colagem vira digitação (comportamento atual); documentado; caminhos ainda podem ser colados e enviados como texto |
| `useBoxMetrics` `top` relativo ao pai, não à tela | medir o Box de coluna do `Transcript` (filho direto da raiz) e somar o `top` do `outer`; teste de geometria com cabeçalho de 1 linha |
| Frame capturado em partes (Ink escrevendo em vários `write`) | o harness de testes já assume um `write` por frame; o `FrameRecorder` concatena chunks sem `\n` final até o próximo frame e usa o último com altura = `rows` |
| Cópia em ambientes sem utilitário (WSL sem `clip.exe` no PATH) | ordem de tentativas + OSC 52 + aviso com `/mouse off` |
| Drag reportado sem movimento intermediário (multiplexadores) | seleção entre pressionar e soltar |
| Colagem contendo code points PUA | substituídos por `�` ao inserir (nunca viram chips falsos) |
| Chips de imagem após trocar de provedor | aviso no envio e parte descartada; o texto segue |
| Overlay de seleção custoso em transcrições grandes | só as linhas visíveis recebem `inverse`; o cálculo é por linha visível |
