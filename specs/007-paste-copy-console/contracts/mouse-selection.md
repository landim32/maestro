# Contract — Seleção com o mouse e cópia

**Feature**: `007-paste-copy-console` · **Date**: 2026-10-25

## 1. Eventos reconhecidos (SGR 1002/1006, já ativos)

| Relato | Significado |
|---|---|
| `\x1b[<0;x;yM` | botão esquerdo pressionado na célula (x, y) — 1‑based |
| `\x1b[<32;x;yM` | movimento com o botão esquerdo pressionado |
| `\x1b[<0;x;ym` | botão esquerdo solto |
| `\x1b[<64;…M` / `\x1b[<65;…M` | roda (já tratada) |
| outros botões / Shift+clique | ignorados pelo Maestro (Shift+arrasto é passado pelo terminal à seleção nativa) |

Células fora do retângulo da transcrição (cabeçalho, prompt, barra de status, indicador de rolagem) não iniciam seleção; um arrasto que sai do retângulo é limitado à última linha/coluna válida.

## 2. Coordenadas

`contentLine = y − 1 − transcriptTop + viewportOffset`; `col = x − 1 − transcriptLeft`. A seleção é guardada em coordenadas de conteúdo: rolar com a roda durante o arrasto mantém a âncora e move a extremidade com o conteúdo.

## 3. Modos

- Clique (sem movimento) e soltar: nada selecionado, nada copiado.
- Duplo clique (mesma célula, ≤ 400 ms): seleciona a palavra (`\S+`) sob o cursor.
- Triplo clique: seleciona a linha inteira.
- Arrasto: seleção por caracteres, da âncora à extremidade; linhas intermediárias inteiras.

## 4. Destaque e cópia

- Durante o arrasto e após soltar, as células selecionadas são desenhadas invertidas (sem cor, só `inverse`).
- Ao soltar com seleção não vazia: o texto puro (linhas do conteúdo sem códigos de cor, sem o indicador `▐` de rolagem, com as pontas recortadas por coluna) vai para a área de transferência; a barra de status mostra `copiado (N linhas)` por ~3 s.
- Ordem de tentativa (research R6): `clip.exe` → `powershell Set-Clipboard` (Windows); `pbcopy` (macOS); `wl-copy` → `xclip` → `xsel` (Linux); por fim OSC 52. Falha total: `Não foi possível copiar; use /mouse off e a seleção nativa do terminal.`
- Digitar qualquer tecla, Esc ou um novo clique limpam o destaque.

## 5. Alternância do mouse

- `/mouse` alterna; `/mouse on|off` define; `ui.mouse` dá o estado inicial. Em `-p`, informa apenas.
- Mouse desligado: nenhuma sequência de rastreamento é escrita (teste de E/S), rolagem só pelo teclado, seleção nativa do terminal; a barra mostra `mouse desligado`.
- Ao sair, o rastreamento é desligado como hoje.

## 6. Frame e cache

O Maestro passa ao Ink um `FrameRecorder` que repassa cada `write` ao stdout real (byte a byte, sem atraso) e guarda o último frame. As linhas do frame dentro do retângulo da transcrição alimentam um cache por linha de conteúdo; a extração lê o cache. Linhas nunca exibidas na sessão são copiadas vazias (caso limite documentado).

## 7. Testes que fixam este contrato

- `tests/unit/ui/selection.test.ts` — § 2–3 (reducer, duplo/triplo, normalização, extração).
- `tests/unit/utils/clipboard.test.ts` — § 4 ordem e OSC 52.
- `tests/contract/terminal-io.test.ts` — § 5 (zero sequências com mouse off), § 6 (FrameRecorder repassa tudo e expõe `columns/rows/isTTY/resize`).
- `tests/integration/ui/mouseSelection.test.tsx` — § 1–5 fim a fim com `copy` injetado.
