# Contract: Entrada/Saída do Terminal, Flags e Configuração

**Feature**: `002-fullscreen-ui-markdown`

## 1. Sequências escritas no terminal (além do que o Ink já escreve)

| Momento | Sequência | Condição |
|---|---|---|
| Montagem do App | `ESC[?1002h ESC[?1006h` (rastreamento de botões + SGR) | `capabilities.mouse` |
| Desmontagem (inclusive erro/SIGINT) | `ESC[?1002l ESC[?1006l` | idem |
| Tela alternativa | gerida pelo Ink (`alternateScreen: true`) — `ESC[?1049h` na montagem, `ESC[?1049l` na desmontagem | `capabilities.altScreen` |

Nunca escritas quando `stdout.isTTY` é falso.

## 2. Sequências lidas de stdin

- Eventos SGR de mouse: `ESC[<Cb;Cx;CyM` (pressão) e `ESC[<Cb;Cx;Cym` (soltura). Apenas `Cb ∈ {64, 65}` (roda ↑/↓) são usados → `scrollBy(-3)` / `scrollBy(+3)`. Qualquer outro evento de mouse é **descartado** e nunca chega ao prompt como texto.
- Teclas: via `useInput` do Ink (`pageUp`, `pageDown`, `home`, `end`, `shift` + setas).

## 3. Flags de linha de comando (adições a contracts/cli.md da feature 001)

| Opção | Efeito |
|---|---|
| `--no-altscreen` | Desliga a tela alternativa nesta execução (layout continua limitado à altura) |

## 4. Variáveis de ambiente (adições)

| Variável | Efeito |
|---|---|
| `MAESTRO_NO_ALTSCREEN` | Qualquer valor não vazio desliga a tela alternativa |
| `NO_COLOR` | Já existente; agora também controla cores do markdown e do banner |

## 5. `settings.json` (adições em `ui`)

```json
"ui": {
  "color": true,
  "altScreen": true,
  "mouse": true
}
```

Precedência: `--no-altscreen` > `MAESTRO_NO_ALTSCREEN` > `ui.altScreen`. `ui.mouse` só tem efeito com TTY.

## 6. Modo não interativo

Inalterado: resposta em stdout como texto cru (sem markdown renderizado, sem banner, sem sequências de mouse/tela alternativa). Testes existentes de `-p` continuam válidos.

## 7. Testes de contrato

- Com stdout falso `isTTY=true` e `mouse=true`: após montar, as escritas contêm exatamente `\x1b[?1002h\x1b[?1006h`; após desmontar, `\x1b[?1002l\x1b[?1006l`.
- Com `mouse=false` ou `isTTY=false`: nenhuma dessas sequências.
- Injetar `\x1b[<64;10;5M` em stdin → `offset` diminui 3; `\x1b[<65;10;5M` → aumenta 3; `\x1b[<0;10;5M` → nenhum efeito e o prompt permanece vazio.
- `parseArgs(['--no-altscreen']).altScreen === false`; `MAESTRO_NO_ALTSCREEN=1` → capabilities `altScreen=false`; `ui.altScreen=false` idem; `-p` nunca entra em tela alternativa.
