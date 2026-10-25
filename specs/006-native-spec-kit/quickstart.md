# Quickstart — Spec Kit Nativo no Maestro

**Branch**: `006-native-spec-kit` · **Date**: 2026-10-25

## Preparação

```bash
npm install
npm run build && node dist/index.js      # ou: npm run dev
```

Os cenários 1–6 rodam neste repositório (já inicializado pela CLI `specify` 0.4.5); os cenários 7–9 usam uma pasta nova. Use `MAESTRO_HOME` temporário se não quiser mexer na sua configuração. Nenhum cenário precisa do Claude Code, da CLI `specify`, de Python ou de PowerShell; vale testar com o Qwen ativo.

## Cenários de verificação

1. **US1 – Descoberta**: digite `/spec` e veja as sugestões (`/speckit.specify`, `/speckit.plan`, …) com origem `claude`; → completa; `/help` lista a seção "Spec Kit" com embutido v1.2.3 e a pasta `.claude/commands`.
2. **US1 – specify**: `/speckit.specify Quero um comando /about que mostra a versão`. A transcrição mostra `› /speckit.specify …` (não o prompt inteiro), depois `⚙ speckit create-new-feature · 007-about-command`, a branch `007-…` ativa no git, `specs/007-…/spec.md` preenchido e `.specify/feature.json` apontando para a pasta. Nenhum processo `pwsh`/`bash` foi iniciado (confira no `--debug`: `speckit.step` em vez de `⚙ run_command`).
3. **US1 – plan/tasks**: `/speckit.plan` cria `plan.md` e os artefatos; `⚙ speckit update-agent-context` atualiza `CLAUDE.md` e cria `MAESTRO.md`; `/speckit.tasks` cria `tasks.md`; `/speckit.status` mostra tudo ✓.
4. **US1 – Pré-requisitos**: `git checkout main` e rode `/speckit.tasks`: aviso imediato "ERROR: … Run /speckit.specify first" sem gastar tokens; volte à branch.
5. **US2 – Perguntas**: `/speckit.clarify` na spec do cenário 2: cada pergunta aparece como diálogo `ask_user` com as opções A/B/C e "Outro…"; as respostas vão para a seção de clarificações da spec; Esc encerra a rodada e a spec mantém o que já foi gravado.
6. **US1 – Modo `-p`**: `node dist/index.js -p "/speckit.status"` imprime o status; `node dist/index.js -p "/speckit.checklist ux"` gera um checklist em `specs/007-…/checklists/`.
7. **US3 – init em pasta nova**: `mkdir %TEMP%\sk && cd %TEMP%\sk && git init`, abra o Maestro, `/speckit.init`: estrutura criada, relatório listado, próximo passo sugerido. `/speckit.init` de novo: nada alterado. Edite `.specify/templates/spec-template.md`, rode `/speckit.init --upgrade`: o template editado é listado como mantido.
8. **US3 – Fluxo completo nativo**: na pasta do cenário 7, `/speckit.constitution` → `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement` com o Qwen. Os comandos vêm de `.maestro/commands/` (origem `projeto`).
9. **US3 – Sem git**: em pasta sem `git init`, `/speckit.init` avisa sobre branches; `/speckit.specify` cria `specs/001-…` e `feature.json` sem branch; `/speckit.plan` encontra a feature.
10. **US4 – Contexto**: crie `MAESTRO.md` com "Responda sempre começando com OK:" e abra o Maestro: as respostas começam com OK; `--debug` registra `context.loaded`. Apague-o: `CLAUDE.md` é usado com o aviso correspondente.
11. **Créditos**: `THIRD_PARTY_NOTICES.md` tem a seção spec-kit (MIT) com as modificações listadas; `assets/speckit/NOTICE` existe; `npm pack --dry-run` inclui `assets/`.

## Testes automatizados

```bash
npm test                 # inclui tests/unit/speckit/*, tests/contract/speckit.test.ts,
                         # tests/integration/speckit/flow.test.ts, tests/integration/ui/speckit.test.tsx
npm run lint && npm run typecheck && npm run format:check
```
