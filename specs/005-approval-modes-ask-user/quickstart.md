# Quickstart — Modos de Aprovação (TAB), `ask_user` e Créditos

**Branch**: `005-approval-modes-ask-user` · **Date**: 2026-10-25

## Preparação

```bash
npm install
npm run build && node dist/index.js      # ou: npm run dev
```

Use um `MAESTRO_HOME` temporário e uma pasta de trabalho descartável (`mkdir %TEMP%\maestro-005 && cd %TEMP%\maestro-005`): os cenários abaixo escrevem arquivos e rodam comandos.

## Cenários de verificação

1. **US1 – Ciclo com TAB**: a barra de status mostra `ready · Pedir permissão`. Aperte TAB quatro vezes: `Aceitar edições` → `Automático` (amarelo) → `YOLO` (vermelho) → `Pedir permissão`; cada troca mostra `modo: …` por alguns segundos. Shift+TAB volta um passo. Digite `abc`, TAB: o texto continua `abc`.
2. **US1 – Aceitar edições**: em `auto-edit`, peça "crie um arquivo hello.txt com a palavra olá". Nenhum diálogo aparece; a transcrição mostra `⚙ write_file hello.txt · new file: hello.txt (1 lines) · auto (Aceitar edições)`. Peça "rode `dir`" (ou `ls`): o diálogo `y`/`n` aparece.
3. **US1 – Automático**: TAB para `Automático`; peça "rode `dir`": executa sem perguntar. Peça "apague a pasta tmp com rm -rf tmp": o diálogo aparece com `Confirmação exigida: remoção recursiva`.
4. **US1 – YOLO**: TAB para `YOLO`; peça o mesmo comando destrutivo em uma pasta descartável: executa sem perguntar; a barra fica vermelha.
5. **US1 – Pendente sobrevive ao TAB**: volte a `Pedir permissão`, peça uma escrita; com o diálogo `y`/`n` aberto aperte TAB: o modo muda na barra, o diálogo continua; responda `n` → `user declined`.
6. **US1 – Modo inicial**: `node dist/index.js --approval-mode auto` abre em `Automático`; `--yolo` em `YOLO`; `--approval-mode foo` sai com código 2 e lista os aceitos. Coloque `"tools": { "approvalMode": "auto-edit" }` no `settings.json` e abra sem argumentos: `Aceitar edições`. Troque com TAB, saia e reabra: volta `Aceitar edições` (nada foi gravado).
7. **US1 – Diálogos**: abra `/model` e aperte TAB: o modo não muda. `/approval-mode` lista os modos; `/approval-mode yolo` troca; `/help` mostra TAB e `/approval-mode`.
8. **US2 – `ask_user`**: peça "antes de implementar, me pergunte com a ferramenta ask_user qual banco prefiro: Postgres, SQLite ou outro". O diálogo `Pergunta 1 de 1 · [Banco]` aparece; ↑/↓ e `2` selecionam; Enter envia; a transcrição mostra `› [Banco] SQLite` e o modelo continua usando a resposta.
9. **US2 – Múltipla escolha e Outro**: peça uma pergunta com `multiSelect` e duas perguntas na mesma chamada. Espaço marca; Enter sem marcar mostra o aviso; na segunda pergunta escolha "Outro…", Enter vazio mostra o aviso, digite um texto e Enter. O modelo recebe `**<header>**: a, b` e `**<header>**: <texto>`.
10. **US2 – Cancelar e YOLO**: repita em `YOLO`: a pergunta aparece do mesmo jeito. Aperte Esc: o modelo recebe `User declined to answer the questions.` e termina o turno normalmente. Confira que `history.jsonl` não tem o texto digitado em "Outro…" e que `--debug` registra apenas `ask_user.answered`/`ask_user.declined`.
11. **US2 – `-p`**: `node dist/index.js -p "pergunte-me algo com ask_user"`: stderr mostra a chamada e o modelo recebe "no interactive user is available". `node dist/index.js -p "crie x.txt com 1" --approval-mode auto` cria o arquivo; sem o argumento, recusa com `confirmation required`.
12. **US3 – Créditos**: `THIRD_PARTY_NOTICES.md` lista qwen-code e gemini-cli e traz a Apache License 2.0; cada arquivo da tabela começa com o cabeçalho `@license … qwen-code … Apache-2.0`; `LICENSE` aponta para o aviso; `package.json` tem `"license": "MIT"` e `files` com os dois arquivos; `npm pack --dry-run` lista `LICENSE` e `THIRD_PARTY_NOTICES.md`; README tem "Licença" e "Créditos"; `.specify/memory/constitution.md` tem os princípios VI e VII.

## Testes automatizados

```bash
npm test                 # inclui tests/unit/tools/approval.test.ts, askUser.test.ts,
                         # tests/unit/setup/askUserFlow.test.ts, tests/unit/license/attribution.test.ts,
                         # tests/integration/ui/approvalMode.test.tsx, dialogs.askUser.test.tsx
npm run lint && npm run typecheck && npm run format:check
```
