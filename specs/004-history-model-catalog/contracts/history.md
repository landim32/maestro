# Contract — Histórico de entradas (`~/.maestro/history.jsonl`)

**Branch**: `004-history-model-catalog` · **Date**: 2026-10-25

## 1. Arquivo

- Caminho: `<globalConfigDir>/history.jsonl` (`~/.maestro/history.jsonl`; respeita `MAESTRO_HOME`). Função `historyPath(env)` em `src/config/paths.ts`.
- Formato: JSON Lines, UTF‑8, `\n` como separador. Cada linha: `{"t":"2026-10-25T12:34:56.789Z","text":"/model qwen qwen3-max"}`.
- Escrita: append de uma linha por envio, criando a pasta se necessário. Nunca reescreve no envio.
- Carga: na abertura da sessão interativa. Linhas inválidas (JSON quebrado, sem `text` string, `text` vazio após trim) são ignoradas; duplicatas consecutivas colapsadas; mantêm‑se as 1.000 últimas.
- Compactação: se o arquivo tiver > 2.000 linhas na carga, é reescrito (arquivo temporário + rename) com as 1.000 últimas válidas.
- Erros de leitura/escrita: engolidos; evento `history.error` no log de diagnóstico (`--debug`) com `{ op: 'load'|'append'|'compact', path, message }`, nunca com o texto da entrada.
- Permissões: o arquivo é criado com as permissões padrão do processo, como `settings.json`.

## 2. O que é registrado

| Origem | Registrado? |
|---|---|
| Texto enviado pelo prompt interativo (Enter) com conteúdo não vazio | Sim, inclusive comandos `/` (antes de executar) |
| Entrada igual à última registrada | Não (sem duplicata consecutiva) |
| Texto digitado em campos de diálogo (`/auth`, `/model`) | **Não** |
| `y`/`n` de confirmação de ferramenta | Não |
| Prompt do modo `-p` (argumento ou stdin) | Não; `-p` não cria nem lê o arquivo |
| Entradas após `/clear` | Sim; `/clear` não afeta o histórico |

## 3. Teclas no prompt (sessão `idle`, sem diálogo)

| Tecla | Efeito |
|---|---|
| ↑ | Entrada anterior (do mais recente). No prompt em edição, guarda o rascunho antes. Na mais antiga, nada. |
| ↓ | Entrada seguinte; após a mais recente, devolve o rascunho (ou vazio). Fora do histórico, nada. |
| Shift+↑ / Shift+↓ | Rolam a transcrição 1 linha (inalterado). ↑/↓ simples **nunca** rolam. |
| PageUp/PageDown/Home/End | Rolam (inalterado). |
| Enter | Envia o texto atual; cursor do histórico volta a "editando". |
| Digitação / Backspace / Ctrl+U | Edita o texto; o cursor sai do histórico (o texto editado é o novo rascunho). |

Durante `generating`/`awaiting_confirmation` ou com diálogo aberto, o prompt está inativo e ↑/↓ não navegam no histórico (comportamento atual).

## 4. Testes derivados

- Store: round‑trip de entrada multilinha; linha corrompida no meio é pulada; > 2.000 linhas → arquivo reescrito com 1.000; pasta ausente é criada; erro de E/S não lança e loga `history.error`.
- Memória: dedupe consecutiva; limite; `push('')` → false.
- Navegador: tabela de transições do data‑model § 1.4.
- UI: ↑ após enviar mensagem e `/model` mostra ambos; rascunho preservado; novo `mountApp` com o mesmo `MAESTRO_HOME` recupera as entradas; `history.jsonl` não contém a chave digitada em `/auth`; `-p` não cria o arquivo.
