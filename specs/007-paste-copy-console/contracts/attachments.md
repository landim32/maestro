# Contract — Arquivos e imagens colados

**Feature**: `007-paste-copy-console` · **Date**: 2026-10-25

## 1. Reconhecimento de caminhos na colagem

Tokens: separados por quebra de linha, por espaço fora de aspas, ou envoltos em aspas simples/duplas. Formas aceitas por token: absoluto (`C:\x\y.ts`, `/home/u/y.ts`), relativo à pasta de trabalho (`src/y.ts`, `./y.ts`), `~/y.ts`, `file:///…` (decodificado). Um token é caminho quando resolve para um **arquivo** existente; pastas e tokens inexistentes ficam como texto.

## 2. Classificação

| Caso | Marcador | Aviso |
|---|---|---|
| texto (sem NUL nos primeiros 8 KB), ≤ `ui.attachMaxBytes` | `[Arquivo: nome.ext, N linhas]` | — |
| imagem (`.png .jpg .jpeg .gif .webp`), ≤ `ui.imageMaxBytes`, provedor ativo com `capabilities.images` | `[Imagem: nome.png, 120 KB]` | — |
| imagem com provedor sem suporte | — (caminho fica texto) | `O provedor <id> não aceita imagens; o caminho entrou como texto.` |
| imagem > limite | — | `Imagem nome.png (6.1 MB) acima do limite (5 MB).` |
| binário | — | `nome.bin parece binário; o caminho entrou como texto.` |
| > `ui.attachMaxBytes` | — | `nome.log (700 KB) acima do limite (512 KB); use read_file ou aumente ui.attachMaxBytes.` |
| fora da pasta de trabalho | — | `nome.ext está fora da pasta de trabalho; o caminho entrou como texto.` |

Avisos aparecem na transcrição como `warn` e não bloqueiam o prompt.

## 3. Envio

- Arquivo texto → no `text` do modelo:

```
<file path="src/relatorio.log" lines="230">
…conteúdo lido no momento do envio…
</file>
```

  `path` é o caminho relativo à pasta de trabalho com `/`. Se o arquivo sumiu entre colar e enviar: aviso e o bloco traz `<file path="…" missing="true"/>`.
- Imagem → parte `{ type: 'image', mediaType, data: <base64>, name }` na mensagem do usuário e, no `text`, `[Imagem: nome.png]` no lugar do marcador. Claude recebe um bloco `image` (base64) antes do texto; um provedor sem suporte descarta a parte com aviso.
- `display` mantém os rótulos; `history.jsonl` idem.

## 4. Limites e configuração

```json
"ui": {
  "pasteCollapseLines": 3,
  "attachMaxBytes": 524288,
  "attachMaxTotalBytes": 2097152,
  "imageMaxBytes": 5242880
}
```

Validação: inteiros; mínimos 1 (linhas) e 1024 (bytes); chaves desconhecidas rejeitadas.

## 5. Testes que fixam este contrato

- `tests/unit/ui/attachments.test.ts` — § 1–2 (tokenização, `file://`, `~`, aspas, binário, limites, fora da pasta, imagem × provedor).
- `tests/contract/conversion.test.ts` — § 3 (bloco `image` no Claude; descarte no Qwen com aviso).
- `tests/contract/config-schema.test.ts` — § 4.
- `tests/integration/ui/paste.test.tsx` — § 2–3 fim a fim com arquivos temporários.
