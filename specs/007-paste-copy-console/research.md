# Research — Colar Arquivos, Copiar Seleção e Colagens Grandes

**Branch**: `007-paste-copy-console` · **Date**: 2026-10-25

Levantamento do estado atual e decisões técnicas. Nenhum `NEEDS CLARIFICATION` ficou aberto.

## R0. Estado atual

| Aspecto | Hoje | Lacuna frente à spec |
|---|---|---|
| Editor do prompt | `InputPrompt` guarda o texto como `string[]` de code points com cursor, `layoutInput` quebra em linhas visuais por `visualWidth`, Backspace/Delete/← → operam por caractere | Falta uma unidade indivisível (marcador) no texto |
| Colagem | Ink entrega texto colado ao `useInput` como uma string só; o prompt insere tudo | Falta distinguir colagem de digitação e colapsar |
| Envio | `onSubmit(text)` → `controller.submit(text)`; `Message.display` já separa o texto exibido do texto enviado (feature 006) | Falta o texto expandido (marcadores → conteúdo) e partes de imagem |
| Mouse | `useMouseWheel` ativa SGR 1002/1006 e só lê a roda; qualquer outro evento é ignorado; a seleção nativa do terminal fica bloqueada | Faltam botão/arrasto/soltar, destaque, cópia |
| Transcrição | `Transcript` com `contentOffsetY` e `useBoxMetrics` (largura/altura; `left`/`top` relativos ao pai) | Falta mapear célula da tela → linha de conteúdo e obter o texto visível |
| Saída | `interactive.ts` passa `process.stdout` ao Ink; o Ink escreve cada frame inteiro numa chamada de `write` (o harness de testes depende disso) | Falta capturar o último frame para extrair o texto selecionado |
| Provedores | `ContentPart` = `text | tool_call | tool_result`; conversões só de texto | Falta `image` e a capacidade por provedor |
| Configuração | `ui.{color, altScreen, mouse}` | Faltam os quatro limites |

## R1. Detecção de colagem

**Decision**: usar o hook `usePaste` do Ink 8, que liga o modo bracketed paste (`?2004h`) enquanto ativo e entrega a colagem inteira numa chamada, **sem** repassá‑la ao `useInput`. O `InputPrompt` passa a ter `usePaste(handlePaste, { isActive: active })`; `useInput` continua para teclas e digitação.

**Rationale**: já embutido no Ink, sem escrever sequências de escape no Maestro; separa colagem de digitação rápida com fidelidade (é o terminal que delimita).

**Alternatives considered**: heurística por tamanho do chunk (frágil com digitação rápida e com terminais que fatiam); parser próprio de `\x1b[200~` (o Ink já faz).

## R2. Marcadores como caracteres de uso privado

**Decision**: um marcador (chip) é representado no texto do editor por **um único code point da área de uso privado** (U+E000 + índice do chip na sessão). O editor continua um `string[]`; `layoutInput`/renderização consultam um registro de chips (`ChipRegistry`) para a largura e o rótulo. Backspace/Delete/← → já tratam um code point como unidade (FR-002). Ao enviar, `expandChips(text, registry)` substitui cada PUA pelo conteúdo delimitado; `labelChips(text, registry)` substitui pelos rótulos (`display`, histórico).

**Rationale**: zero mudanças no modelo do editor (cursor, quebra, histórico de rascunho); as PUA nunca vêm do teclado; o histórico entre sessões recebe só os rótulos.

**Alternatives considered**: modelo de segmentos `text | chip` (reescreve o editor inteiro); marcadores como texto literal `[Pasted text #1 …]` editável (o usuário poderia corromper o marcador).

## R3. Conteúdo entregue ao modelo

**Decision**: o texto enviado substitui cada marcador por um bloco delimitado:

```
<pasted-text id="1" lines="42">
…conteúdo…
</pasted-text>
```

```
<file path="src/a.ts" lines="230">
…conteúdo…
</file>
```

