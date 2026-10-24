# Contract: Layout da Interface Interativa

**Feature**: `002-fullscreen-ui-markdown`

## 1. Regiões (de cima para baixo)

```text
┌ Header (1 linha) ─────────────────────────────────────────────┐  provedor/modelo · cwd · versão
│ Transcript (flexGrow, overflow hidden)                       ▲│  banner → mensagens → notices
│   …                                                          █│  indicador à direita quando rola
│   ↓ novo conteúdo                                            ▼│  aviso quando follow=false e chegou texto
├ ConfirmationDialog (0..rows/2 linhas, só quando pendente) ────┤
├ InputPrompt (1..10 linhas) ───────────────────────────────────┤  › texto…
└ StatusBar (1 linha) ──────────────────────────────────────────┘  estado · tokens · atalhos
```

Garantias:
- A altura total do frame é **exatamente** `rows`; largura `columns`.
- Nenhum redesenho escreve fora da janela; o scrollback do terminal não cresce (SC‑001).
- Em `altScreen`, ao sair o conteúdo anterior do console é restaurado (SC‑002).

## 2. Modos por tamanho

| Condição | Modo | Efeitos |
|---|---|---|
| `rows ≥ 20 && columns ≥ 100` | normal | banner grande, status com dicas completas |
| menor, mas `rows ≥ 12 && columns ≥ 40` | compacto | banner de 1 linha, dicas curtas |
| `rows < 12 \|\| columns < 40` | mínimo | sem banner; StatusBar mostra `terminal too small (min 40x12)`; tudo continua funcionando |

## 3. Teclas

| Tecla | Estado | Efeito |
|---|---|---|
| Page Up / Page Down | qualquer | rola 1 tela (−/+ `viewportHeight-1`) |
| Shift+↑ / Shift+↓ | qualquer | rola 1 linha |
| Home / End | qualquer | topo / fim (End religa `follow`) |
| Roda do mouse ↑/↓ | qualquer, se `mouse` | rola 3 linhas |
| ↑ / ↓ (sem modificador) | idle | histórico do prompt (inalterado) |
| Enter | idle | envia; viewport vai ao fim |
| Esc / Ctrl+C / y / n / Ctrl+C×2 | — | inalterados (feature 001) |

Teclas de rolagem nunca inserem caracteres no prompt.

## 4. Indicador de rolagem

- Visível apenas quando `contentHeight > viewportHeight`.
- Trilho `│` (cinza) com polegar `█` (ciano), tamanho e posição conforme data-model § 3.
- Ocupa 1 coluna à direita do transcript; o conteúdo usa `columns - 1`.

## 5. Aviso de conteúdo novo

- Quando `follow = false` e chega conteúdo: última linha do transcript mostra `↓ novo conteúdo (End)` em amarelo, sobrepondo o conteúdo.
- Desaparece ao voltar ao fim.

## 6. Banner

- Primeiro item do transcript; rola com o histórico; nunca duplicado; removido por `/clear`? **Não**: `/clear` limpa mensagens e mantém o banner.
- Variantes em data-model § 6. Texto obrigatório: "MAESTRO" (grande) ou "Maestro" (compacto).

## 7. Prompt multilinha

- Texto colado ou longo quebra em até 10 linhas; acima disso o prompt rola internamente mantendo o cursor visível.
- O transcript encolhe na mesma medida (regiões somam `rows`).

## 8. Degradação

- Sem TTY: inalterado (recusa com orientação para `-p`, código 2).
- `altScreen` desligado (`--no-altscreen`, `ui.altScreen=false`, `MAESTRO_NO_ALTSCREEN=1`): mesmo layout de altura limitada no buffer principal; aviso único em StatusBar por 5 s: `alt screen off`.
- Terminal sem eventos de mouse: nada acontece; sem erro.

## 9. Testes derivados

- Frame height ≤ rows em 24×80, 40×120, 10×30 (modo mínimo) após: inicial, 200 teclas, resposta de 300 linhas, resize.
- Após digitar 50 caracteres, `lastFrame()` tem o mesmo número de linhas que antes.
- PageUp altera o conteúdo visível e o indicador aparece; End volta ao fim; mensagem nova com `follow=false` mostra o aviso.
- Banner grande em 120 colunas, compacto em 80, ausente em 30×10.
