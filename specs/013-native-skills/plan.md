# Implementation Plan: Suporte nativo a skills

**Branch**: `013-native-skills` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/013-native-skills/spec.md`

## Summary

Na inicialização, o Maestro descobre skills (`SKILL.md`) em três raízes, nesta ordem de precedência: `.claude/skills/*` e `.agents/skills/*` do projeto e `~/.claude/skills/*`. De cada `SKILL.md` lê só o cabeçalho (`name`, `description`), com um parser mínimo sem dependência nova. O resultado é um catálogo com três listas (válidas, sombreadas, ignoradas).

- **Prompt de sistema**: ganha uma seção `# Skills` com a regra de carregar antes de uma tarefa coberta e a lista curta. Cada descrição é cortada a 250 caracteres, e a lista tem limite de itens e de tamanho.
- **Ferramenta `load_skill(name, file?)`** (`kind: 'read'`): devolve o corpo do `SKILL.md` e a lista dos arquivos da skill, ou um arquivo de referência confinado à pasta da skill por `realpath`. Assim o modelo alcança as skills do usuário sem abrir o `read_file` para fora do cwd.
- **Transcrição**: cada carga aparece como `⏺ Skill(nome)`. Os metadados ficam em `ToolResultDisplay.skill`, que é só de exibição.
- **Autopiloto**: um callback novo em `runOverrides` grava `skill.load` no `.jsonl`, com história, feature, passo, skill, origem, arquivo e sucesso.
- **Diagnóstico e configuração**: `/skills` lista o catálogo, e `skills.enabled` desliga o recurso.

Sem skills, o prompt e as ferramentas ficam idênticos aos de hoje.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.
**Primary Dependencies**: existentes. `node:fs` e `node:path` para a descoberta e a leitura (`realpathSync`), zod para a entrada da ferramenta e a configuração. Nenhuma nova (R1).
**Storage**: nada novo em disco, além do evento `skill.load` no `.maestro/autopilot/<id>.jsonl`, que já existe. Configuração nova: `skills.enabled` (padrão `true`).
**Testing**: vitest. As skills de teste são criadas em pastas temporárias, e `MAESTRO_HOME` isola a raiz do usuário. Um modelo simulado (`createFakeProvider` ou `speckitModel`) chama `load_skill`. A ponte MCP real é exercitada pelo `fakeClaudeCode`. Nenhum teste lê o `~/.claude` real.
**Target Platform**: Windows, macOS e Linux. Os caminhos vão ao modelo com `/`, e o confinamento usa `path.sep` depois de `realpath`.
**Project Type**: CLI única, sem mudança de estrutura.
**Performance Goals**: a descoberta de 50 skills fica abaixo de 200 ms (SC-002), com leitura síncrona de arquivos pequenos no mesmo ponto do `MAESTRO.md`.
**Constraints**:
- `load_skill` lê apenas dentro das pastas descobertas;
- o conteúdo das skills nunca vai para logs nem para o `.jsonl`;
- sem skills, o prompt é byte a byte igual ao atual (SC-006);
- a seção do prompt não tem dados variáveis (cache de prompt).
**Scale/Scope**: cerca de 4 arquivos novos e 8 pontos de integração.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Simplicidade**:
  - O cabeçalho é lido por um parser mínimo, em vez de uma biblioteca YAML (R1).
  - Uma só ferramenta, com `file` opcional, em vez de duas (R5).
  - Nenhuma lista de pastas configurável: só `skills.enabled` (R8).
  - O autopiloto se pluga pelo `runOverrides` existente (R7).
  - `/skills` é um aviso de texto, sem diálogo (R10).

  Passa.
- **II. CLI texto**: `/skills` funciona em `-p`. A ferramenta funciona igual em `-p`, na sessão interativa e no autopiloto. Passa.
- **III. Testabilidade**: `parseFrontmatter`, `skillsSection` e a resolução do catálogo (precedência, ignoradas) são puros. `discoverSkills` recebe o `fs` por injeção. Há testes:
  - de contrato: o schema e a descrição de `load_skill`, o snapshot do prompt sem skills e o formato do evento `skill.load`;
  - de integração: a carga pelos dois laços de ferramenta e o autopiloto num repositório git temporário.

  Passa.
- **IV. Credenciais**: as skills não envolvem credenciais. O evento e o log levam só nomes, origens e contagens. O `noSecrets` ganha um caso que garante que o corpo de uma skill não aparece no `debug.log` nem no `.jsonl`. O confinamento por `realpath` impede ler `~/.maestro/settings.json` (onde ficam as chaves) por um `file` com `..`. Passa.
- **V. Observabilidade**: eventos `skills.discover` (contagens), `skill.load` (nome, origem, ok, bytes) e `autopilot.skill`. As mensagens ao usuário são em português (`/skills`), e os erros da ferramenta vão em inglês, como os das outras ferramentas, porque o destinatário é o modelo. Passa.
- **VI–VII. Open source e atribuição**: o código é escrito do zero, e o formato `SKILL.md` é só uma convenção de arquivos. Nenhum conteúdo das skills do usuário é empacotado. Passa.
- **Restrição "ferramentas confinam escritas e comandos à pasta de trabalho"**: continua valendo. `load_skill` só lê, e só dentro das pastas de skills.

**Re-check pós-design**: sem violações. O Complexity Tracking fica vazio.

## Project Structure

### Documentation (this feature)

```text
specs/013-native-skills/
├── spec.md
├── plan.md              # este arquivo
├── research.md          # R1–R10
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── load-skill-tool.md
│   ├── skills-discovery-and-prompt.md
│   ├── autopilot-skill-event.md
│   └── settings.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/skills/frontmatter.ts        # NOVO, puro: parseFrontmatter(text) → { fields, body } | { error }
src/skills/catalog.ts            # NOVO: tipos (SkillSource, SkillEntry, SkillCatalog), discoverSkills, resolveCatalog (puro), skillsSection (puro), findSkill, sourceLabel, EMPTY_CATALOG
src/tools/loadSkill.ts           # NOVO: createLoadSkillTool(catalog) — listagem, confinamento realpath, limites
src/tools/types.ts               # ToolName += 'load_skill'; ToolResultDisplay.skill
src/tools/registry.ts            # toolsFor(settings, { skills? }) acrescenta load_skill quando o catálogo tem skills
src/config/schema.ts             # skills: { enabled } (+ defaults.ts)
src/session/systemPrompt.ts      # opção skills → seção # Skills (antes de Project guidelines)
src/index.ts                     # descobre o catálogo (skills.enabled && tools.enabled), loga skills.discover, passa para tools, prompt e controller
src/session/controller.ts        # opção skills (catálogo para /skills); runOverrides.onToolResult chamado em onToolEnd
src/session/commands.ts          # /skills
src/ui/toolDisplay.ts            # load_skill → Skill(nome[/arquivo]) e resumo
src/autopilot/driver.ts          # instala onToolResult → appendJsonl skill.load + logger autopilot.skill
README.md, CLAUDE.md

tests/unit/skills/frontmatter.test.ts
tests/unit/skills/catalog.test.ts             # precedência, ignoradas, speckit, seção (limites, corte, estabilidade), desempenho com 50 skills
tests/unit/tools/loadSkill.test.ts            # corpo + lista, file, ../, link simbólico, binário, grande, desconhecida
tests/unit/ui/toolDisplay.test.ts             # casos load_skill
tests/contract/load-skill.test.ts             # schema e descrição; prompt sem skills = snapshot atual; display não vai ao modelo
tests/integration/session/skills.test.ts      # carga pelo laço embutido e pelo provedor que executa ferramentas (fakeClaudeCode + ponte)
tests/integration/autopilot/run.test.ts       # + evento skill.load no .jsonl
tests/unit/security/noSecrets.skills.test.ts  # corpo da skill fora do debug.log e do .jsonl
```

**Structure Decision**: projeto único. A lógica de skills fica em `src/skills/`, porque não é uma ferramenta nem pertence à sessão: é consumida pelo prompt, pela ferramenta e por um comando. A ferramenta fica em `src/tools/`, ao lado das outras.

## Complexity Tracking

Nenhuma violação a justificar.