Imagens viram uma parte `{ type: 'image', mediaType, data (base64), name }` na mensagem e um marcador `[Imagem: nome, tamanho]` no texto. Mensagem só com marcadores ganha o prefixo `The user attached the following content:`.

**Rationale**: delimitadores explícitos evitam que o modelo confunda o conteúdo com instruções; o formato é neutro a provedor.

## R4. Arquivos colados

**Decision**: `attachments.ts` (puro + fs): `splitPastedPaths(text)` tokeniza por quebras de linha, espaços e aspas (aceita `file://`, aspas simples/duplas, `~`); `classifyPath(abs, cwd, limits)` → `text | image | binary | too-large | outside | missing`. Só colagens em que **todos** os tokens são caminhos existentes, ou tokens individuais que existem, viram chips; o resto permanece texto. Binário = NUL nos primeiros 8 KB (regra do `read_file`). Conteúdo lido no envio (FR-009); linhas contadas na colagem e recontadas no envio.

**Rationale**: é o que os terminais produzem ao arrastar arquivos (caminho, com aspas quando há espaços); ler no envio evita conteúdo desatualizado.

## R5. Seleção com o mouse

**Decision**: estender o rastreamento já ativo (SGR 1002 = botão + arrasto, 1006 = coordenadas): `useMouseSelection` reconhece botão 0 pressionado (`M`), movimento com botão (código 32) e soltar (`m`). Coordenadas da tela → linha de conteúdo: `contentLine = y − transcriptTop − 1 + viewportOffset` (transcriptTop vem de `useBoxMetrics` no Box de coluna do `Transcript`, cujo pai é a raiz); colunas contam a partir de `left`. A seleção guarda âncora e extremidade em coordenadas de **conteúdo** (sobrevive à rolagem); o destaque é desenhado por um overlay de linhas invertidas sobre as linhas visíveis (o `Transcript` recebe `selection` e aplica `inverse` por linha/colunas). Clique duplo/triplo por tempo (≤ 400 ms) na mesma célula → palavra/linha. Shift+arrasto passa pelo terminal (seleção nativa), documentado.

**Texto selecionado**: um `FrameRecorder` envolve o `stdout` passado ao Ink (`write` repassa ao stdout real e guarda o último frame; expõe `columns`, `rows`, `isTTY` e `on('resize')`). As linhas do frame (sem ANSI) dentro do retângulo da transcrição são indexadas por linha de conteúdo (`row − transcriptTop + offset`) num cache `Map<number, string>` atualizado a cada frame; a extração usa o cache no intervalo selecionado (linhas nunca exibidas ficam vazias). Blocos de código já são renderizados literalmente, então o texto copiado é o visível (FR-015).

**Rationale**: reaproveita o canal de mouse existente; capturar o frame é o único jeito fiel de obter "o que está na tela" sem duplicar a renderização markdown; cache por linha de conteúdo dá a ancoragem ao conteúdo pedida pela spec.

**Alternatives considered**: renderização offscreen da transcrição para texto (dobra o custo e diverge do que aparece); seleção por coordenadas de tela apenas (perde a seleção ao rolar).

## R6. Área de transferência

**Decision**: `src/utils/clipboard.ts` com `copyToClipboard(text, stdout)`: tenta, em ordem, `clip.exe` (Windows; `powershell -NoProfile -Command Set-Clipboard` como segunda opção), `pbcopy` (macOS), `wl-copy`, `xclip -selection clipboard`, `xsel --clipboard --input` (Linux), todos por `execFile` com o texto em stdin e timeout de 2 s; se nenhum existir, escreve OSC 52 (`\x1b]52;c;<base64>\x07`) no stdout e devolve `{ ok: true, method: 'osc52' }` (o terminal pode ignorar; o aviso diz "copiado via terminal"). Falha total → `{ ok: false }` e orientação para `/mouse off`.

**Rationale**: sem dependência nativa; OSC 52 cobre SSH e terminais modernos. É a segunda exceção documentada à regra "a UI não escreve sequências de escape" (a primeira é o rastreamento do mouse).

