---

description: "Task list for Colar Arquivos, Copiar Seleção e Colagens Grandes no Console"
---

# Tasks: Colar Arquivos, Copiar Seleção e Colagens Grandes no Console

**Input**: Design documents from `/specs/007-paste-copy-console/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (paste-chips.md, attachments.md, mouse-selection.md), quickstart.md

**Tests**: O plano define a estratégia (research R12 e § "Testes que fixam este contrato" de cada contrato): chips, anexos, seleção e clipboard testados como módulos puros; o prompt com `ink-testing-library` e colagens entre `\x1b[200~`/`\x1b[201~`; a UI com `mountApp`, relatos SGR falsos e `copy` injetado; os provedores pelos testes de conversão. As tarefas de teste abaixo implementam exatamente esses casos. Nenhum teste acessa a rede nem a área de transferência real.

**Organization**: Tarefas por história de usuário. Nenhuma dependência nova de runtime.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: História a que a tarefa pertence (US1, US2, US3, US4)
- Caminhos exatos em cada descrição

## Path Conventions

Projeto único: `src/` e `tests/` na raiz, conforme plan.md § Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Teclas e eventos novos no harness de testes.

- [X] T001 Em `tests/helpers/appHarness.tsx`, adicionar a `KEYS`: `ctrlO: '\x0f'`, `paste(text) => '\x1b[200~' + text + '\x1b[201~'`, `mouse(button, x, y, release = false) => '\x1b[<' + button + ';' + x + ';' + y + (release ? 'm' : 'M')`; em `HarnessOptions`, `copy?: (text: string) => Promise<CopyResult>` repassado ao `App` (prop `copy`) e `mouse?: boolean` inicial
- [X] T002 [P] Em `tests/helpers/renderSized.ts`, expor `frameText()` (último frame sem ANSI, via regex `/\x1b\[[0-9;?]*[A-Za-z]/g`) e `SizedStdout.frames` já existente para os testes de `FrameRecorder`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Módulos puros (chips, anexos, seleção, clipboard, frame), configuração, parte `image` nos provedores. Bloqueia todas as histórias.

- [X] T003 [P] Criar `src/ui/chips.ts` conforme data-model § 1: `CHIP_BASE`, tipos `Chip`, `ChipRegistry` (`add`, `get`, `byLabel`, `all`; `seq` por `kind`), `chipChar`, `chipIdOf`, `chipLabel` (`[Pasted text #N +L lines]`, `[Arquivo: nome, N linhas]`, `[Imagem: nome, 120 KB]` com `formatBytes`), `labelChips`, `relinkChips`, `expandChips(text, reg, read)` (blocos `<pasted-text id lines>`, `<file path lines>`, `[Imagem: nome]`; prefixo `The user attached the following content:` quando o texto sem chips é vazio), `chipsIn`, `countLines(text)` e `sanitizePaste(text)` (PUA → `�`, `\r\n` → `\n`)
- [X] T004 [P] Criar `tests/unit/ui/chips.test.ts`: `countLines` (com e sem quebra final), `seq` por tipo (#1, #2 de paste; Arquivo independente), `labelChips`/`relinkChips` inversos para rótulos conhecidos e rótulo desconhecido mantido como texto, `expandChips` com os três blocos e o prefixo, `sanitizePaste` remove PUA
- [X] T005 [P] Criar `src/ui/attachments.ts` conforme data-model § 2: `splitPastedPaths` (quebras de linha, espaços fora de aspas, aspas simples/duplas, `file://` decodificado, `~`), `resolvePastedPath(token, cwd, env)` (só arquivos existentes), `IMAGE_TYPES`, `classifyPath(abs, cwd, limits, imagesOk)` (`outside` por `path.relative` começando com `..`; binário = NUL nos primeiros 8 KB; `too-large`; `image`/`image-too-large`/`images-unsupported`; `lines` por `countLines`), `rejectionMessage` com os textos de contracts/attachments.md § 2, `formatBytes`
- [X] T006 [P] Criar `tests/unit/ui/attachments.test.ts` com arquivos temporários: tokenização (`"C:\a b\x.log"`, `'y.ts'`, `file:///…`, `~/z.md`, dois caminhos por linha), classificação de texto/binário/grande/fora/imagem (com e sem `imagesOk`), tokens inexistentes/pastas ignorados, mensagens de recusa exatas
- [X] T007 [P] Criar `src/ui/selection.ts` conforme data-model § 5: `Point`, `SelectionState`, `SelectionEvent`, `selectionReducer` (press inicia `dragging` em modo `char`; press na mesma célula ≤ 400 ms do último clique → `word`/`line`; drag move `head`; release sem movimento em `char` → `idle`; release com seleção → `done` com `text`/`lines` via `extractText`; clear → `idle`), `selectedRange`, `extractText(range, lineText)` (pontas por coluna, linhas intermediárias inteiras, modo palavra `\S+`, modo linha), `isSelected(sel, line, col)`
- [X] T008 [P] Criar `tests/unit/ui/selection.test.ts`: arrasto em uma linha, em várias linhas (incluindo arrasto para cima: normalização), clique sem movimento, duplo/triplo clique por tempo e célula, `extractText` com linhas ausentes no cache (vazias), `isSelected` nas bordas
- [X] T009 [P] Criar `src/utils/clipboard.ts` conforme data-model § 7: `copyToClipboard(text, { platform, stdout, exec, env })` tentando em ordem `clip.exe` → `powershell -NoProfile -Command Set-Clipboard` (win32), `pbcopy` (darwin), `wl-copy` → `xclip -selection clipboard` → `xsel --clipboard --input` (linux), cada um por `execFile` injetável com stdin = texto e timeout 2 s; ausência (`ENOENT`) ou erro → próximo; nenhum → OSC 52 (`\x1b]52;c;<base64>\x07`) em `stdout` quando for TTY → `{ ok: true, method: 'osc52' }`; senão `{ ok: false, error }`
- [X] T010 [P] Criar `tests/unit/utils/clipboard.test.ts`: ordem por plataforma com `exec` falso (primeiro falha com ENOENT → segundo usado), texto entregue no stdin, OSC 52 com base64 correto no `stdout` falso, `ok: false` sem TTY e sem utilitário
- [X] T011 [P] Criar `src/ui/frameRecorder.ts` conforme data-model § 6: `FrameRecorder` (proxy de `NodeJS.WriteStream`: `write` repassa e guarda o último frame — chunk cujo texto sem ANSI tem ≥ 2 linhas —, getters `columns`/`rows`/`isTTY`, `on/off/once/emit` delegados para `resize`), `stripAnsi`, `ContentLineCache` (`update(frameLines, geometry)` mapeia as linhas `transcriptTop..transcriptTop+viewportHeight` para `offset + i`; `get(line)`), `screenToContent(ev, geometry)` (undefined fora do retângulo; colunas limitadas à largura)
- [X] T012 [P] Criar `tests/unit/ui/frameRecorder.test.ts`: `write` repassa byte a byte e expõe tamanho/TTY/resize do stream real falso; último frame sem ANSI; cache por linha de conteúdo com offset; `screenToContent` dentro/fora do retângulo
- [X] T013 Em `src/config/schema.ts` e `src/config/defaults.ts`, adicionar a `uiSettingsSchema`/`INITIAL_SETTINGS.ui`: `pasteCollapseLines` (int ≥ 1, padrão 3), `attachMaxBytes` (int ≥ 1024, padrão 524288), `attachMaxTotalBytes` (padrão 2097152), `imageMaxBytes` (padrão 5242880), com comentário; estender `tests/contract/config-schema.test.ts` (padrões, mínimos, chave desconhecida)
- [X] T014 Em `src/providers/types.ts`: `ContentPart` += `{ type: 'image'; mediaType: string; data: string; name?: string }`; `ModelProvider.capabilities?: { images?: boolean }`; em `src/providers/anthropicProtocol.ts`, mensagens do usuário com partes `image` viram `content: [{ type: 'image', source: { type: 'base64', media_type, data } }, { type: 'text', text }]`; em `src/providers/claude.ts`, `capabilities: { images: true }`; em `src/providers/qwen.ts`, partes `image` são descartadas (texto segue) e o provedor emite `notice`/warn uma vez por requisição; `textOf` em `src/ui/components/MessageList.tsx` continua ignorando partes não‑texto
- [X] T015 [P] Estender `tests/contract/conversion.test.ts` (usuário com `image` → bloco base64 no Claude; descartado no Qwen) e `tests/unit/providers/claude.test.ts` (`capabilities.images === true`)
- [X] T016 Em `src/session/session.ts`, `pushUser(text, display?, extra?: ContentPart[])` acrescenta `extra` ao `content`; em `src/session/controller.ts`, `chips = new ChipRegistry()` por sessão, `mouseEnabled` (inicial `ctx.settings.ui.mouse`), `setMouse(on)` com transient `mouse on|off`, e `submit(input: string | PromptSubmission, opts)` (string → fluxo atual; `PromptSubmission` → `history.push(display)`, `pushUser(text, display, parts)`, avisos em `warn`, log `paste.chip { kind, lines|bytes }` por chip enviado); estender `tests/unit/session/session.test.ts` e `tests/unit/session/commands.test.ts` (`submit` com `PromptSubmission` grava `display`, envia `text`, partes no `content`)

**Checkpoint**: módulos puros e provedores verdes; UI ainda sem colagem/mouse.

---

## Phase 3: User Story 1 — Colar um texto grande sem poluir o prompt (Priority: P1) 🎯 MVP

**Goal**: Colagem > N linhas vira marcador; edição como unidade; Ctrl+O; envio expandido com `display` rotulado; histórico com relink.

**Independent Test**: `tests/unit/ui/InputPrompt.paste.test.tsx` + `tests/integration/ui/paste.test.tsx` (contracts/paste-chips.md § 1–5).

- [X] T017 [US1] Em `src/ui/components/InputPrompt.tsx`: props `chips: ChipRegistry`, `limits: { pasteCollapseLines, attachMaxBytes, attachMaxTotalBytes, imageMaxBytes }`, `cwd`, `imagesOk`, `onNotice(text, level)`; `onSubmit` passa a receber `PromptSubmission`; `usePaste(handlePaste, { isActive: active })` com `sanitizePaste` → (US2 decide caminhos) → `countLines > pasteCollapseLines` ? inserir `chipChar(reg.add({ kind: 'paste', text, lines }))` : inserir literal; `widthOf(ch)` = `visualWidth(chipLabel)` para PUA usado em `layoutInput`; renderização desenha o rótulo em `cyan` (`inverse` quando o cursor está sobre ele); Enter monta `PromptSubmission` (`display = labelChips`, `text = expandChips` com leitura via `readChip`, `warnings`, `parts`) e recusa envio acima de `attachMaxTotalBytes` com aviso
- [X] T018 [US1] Em `src/ui/components/InputPrompt.tsx`, Ctrl+O: `expandedChip` = chip sob/antes do cursor; fecha ao digitar, mover para fora ou Ctrl+O; criar `src/ui/components/ChipPanel.tsx` (20 primeiras linhas + `… +K linhas`, ou `tipo · tamanho` para imagem) renderizado abaixo das sugestões
- [X] T019 [US1] Em `src/ui/components/InputPrompt.tsx`, ao carregar uma entrada do histórico (↑/↓), aplicar `relinkChips(entry, chips)`; em `src/ui/hooks/useSession.ts`/`src/ui/App.tsx`, passar `chips`, `limits` (de `controller.settings.ui`), `cwd`, `imagesOk` (`controller.activeProvider.capabilities?.images`), `onNotice` e o novo `onSubmit` (`controller.submit(submission)`)
- [X] T020 [P] [US1] Criar `tests/unit/ui/InputPrompt.paste.test.tsx` com `render` + `KEYS.paste`: 2 linhas → literal; 5 linhas → `[Pasted text #1 +5 lines]` e segunda colagem `#2`; ← → pulam; Backspace remove inteiro; Ctrl+O mostra as linhas e fecha; Enter → `onSubmit` com `display` rotulado e `text` com o bloco `<pasted-text id="1" lines="5">`; colagem contendo PUA → `�`
- [X] T021 [US1] Criar `tests/integration/ui/paste.test.tsx` com `mountApp`: colar 42 linhas, digitar em volta, Enter → `provider.requests[0].messages[0]` tem o texto com o bloco completo (byte a byte) e `display` com o rótulo; transcrição mostra `› explique: [Pasted text #1 +42 lines]`; ↑ recupera o marcador e reenvia o conteúdo; `history.jsonl` (via `withTempHome`) contém o rótulo e não o conteúdo; total acima de `attachMaxTotalBytes` → aviso e sem requisição
- [X] T022 [P] [US1] Estender `tests/unit/security/noSecrets.test.ts`: texto colado com um segredo vai para o provedor, mas não para `history.jsonl` nem para o `debug.log` (só `paste.chip { kind, lines }`)

**Checkpoint**: US1 completa (quickstart 1–3).

---

## Phase 4: User Story 2 — Colar ou arrastar arquivos (Priority: P2)

**Goal**: Caminhos colados viram anexos de texto; recusas explicadas; conteúdo lido no envio.

**Independent Test**: `tests/unit/ui/attachments.test.ts` + `tests/integration/ui/paste.test.tsx` (cenários de arquivo).

- [X] T023 [US2] Em `src/ui/components/InputPrompt.tsx` (`handlePaste`): antes da regra de colapso, `splitPastedPaths` + `resolvePastedPath`; tokens resolvidos → `classifyPath` → chips `file` (ou `image`, US4) ou `onNotice(rejectionMessage, 'warn')` mantendo o token como texto; tokens não resolvidos ficam texto; a colagem só segue para a regra de colapso quando nenhum token é caminho
- [X] T024 [US2] Em `src/ui/components/InputPrompt.tsx` (`readChip` no Enter): arquivos lidos no envio (`fs.readFileSync`), `lines` recontadas, arquivo ausente → `warnings` + `<file path="…" missing="true"/>`; em `src/ui/components/ChipPanel.tsx`, chips de arquivo mostram caminho relativo, tamanho e as 20 primeiras linhas
- [X] T025 [US2] Estender `tests/integration/ui/paste.test.tsx` com `tests/helpers/tempRepo.ts` (arquivos reais): colar o caminho de um `.log` → `[Arquivo: x.log, N linhas]` e bloco `<file path="x.log" lines="N">` no provedor; dois caminhos com aspas e quebra de linha → dois marcadores; `.bin` com NUL → aviso de binário e caminho como texto; caminho fora do cwd → aviso; arquivo apagado antes do Enter → `missing="true"` e aviso

**Checkpoint**: US2 completa (quickstart 4).

---

## Phase 5: User Story 3 — Copiar do console selecionando com o mouse (Priority: P2)

**Goal**: Press/drag/release na transcrição → destaque → cópia; `/mouse`; `FrameRecorder` no caminho de saída.

**Independent Test**: `tests/integration/ui/mouseSelection.test.tsx` + `tests/contract/terminal-io.test.ts` (contracts/mouse-selection.md).

- [X] T026 [US3] Em `src/ui/hooks/useMouseWheel.ts`, estender `SgrMouseEvent` com `kind: 'press' | 'drag' | 'release' | 'wheel' | 'other'` derivado do botão (0 press/release, 32 drag, 64/65 wheel) e exportar `classifyMouse`; manter `wheelDirection`
- [X] T027 [US3] Criar `src/ui/hooks/useMouseSelection.ts`: `useMouseSelection({ enabled, geometry: () => MouseGeometry, cache: ContentLineCache, onChange(sel), onCopy(result) })` — ouve `stdin` `data`, `parseSgrMouse` → `screenToContent` → `selectionReducer`; em `done` com texto não vazio chama `copyToClipboard` (injetável via prop `copy`) e `onCopy({ ok, method, lines })`; `clear` em `enabled=false`
- [X] T028 [US3] Em `src/cli/interactive.ts`, envolver o stdout real num `FrameRecorder` passado ao `render` e ao `App` (prop `frame`); em `src/ui/App.tsx`, criar o `ContentLineCache`, calcular `geometry` a partir de `useBoxMetrics` do Box de coluna do `Transcript` (ref novo `transcriptRef` exposto por prop) + `viewportRef` (offset/altura; expor `state` nas `ViewportActions` ou um `getState()`), atualizar o cache a cada frame (`frame.lines()` em `useEffect` após cada render), ligar `useMouseSelection` com `enabled: controller.mouseEnabled`, `copy` (prop ou `copyToClipboard`), `onCopy` → `controller.showTransient('copiado (N linhas)')` ou aviso de falha com `/mouse off`; digitar/Esc/novo clique → `clear`
- [X] T029 [US3] Em `src/ui/components/Transcript.tsx` e `src/ui/components/MessageList.tsx`, receber `selection` e desenhar o overlay: para cada linha visível selecionada, renderizar uma `Box` absoluta (`position="absolute"`) com `Text inverse` cobrindo as colunas selecionadas sobre a linha (Ink 8 suporta `position="absolute"`; se não, aplicar `inverse` por linha inteira como alternativa documentada); indicador de rolagem fora da seleção
- [X] T030 [P] [US3] Em `src/session/commands.ts`, comando `/mouse [on|off]` (sem argumento alterna; em `-p` informa); `/help` com `/mouse`, seleção e cópia; em `src/ui/components/StatusBar.tsx`, `mouse desligado` no lado esquerdo quando `mouseEnabled === false` (prop nova); em `src/ui/hooks/useSession.ts`, expor `mouseEnabled`; `useMouseWheel` passa a receber `enabled: caps.mouse && snap.mouseEnabled`
- [X] T031 [P] [US3] Estender `tests/contract/terminal-io.test.ts`: com `mouseEnabled=false` zero sequências `?1002h`/`?1006h` são escritas (e a de desligar é escrita ao alternar de on para off); `FrameRecorder` repassa cada `write` ao stream real e expõe `columns/rows/isTTY`; `classifyMouse` para os cinco tipos
- [X] T032 [US3] Criar `tests/integration/ui/mouseSelection.test.tsx` com `mountApp({ copy })` e `linesProvider(40)`: `KEYS.mouse(0,x,y)` + `KEYS.mouse(32,…)` + `KEYS.mouse(0,…,true)` sobre três linhas → `copy` recebe exatamente as três linhas visíveis (sem ANSI, sem `▐`), barra mostra `copiado (3 linhas)`, destaque invertido presente no frame; clique sem arrasto → `copy` não chamado; duplo clique → palavra; rolar com a roda durante o arrasto mantém a âncora (texto copiado inclui linhas que saíram da tela); `/mouse off` → eventos ignorados e `mouse desligado` na barra; `copy` devolvendo `ok: false` → aviso com `/mouse off`
- [X] T033 [P] [US3] Estender `tests/unit/session/commands.test.ts` (`/mouse`, `/mouse off`, `/mouse on`, `-p` informa) e `tests/unit/ui/InputPrompt.editor.test.tsx` (digitar após uma seleção dispara `onSelectionClear` — ou verificar via App que o destaque some ao digitar)

**Checkpoint**: US3 completa (quickstart 6–7).

---

## Phase 6: User Story 4 — Imagens para provedores que as aceitam (Priority: P3)

**Goal**: Caminho de imagem → chip `image` quando o provedor ativo declara suporte; parte `image` enviada.

**Independent Test**: `tests/integration/ui/paste.test.tsx` (cenários de imagem) + conversão (já na fundação).

- [X] T034 [US4] Em `src/ui/components/InputPrompt.tsx`: `classifyPath(..., imagesOk)` → chip `image` (`[Imagem: nome, 120 KB]`); no Enter, ler o arquivo em base64 para `parts` e substituir o chip por `[Imagem: nome]` no `text`; `imagesOk` falso → `rejectionMessage('images-unsupported')`; acima de `imageMaxBytes` → `image-too-large`; `ChipPanel` mostra `tipo · tamanho`
- [X] T035 [US4] Em `src/session/controller.ts`, ao enviar uma `PromptSubmission` com `parts` para um provedor sem `capabilities.images`, descartar as partes com aviso (`warn`) antes de `pushUser`
- [X] T036 [US4] Estender `tests/integration/ui/paste.test.tsx`: PNG temporário com provedor `capabilities.images: true` → marcador, `content` do usuário com parte `image` (base64 correto, `mediaType: image/png`) e `[Imagem: x.png]` no texto; provedor sem suporte → aviso e caminho como texto; PNG acima do limite → aviso

**Checkpoint**: US4 completa (quickstart 5).

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T037 [P] Em `README.md`: seção **Colar e copiar** (marcadores de colagem, Ctrl+O, arquivos e imagens com limites e recusas, seleção com o mouse e cópia, `/mouse`, Shift+arrasto para a seleção nativa, terminais testados), linhas novas na tabela de comandos/teclas, exemplo de `ui.*` na configuração
- [X] T038 [P] Em `CLAUDE.md` (Code Style e árvore): chips como code points PUA via `ChipRegistry` (nunca texto literal), `PromptSubmission` (`display` × `text` × `parts`), conteúdo colado fora de histórico/logs, `FrameRecorder` como proxy transparente do stdout, OSC 52 em `utils/clipboard.ts` como segunda exceção à regra de escapes, `/mouse`
- [X] T039 Rodar `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` na raiz (`package.json`); corrigir o que falhar em `src/` e `tests/`
- [ ] T040 Executar o quickstart (`specs/007-paste-copy-console/quickstart.md`, cenários 1–9) em Windows Terminal e, se possível, em um terminal macOS/Linux; registrar divergências como tarefas

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → US1 → (US2, US3) → US4 → Polish**. US2 depende de US1 (`handlePaste`, `readChip`, `ChipPanel`). US3 é independente de US1/US2 (só da fundação: seleção, clipboard, frame, `mouseEnabled`). US4 depende de US2 (classificação de caminhos) e da fundação (`image` nos provedores).
- Dentro da fundação, T003–T012 são pares módulo/teste independentes entre si; T013–T016 tocam schema/provedores/sessão e podem correr em paralelo com os módulos puros.
- Dentro de US1: T017 → T018 → T019 → (T020, T021, T022). Dentro de US3: T026 → T027 → T028 → T029 → (T030, T031, T032, T033).

## Parallel Execution Examples

- **Fundação**: T003, T005, T007, T009, T011 (módulos) em paralelo; T004, T006, T008, T010, T012 (testes) em paralelo logo depois; T013, T014/T015, T016 em paralelo com os módulos.
- **US1**: T020 e T022 em paralelo com T021 após T019.
- **US3 e US2** podem ser implementadas em paralelo após US1 (US3 não precisa de US1).
- **Polish**: T037 e T038 em paralelo.

## Implementation Strategy

1. **MVP = Phase 1 + Phase 2 + US1**: colagens grandes colapsadas com conteúdo íntegro ao modelo. Verificável pelos cenários 1–3 do quickstart.
2. **Incremento 2 = US2 + US3**: arquivos colados e cópia por seleção (independentes entre si).
3. **Incremento 3 = US4 + Polish**: imagens, documentação, verificação final.

## Notes

- Marcadores são code points U+E000+; colagens que contenham PUA são saneadas. Nunca tornar rótulos editáveis como texto.
- Conteúdo colado/anexado nunca vai para `history.jsonl` nem para o `--debug` (só tipo, linhas/bytes e método de cópia).
- O `FrameRecorder` deve repassar cada `write` sem alterar bytes nem ordem; qualquer diferença quebra a renderização do Ink.
- Commit da feature: prefixo `fix:` salvo pedido explícito em contrário.
