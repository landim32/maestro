# Contract — Colagens grandes e marcadores no prompt

**Feature**: `007-paste-copy-console` · **Date**: 2026-10-25

## 1. Quando uma colagem vira marcador

| Colagem | Resultado no prompt |
|---|---|
| ≤ `ui.pasteCollapseLines` linhas (padrão 3) e sem caminhos de arquivo | texto literal inserido no cursor (`\r\n` → `\n`) |
| > `ui.pasteCollapseLines` linhas | `[Pasted text #N +L lines]` no cursor; N = sequência de colagens na sessão (1, 2, …); L = número de linhas |
| só caminhos de arquivos existentes | um marcador por arquivo (contracts/attachments.md) |
| mistura de caminhos existentes e texto | caminhos viram marcadores; o resto fica texto |
| em campo de diálogo (`/auth`, `ask_user` "Outro…") | literal, sem marcador |
| modo `-p` / stdin | literal, sem marcador |

Uma linha é contada por `\n` (ou `\r\n`); texto sem quebra final conta a última linha.

## 2. Edição

- O marcador ocupa a largura do rótulo e é desenhado em destaque (`cyan`; invertido quando o cursor está sobre ele).
- ← e → pulam o marcador inteiro; Backspace logo após e Delete logo antes removem o marcador inteiro; Ctrl+W/Ctrl+U/Ctrl+K o tratam como um caractere.
- **Ctrl+O** com o cursor sobre ou logo após um marcador abre um painel abaixo do prompt com as 20 primeiras linhas do conteúdo (ou `tipo · tamanho` para imagens) e `… +K linhas`; Ctrl+O de novo, digitar ou mover o cursor para fora fecham o painel. O painel nunca entra no texto.
- Texto digitado em volta é livre: `explique este erro: [Pasted text #1 +42 lines] por favor`.

## 3. Envio

- `display` (transcrição, `history.jsonl`, histórico ↑/↓): o texto com os rótulos.
- `text` (modelo): cada marcador substituído por:

```
<pasted-text id="1" lines="42">
…conteúdo exatamente como colado…
</pasted-text>
```

- Mensagem composta só de marcadores: `text` começa com `The user attached the following content:` seguido dos blocos.
- Comandos `/`: o marcador conta como argumento; `rest` do comando recebe o texto expandido (ex.: `/speckit.specify [Pasted text #1 +10 lines]` envia a descrição completa).

## 4. Histórico

- `history.jsonl` guarda `display` (rótulos), nunca o conteúdo (teste `noSecrets` estendido).
- ↑/↓ dentro da mesma sessão: rótulos de marcadores conhecidos voltam a ser marcadores e reenviam o conteúdo; rótulos de outra sessão ficam como texto comum.

## 5. Limites

- Total de conteúdo expandido por mensagem > `ui.attachMaxTotalBytes` (padrão 2 MB): aviso `Conteúdo anexado (X MB) acima do limite (2 MB); remova um marcador ou aumente ui.attachMaxTotalBytes` e a mensagem **não** é enviada.

## 6. Testes que fixam este contrato

- `tests/unit/ui/chips.test.ts` — § 1 contagem de linhas, rótulos, `labelChips`/`relinkChips`/`expandChips`.
- `tests/unit/ui/InputPrompt.paste.test.tsx` — § 1–3 (colagem literal × marcador; edição; Ctrl+O; `onSubmit` com `display`/`text`).
- `tests/integration/ui/paste.test.tsx` — § 3–5 (provedor recebe o bloco; transcrição mostra o rótulo; limite total).
- `tests/unit/security/noSecrets.test.ts` — § 4.
