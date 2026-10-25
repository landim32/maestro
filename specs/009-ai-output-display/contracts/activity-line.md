# Contract: Linha de atividade (US1, FR-001–FR-008)

## 1. Quando aparece

- Do envio de uma mensagem ou de um comando de prompt (`/speckit.*`, `/ask`, atalhos de rota) até o fim do turno.
- Em `idle` não aparece, e o cursor `▍` deixa de existir.
- Comandos locais (`/help`, `/clear`…) não abrem turno e não mostram a linha.
- No `-p` nada é desenhado.

## 2. Formato

```text
<símbolo> <frase>… (<tempo> · ↓ <tokens> tokens · Esc para interromper)
```

- **Símbolo**: alterna `· ✢ ✳ ✶ ✻ ✽ ✻ ✶ ✳ ✢` a cada 200 ms, na cor de destaque. Sem cor, ou com `NO_COLOR`, fica `✻` fixo.
- **Frase**: depende da fase.

  | Fase | Frase |
  | --- | --- |
  | `waiting` / `responding` | o verbo sorteado, por exemplo `Contemplando…` |
  | `tool` | `Executando <Rótulo>…`, por exemplo `Executando Bash…` |
  | `confirm` | `Aguardando sua confirmação…` |
  | `question` | `Aguardando sua resposta…` |
- **Tempo**: `0s`…`59s`, depois `1m 05s`, `12m 00s`. Avança pelo menos a cada segundo, inclusive nas fases `confirm` e `question`.
- **Tokens**: `↓ 304 tokens`, ou `↓ ~304 tokens` enquanto for só estimativa. O trecho é omitido quando o valor é 0.
- **Dica**: `Esc para interromper`.

## 3. Encurtamento por largura

Os trechos saem nesta ordem até a linha caber:

1. a dica;
2. os tokens.

O tempo e a frase nunca saem. Abaixo de 20 colunas, sobra só `✻ <tempo>`.

## 4. Fim do turno

- A linha some.
- Na sessão interativa, um aviso `info` é emitido na posição atual: `✻ 13s · ↓ 304 tokens`.
- Se o turno foi cancelado: `✻ interrompido · 4s · ↓ 20 tokens`.
- O total exibido é o mesmo de `TurnResult.usage.outputTokens` quando o provedor o informa (SC-003).
- A barra de status continua com o acumulado da sessão.

## 5. Log

`turn.end` ganha `outTokensShown` e `approximate`. Nenhum texto é registrado.