## R7. Alternância do mouse

**Decision**: estado vivo `controller.mouseEnabled` (inicial = `ui.mouse`), comando `/mouse [on|off]` (sem argumento alterna) e tecla **Ctrl+M**? Não: Ctrl+M é Enter em terminais. Fica só o comando `/mouse` (a spec exigia o comando; a tecla era opcional). `useMouseWheel`/`useMouseSelection` recebem `enabled` do controller; a barra de status mostra `mouse off` quando desligado; o teste de E/S de terminal garante zero sequências com mouse desligado.

## R8. Expansão do marcador

**Decision**: **Ctrl+O** com o cursor sobre ou logo após um marcador alterna um painel abaixo do prompt com as primeiras 20 linhas do conteúdo (ou tamanho/tipo para imagem); fecha ao digitar, mover para fora do marcador ou Ctrl+O de novo. Ctrl+O está livre no prompt e não colide com o `readline`.

## R9. Imagens e provedores

**Decision**: `ModelProvider` ganha `capabilities?: { images?: boolean }`; Claude declara `images: true` e converte `image` em bloco `{ type: 'image', source: { type: 'base64', media_type, data } }`; Qwen não declara (as partes de imagem são descartadas com aviso se chegarem). O anexo de imagem só é aceito quando o provedor **ativo** declara suporte; trocar de provedor depois com um chip de imagem no prompt gera o aviso no envio.

## R10. Configuração

**Decision**: `ui.pasteCollapseLines` (int ≥ 1, padrão 3), `ui.attachMaxBytes` (padrão 524288), `ui.attachMaxTotalBytes` (padrão 2097152), `ui.imageMaxBytes` (padrão 5242880) no `uiSettingsSchema` (`strictObject`); `INITIAL_SETTINGS.ui` ganha comentário.

## R11. Histórico e sessão

**Decision**: `history.jsonl` e `historyItems` guardam o texto com rótulos; o `ChipRegistry` da sessão guarda os chips por número; ao recuperar uma entrada pelo ↑/↓, `relinkChips(label text, registry)` troca rótulos conhecidos de volta pelos PUA (FR-006); rótulos desconhecidos (outra sessão) ficam como texto. O `submit` recebe `{ text, display, parts }` do prompt; `pushUser(text, display)` já existe; partes de imagem entram em `content`.

## R12. Testes

- **Unit**: `tests/unit/ui/chips.test.ts` (registro, PUA, rótulos, expansão, relink, limites), `tests/unit/ui/attachments.test.ts` (tokenização de caminhos, classificação, binário, limites, `file://`), `tests/unit/ui/selection.test.ts` (reducer de seleção: press/drag/release, duplo/triplo clique, normalização âncora/extremidade, extração do cache), `tests/unit/utils/clipboard.test.ts` (ordem de tentativas com `execFile` injetado; OSC 52 no stdout falso), `tests/unit/ui/InputPrompt.paste.test.tsx` (colagem ≤ 3 linhas literal; > 3 vira chip; Backspace remove; ← → pulam; Ctrl+O expande; `display` e texto expandido no `onSubmit`).
- **Contract**: `tests/contract/terminal-io.test.ts` (+ mouse off → zero sequências; FrameRecorder repassa tudo ao stdout real), `tests/contract/conversion.test.ts` (+ parte `image` no Claude; descartada no Qwen), `tests/contract/config-schema.test.ts` (+ limites).
- **Integration (UI)**: `tests/integration/ui/paste.test.tsx` (colagem grande → chip → envio com conteúdo completo e `display` com rótulo; arquivo texto → chip; binário → aviso; `-p` intacto), `tests/integration/ui/mouseSelection.test.tsx` (sequências SGR de press/drag/release → destaque → cópia via `copy` injetado; rolagem durante a seleção; `/mouse off` → sem interceptação), `tests/unit/security/noSecrets.test.ts` (+ conteúdo colado não vai para `history.jsonl`).
