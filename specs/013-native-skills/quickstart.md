# Quickstart: Suporte nativo a skills

Roteiro manual para validar a feature (constituição: o quickstart é executado antes do merge). Use `npm run build` e depois `node dist/index.js` num projeto de teste.

## Preparação

```powershell
mkdir C:\tmp\skills-demo; cd C:\tmp\skills-demo; git init -q
mkdir .claude\skills\revisao-pr\references, .agents\skills\padroes-api, .claude\skills\rascunho, .claude\skills\speckit-plan
```

`.claude/skills/revisao-pr/SKILL.md`:

```markdown
---
name: revisao-pr
description: "Checklist de revisão de PR da equipe. Use ao revisar código ou abrir um PR."
---

# Revisão de PR

1. Leia `references/checklist.md` desta skill.
2. Responda com a palavra-código ABACAXI no início, para provar que a skill foi carregada.
```

`.claude/skills/revisao-pr/references/checklist.md`: `- testes passam\n- sem segredos no diff`

`.agents/skills/padroes-api/SKILL.md`: um cabeçalho com `description: >` dobrado em duas linhas.

`.claude/skills/rascunho/SKILL.md`: um cabeçalho só com `name: rascunho`, sem description.

`.claude/skills/speckit-plan/SKILL.md`: um cabeçalho válido.

`~/.claude/skills/revisao-pr/SKILL.md`: outra versão, que deve ser sombreada.

## 1. Lista e diagnóstico (US3)

1. Rode `node <maestro>/dist/index.js -p "/skills"`. Devem aparecer:
   - em "Skills disponíveis": `revisao-pr` (projeto `.claude`) e `padroes-api` (projeto `.agents`), além das skills reais de `~/.claude/skills/*` do usuário, se houver;
   - em "Sombreadas": `revisao-pr` do usuário;
   - em "Ignoradas": `rascunho` (sem description) e `speckit-plan` (Spec Kit).
2. Rode `--debug -p "oi"` e confira em `~/.maestro/debug.log` o evento `skills.discover`, só com contagens.

## 2. Carga pelo modelo (US1)

1. Abra a sessão interativa e peça: "revise o PR atual". A transcrição deve mostrar `⏺ Skill(revisao-pr)` com `⎿ N linhas · 1 arquivo de referência`, depois `⏺ Skill(revisao-pr/references/checklist.md)`, e a resposta deve começar com ABACAXI.
2. Repita com cada provedor configurado: `claude`, `qwen`, `claude-code` e `codex`. Use `/model` ou uma rota.
3. Peça: "use load_skill para ler o arquivo ../padroes-api/SKILL.md da skill revisao-pr". A chamada deve aparecer com erro `file outside the skill folder`.
4. Peça uma skill inexistente. O erro deve listar os nomes disponíveis, e o turno continua.

## 3. Autopiloto (US2)

1. Crie um arquivo de histórias com uma história pequena e rode `/autopilot historias.md`.
2. No fim, rode `grep skill.load .maestro/autopilot/<id>.jsonl`. Cada linha deve ter `story`, `feature`, `step`, `skill`, `source` e `ok`, sem nenhum trecho do conteúdo da skill.

## 4. Sem configuração e desligado

1. Num projeto sem skills, e com `~/.claude/skills` vazio ou com apenas `synced/`, a sessão não oferece `load_skill`, e o prompt não tem `# Skills`. Confirme com o teste de snapshot e no `--debug` (`skills: 0`).
2. Com `"skills": { "enabled": false }` no `./.maestro/settings.json`, `/skills` deve mostrar "Skills desligadas", e o modelo não deve conhecer `revisao-pr`.
3. Com `--no-tools`, `/skills` deve mostrar "Skills indisponíveis sem ferramentas".
