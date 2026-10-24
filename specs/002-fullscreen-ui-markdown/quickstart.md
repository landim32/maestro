# Quickstart: Interface de Tela Cheia, Rolagem Interna, Banner e Markdown

**Feature**: `002-fullscreen-ui-markdown`

## Instalar dependências novas

```bash
npm install unified remark-parse remark-gfm lowlight string-width ink-gradient
npm install -D @types/mdast
npm run build && npm test
```

## Rodar

```powershell
node dist/index.js                 # tela alternativa, banner, markdown
node dist/index.js --no-altscreen  # mesmo layout no buffer principal
$env:NO_COLOR = "1"; node dist/index.js   # sem cores
```

## Validação visual por história

1. **US1 Tela estável**: em um terminal de ~30 linhas, digite 100+ caracteres sem enviar. A barra de rolagem do terminal não deve se mover e o prompt não deve mudar de lugar. Peça uma resposta longa ("explique em 60 linhas…"): prompt e status ficam fixos. Redimensione a janela: a interface reflui. `/exit`: o conteúdo anterior do console reaparece.
2. **US2 Rolagem**: depois de 3–4 respostas longas, Page Up mostra o histórico e o indicador à direita sobe; End volta ao fim. Role para cima e envie outra pergunta: a visão salta para o fim. Role para cima durante uma resposta: aparece `↓ novo conteúdo (End)`. Gire a roda do mouse (Windows Terminal, iTerm2): rola.
3. **US3 Banner**: em 120 colunas, logo "MAESTRO" em blocos com gradiente no topo da conversa; em 80 colunas, linha compacta `♪ Maestro`; com `NO_COLOR`, sem cores; `maestro -p "oi"` não imprime banner.
4. **US4 Markdown**: peça "Responda com um título, uma lista com subitens, um trecho em negrito, código em linha, um bloco de código TypeScript e uma tabela de 3 colunas". Verifique título destacado, marcadores, negrito, código em linha colorido, bloco com moldura + rótulo `typescript` + palavras‑chave coloridas, tabela alinhada. Compare com o qwen code rodando a mesma pergunta.

## Checagens rápidas

```bash
npm test -- tests/integration/ui            # layout, streaming
npm test -- tests/unit/ui/markdown          # snapshots de cada elemento
node dist/index.js -p "diga olá"            # saída crua, sem escapes de tela/mouse
```
