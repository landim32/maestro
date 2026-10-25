# Quickstart — Colar Arquivos, Copiar Seleção e Colagens Grandes

**Branch**: `007-paste-copy-console` · **Date**: 2026-10-25

## Preparação

```bash
npm install
npm run build && node dist/index.js      # ou: npm run dev
```

Use um terminal com bracketed paste e mouse (Windows Terminal, iTerm2, GNOME Terminal, WezTerm, kitty). No Git Bash, lembre do `MSYS_NO_PATHCONV=1` para argumentos que começam com `/`.

## Cenários de verificação

1. **US1 – Colagem grande**: copie 42 linhas de um arquivo e cole no prompt: aparece `[Pasted text #1 +42 lines]`, o prompt continua com uma linha. Digite `explique: ` antes (← até o início) e envie. A transcrição mostra o rótulo; com `--debug`, o `turn.start` mostra `chars` compatível com as 42 linhas. Cole de novo: `#2`.
2. **US1 – Edição**: com o marcador no prompt, ← e → pulam-no inteiro; Backspace logo após remove tudo; Ctrl+O mostra as primeiras linhas e Ctrl+O fecha; colar 2 linhas entra como texto normal.
3. **US1 – Histórico**: envie uma mensagem com marcador, aperte ↑: o marcador volta e o reenvio manda o conteúdo; feche o Maestro e confira `history.jsonl`: só o rótulo. Reabra, ↑: o rótulo é texto comum.
4. **US2 – Arquivo**: arraste um `.log` da pasta de trabalho para o terminal (ou cole o caminho): `[Arquivo: x.log, N linhas]`; envie e veja na resposta que o modelo leu o conteúdo. Cole dois caminhos de uma vez: dois marcadores. Cole um `.exe`: aviso de binário e caminho como texto. Cole um caminho fora da pasta: aviso.
5. **US4 – Imagem**: com o Claude ativo, cole o caminho de um PNG: `[Imagem: x.png, 120 KB]`; pergunte "o que há na imagem?". Troque para o Qwen e repita: aviso de provedor sem suporte.
6. **US3 – Copiar**: com o mouse ativo, arraste sobre três linhas de uma resposta: destaque invertido; ao soltar, `copiado (3 linhas)` na barra; cole em outro programa e confira o texto puro. Duplo clique numa palavra; triplo numa linha. Role com a roda durante o arrasto: a seleção acompanha o conteúdo.
7. **US3 – Mouse desligado**: `/mouse off`: barra mostra `mouse desligado`, a roda não rola, e a seleção nativa do terminal volta a funcionar; `/mouse on` restaura. Com `"ui": { "mouse": false }` o Maestro abre já desligado.
8. **Limites**: cole um arquivo de 1 MB com `ui.attachMaxBytes` padrão: aviso de limite; aumente em `settings.json` e repita: anexa. Anexe o suficiente para passar de 2 MB e envie: o Maestro avisa e não envia.
9. **`-p`**: `echo "linha1`\nlinha2`\nlinha3`\nlinha4" | node dist/index.js -p -` envia tudo literal, sem marcador.

## Testes automatizados

```bash
npm test                 # inclui tests/unit/ui/{chips,attachments,selection}.test.ts, tests/unit/utils/clipboard.test.ts,
                         # tests/unit/ui/InputPrompt.paste.test.tsx, tests/integration/ui/{paste,mouseSelection}.test.tsx
npm run lint && npm run typecheck && npm run format:check
```
