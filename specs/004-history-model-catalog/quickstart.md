# Quickstart — Histórico de Entradas e Catálogo de Modelos

**Branch**: `004-history-model-catalog` · **Date**: 2026-10-25

## Preparação

```bash
npm install
npm run build && node dist/index.js      # ou: npm run dev
```

Use um `MAESTRO_HOME` temporário para não mexer na sua configuração real (`$env:MAESTRO_HOME = "$env:TEMP\maestro-004"` no PowerShell).

## Cenários de verificação

1. **US1 – Histórico persistente**: envie `olá`, depois `/model`, feche o seletor com Esc, envie `segunda mensagem`. Aperte ↑ três vezes: deve aparecer `segunda mensagem`, `/model`, `olá`, nessa ordem; ↓ até voltar ao prompt vazio. Digite `rasc` (sem enviar), ↑ e depois ↓: `rasc` volta intacto. Saia com `/exit`, abra de novo e aperte ↑: as mesmas entradas aparecem. Confira `%MAESTRO_HOME%\.maestro\history.jsonl` (uma linha JSON por entrada). Shift+↑ rola a transcrição; ↑ simples não.
2. **US1 – Nada de diálogo no histórico**: rode `/auth`, escolha Qwen e digite uma chave falsa até o teste falhar; volte ao menu e feche. `history.jsonl` deve conter `/auth`, mas nenhum caractere da chave.
3. **US2 – Catálogo**: abra `settings.json` gerado e veja `providers.claude.models` e `providers.qwen.models`. Em `/model`, os modelos aparecem agrupados por provedor com o ativo marcado; os de provedores não configurados ficam desativados. Escolha `claude-sonnet-5-5`: o cabeçalho muda e `settings.json` grava `providers.claude.model`. Acrescente `"claude-x"` à lista no arquivo, reinicie e veja‑o no seletor.
4. **US3 – Digitar outro modelo**: em `/model`, escolha "Digitar outro modelo…", escolha o provedor (um não configurado deve estar desativado), digite `qwen3-max-preview`, Enter. A próxima mensagem vai para esse modelo; `providers.qwen.models` passa a conter o nome; reabrir `/model` o mostra na lista do Qwen. Repetir o nome não duplica. `/model qwen qwen3-coder-flash` por texto também acrescenta se faltar.
5. **Robustez**: corrompa uma linha de `history.jsonl` (texto solto) e reabra: o restante do histórico funciona e `--debug` registra `history.error`. Torne o arquivo somente‑leitura: o Maestro inicia e funciona; só não grava novas entradas.
6. **`-p`**: `node dist/index.js -p "/model"` lista a tabela e a seção `Models:`; nenhum `history.jsonl` é criado.

## Testes automatizados

```bash
npm test                 # inclui tests/unit/session/history.test.ts, tests/unit/config/models.test.ts,
                         # tests/integration/ui/history.test.tsx, dialogs.model.test.tsx estendido
npm run lint && npm run typecheck
```
