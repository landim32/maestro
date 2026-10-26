# Tasks: Suporte nativo a skills

**Input**: Design documents from `specs/013-native-skills/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: a constituição exige testes (III. Testabilidade). Cada história traz testes unitários, de contrato e de integração. Nenhum teste lê o `~/.claude` real: as skills ficam em pastas temporárias, e `MAESTRO_HOME` aponta a raiz do usuário (`tests/helpers/tempHome.ts`).

**Format**: `[ID] [P?] [Story] Description`. `[P]` marca as tarefas que podem rodar em paralelo, por estarem em arquivos diferentes e sem dependência pendente.

## Phase 1: Setup

**Purpose**: tipos e configuração compartilhados por todas as histórias.

- [X] T001 Em `src/config/defaults.ts`, adicionar `DEFAULTS.skills = { enabled: true }`. Em `src/config/schema.ts`, adicionar `skillsSettingsSchema = z.strictObject({ _comment: comment, enabled: z.boolean().default(DEFAULTS.skills.enabled) })`, a chave `skills: skillsSettingsSchema.prefault({})` em `settingsSchema` (depois de `tools`) e o tipo `SkillsSettings`, conforme `contracts/settings.md`.
- [X] T002 Em `src/tools/types.ts`:
  - acrescentar `'load_skill'` a `ToolName`;
  - acrescentar a `ToolResultDisplay` o campo `skill?: SkillLoadDisplay`, com `name`, `source?`, `file?`, `ok`, `lines?` e `files?` (data-model § 4);
  - importar `SkillSource` como tipo de `../skills/catalog.js`.
- [X] T003 [P] Atualizar `tests/contract/config-schema.test.ts`. A ausência de `skills` deve dar `{ enabled: true }`. `skills.enabled: false` é aceito, e uma chave desconhecida em `skills` é recusada.

---

## Phase 2: Foundational (bloqueia todas as histórias)

**Purpose**: o cabeçalho e o catálogo, que o prompt, a ferramenta e o `/skills` consomem.

- [X] T004 Criar `src/skills/frontmatter.ts`, puro, com `parseFrontmatter(text: string): { fields: Record<string, string>; body: string } | { error: string }`, conforme research R1:
  - remover o BOM e normalizar `\r\n`;
  - a primeira linha precisa ser `---`; senão, o erro é `sem cabeçalho (---) no início do arquivo`;
  - o bloco termina na próxima linha `---`; sem ela, o erro é `cabeçalho sem fechamento ---`;
  - interpretar `chave: valor` no primeiro nível, com valores sem aspas, com aspas simples (`''` vira `'`) e com aspas duplas (`\"`, `\\`, `\n`, `\t`);
  - interpretar blocos `|` e `>` (com `-`/`+` opcionais) a partir das linhas mais indentadas que vêm depois;
  - juntar com espaço um valor sem aspas que continua em linhas indentadas;
  - pular listas e mapas aninhados pela indentação;
  - `body` é o texto depois do fechamento, sem a primeira linha vazia.
- [X] T005 [P] Criar `tests/unit/skills/frontmatter.test.ts` cobrindo:
  - valor sem aspas e com aspas simples e duplas, incluindo o caso real `description: "… \"your own browser\" …"`;
  - os blocos `>` e `|`;
  - a continuação indentada;
  - uma lista aninhada pulada (`allowed-tools:\n  - Read`);
  - BOM e CRLF;
  - o erro sem cabeçalho e o erro sem fechamento;
  - `body` preservado.
- [X] T006 Criar `src/skills/catalog.ts` com:
  - os tipos `SkillSource`, `SkillEntry` e `SkillCatalog` e a constante `EMPTY_CATALOG` (data-model § 1–3);
  - `sourceLabel(source)`, que dá `projeto (.claude/skills)`, `projeto (.agents/skills)` ou `usuário (~/.claude/skills)`;
  - `skillRoots(cwd, home)`, que devolve as três raízes na ordem de precedência;
  - `resolveCatalog(found)`, puro: recebe `{ source, dir, file, parsed | readError }[]` em ordem e devolve o catálogo, conforme `contracts/skills-discovery-and-prompt.md` § 1, passos 3 a 5:
    - nome do cabeçalho ou da pasta;
    - `description` vazia vira ignorada;
    - `/^speckit[-.]/i` vira ignorada;
    - nomes repetidos, comparados sem diferenciar maiúsculas, vão para `shadowed` com `by`;
  - `discoverSkills({ cwd, home, fs })`, síncrono, com `fs` injetável (`readdirSync`, `statSync`, `readFileSync`, `existsSync`):
    - lê as subpastas imediatas em ordem alfabética e segue links;
    - só considera as que têm `SKILL.md`;
    - uma raiz ausente ou ilegível é pulada em silêncio;
    - um erro de leitura vira ignorada com o motivo `não foi possível ler (<code>)`;
    - nunca lança exceção;
  - `findSkill(catalog, name)`, com busca exata e, se não achar, sem diferenciar maiúsculas.
- [X] T007 Em `src/skills/catalog.ts`, criar `skillsSection(skills: SkillEntry[]): string`, puro, conforme `contracts/skills-discovery-and-prompt.md` § 2 e research R3–R4:
  - o texto fixo da regra;
  - itens `- <name>: <description>`, com espaços colapsados e corte em `DESCRIPTION_MAX = 250` com `…`;
  - os limites `LIST_MAX_ITEMS = 50` e `LIST_MAX_CHARS = 12_000`, com a linha final `- … mais N skills (use /skills para ver todas; load_skill aceita qualquer nome válido)`;
  - devolve `''` quando a lista é vazia.
- [X] T008 [P] Criar `tests/unit/skills/catalog.test.ts` cobrindo:
  - a precedência `.claude` → `.agents` → usuário, com a sombreada e seu `by`;
  - o nome da pasta como reserva;
  - a ignorada sem description;
  - a ignorada por ser `speckit-plan` e por ser `speckit.tasks`;
  - a raiz inexistente;
  - EACCES numa pasta via `fs` injetado;
  - a ordem alfabética;
  - a pasta `synced/<bucket>/<nome>/SKILL.md`, que não é encontrada (só um nível);
  - `skillsSection`: o corte a 250, os limites de 50 itens e de caracteres com a linha "mais N", a ausência de qualquer trecho do corpo, o resultado determinístico e 20 skills com descrições de 800 caracteres em ≤ 7 000 caracteres (SC-001);
  - desempenho: 50 skills numa pasta temporária descobertas em < 200 ms (SC-002).

**Checkpoint**: `npx vitest run tests/unit/skills` verde.

---

## Phase 3: User Story 1 — O modelo conhece as skills e carrega a certa (Priority: P1) 🎯 MVP

**Goal**: lista curta no prompt de sistema e `load_skill` funcionando com todos os provedores, com exibição na transcrição.

**Independent Test**: num projeto com `.claude/skills/revisao-pr/`, o prompt traz o nome e a descrição sem o corpo, e `load_skill("revisao-pr")` devolve o corpo e a lista de arquivos. Testado pelo laço embutido e pelo laço conduzido pelo provedor.

### Tests for User Story 1

- [X] T009 [P] [US1] Criar `tests/unit/tools/loadSkill.test.ts`, conforme `contracts/load-skill-tool.md` § 2–4, com uma skill em pasta temporária, cobrindo:
  - a saída sem `file`: o cabeçalho `# Skill:`, `Source:`, o corpo sem o frontmatter e a lista ordenada sem `SKILL.md`, sem `.git/` nem `node_modules/`, com `/` e até 3 níveis;
  - o limite de 100 arquivos com `… +N more`;
  - a saída com `file`;
  - `display.skill` em cada caso;
  - os erros: nome desconhecido (lista de nomes), `../outra/SKILL.md`, caminho absoluto, link simbólico para fora (pular no Windows se `symlinkSync` falhar com EPERM), arquivo inexistente, pasta, mais de 256 KB, NUL (binário) e `SKILL.md` removido depois da descoberta;
  - a leitura no momento da carga (FR-019): altera o arquivo, carrega e confere o conteúdo novo;
  - `kind === 'read'`.
- [X] T010 [P] [US1] Criar `tests/contract/load-skill.test.ts` cobrindo:
  - o nome, a descrição e o JSON Schema de `load_skill` (`name` obrigatório e `file` não obrigatório);
  - `buildSystemPrompt` sem `skills` e com `skills: []`, que deve ser byte a byte igual ao prompt atual (snapshot em `tests/contract/__snapshots__`);
  - com skills, a seção `# Skills` antes de `# Project guidelines`, com `Language:` ainda como última linha;
  - `toolsFor` sem catálogo e com catálogo vazio, idêntico ao atual;
  - `display.skill` fora do que os conversores enviam ao modelo (estender `tests/contract/display.test.ts` se for mais simples).
- [X] T011 [P] [US1] Em `tests/unit/ui/toolDisplay.test.ts`, acrescentar os casos de `load_skill`:
  - `describeCall` com `{ name }` dá `Skill(revisao-pr)`, e com `{ name, file }` dá `Skill(revisao-pr/references/x.md)`, cortado no meio;
  - `describeResult` dá `120 linhas · 3 arquivos de referência`, `1 linha · 1 arquivo de referência` e `Leu 12 linhas`;
  - um erro tem tom `error`.
- [X] T012 [US1] Criar `tests/integration/session/skills.test.ts`, com uma skill em `.claude/skills` e outra em `MAESTRO_HOME/.claude/skills`, cobrindo:
  - o laço embutido (`createFakeProvider` chamando `load_skill`): resultado no histórico com o corpo, sem pedir confirmação no modo `default`;
  - o laço conduzido pelo provedor (o mesmo padrão de `tests/integration/session/providerDrivenTurn.test.ts`): a chamada passa por `executeTool` e o `tool_result` traz o corpo;
  - a skill do usuário, fora do cwd, carregada com sucesso, enquanto `read_file` do mesmo caminho continua recusado.

### Implementation for User Story 1

- [X] T013 [US1] Criar `src/tools/loadSkill.ts` com `createLoadSkillTool(catalog: SkillCatalog): ToolDefinition<LoadSkillInput>`, conforme `contracts/load-skill-tool.md`:
  - o schema zod com `file` em `.optional()`;
  - `kind: 'read'`;
  - a leitura com `fs/promises` e `realpath` dos dois lados, com o teste de prefixo `root + path.sep`;
  - os limites `MAX_SKILL_FILE_BYTES = 256 * 1024` e de NUL em 8 000 bytes;
  - a listagem recursiva (até 3 níveis, 100 entradas, ignora `.*` e `node_modules`);
  - o corpo vem de `parseFrontmatter(text).body`;
  - `truncate(…, ctx.settings.maxOutputChars)`;
  - `display.skill` preenchido em sucesso e em erro.
- [X] T014 [US1] Em `src/tools/registry.ts`, mudar `toolsFor(settings, opts?: { skills?: SkillCatalog })` para acrescentar `createLoadSkillTool(opts.skills)` depois das ferramentas do espaço de trabalho, só quando `settings.enabled && opts?.skills?.skills.length`. Ajustar `getTool` se ele precisar enxergar a ferramenta (preferir não registrá-la em `ALL`, porque depende do catálogo).
- [X] T015 [US1] Em `src/session/systemPrompt.ts`, acrescentar a opção `skills?: SkillEntry[]`. Quando ela não for vazia e `toolsEnabled` for verdadeiro, inserir `''` e `skillsSection(skills)` depois das linhas de diretrizes (incluindo a de `ask_user`) e antes de `# Project guidelines`. Sem a opção, a saída fica idêntica à atual.
- [X] T016 [US1] Em `src/index.ts`:
  - criar o catálogo com `loaded.settings.skills.enabled && loaded.settings.tools.enabled ? discoverSkills({ cwd, home: homeDir(process.env), fs }) : EMPTY_CATALOG`;
  - logar `skills.discover` com as contagens `{ skills, shadowed, ignored, project, user }`, sem nomes nem caminhos;
  - passar o catálogo a `toolsFor(…, { skills })`, a `buildSystemPrompt({ …, skills: catalog.skills })` e ao `SessionController` (opção `skills`, usada pela US3).
- [X] T017 [US1] Em `src/ui/toolDisplay.ts`:
  - em `describeCall`, o caso `load_skill` dá `{ label: 'Skill', arg: file ? \`${name}/${file}\` : name, cut: 'middle' }`;
  - em `describeResult`, o caso `load_skill` usa `display.skill` para montar `<n> linhas · <m> arquivos de referência` (sem `file`) ou `Leu <n> linhas` (com `file`), no singular e no plural via `plural`;
  - em `toolLabel` e `summarizeInput` do controller, se houver um mapa por ferramenta, incluir `load_skill` e mostrar o nome da skill na linha de atividade.
- [X] T018 [US1] Em `src/tools/loadSkill.ts`, logar `skill.load` com `{ name, source, file, ok, bytes }` pelo logger. Se o logger não chegar à ferramenta, emitir no `onToolEnd` do controller (`src/session/controller.ts`) a partir de `result.display.skill`, sem conteúdo.

**Checkpoint**: T009 a T012 verdes. A US1 pode ser demonstrada com o roteiro 2 de `quickstart.md`.

---

## Phase 4: User Story 2 — O autopiloto registra as skills de cada passo (Priority: P1)

**Goal**: um evento `skill.load` no `.jsonl`, com história, feature, passo e skill.

**Independent Test**: uma execução do autopiloto em que o modelo simulado chama `load_skill` no `plan` grava o evento com `story`, `step: 'plan'`, `skill`, `source` e `ok`, sem conteúdo.

### Tests for User Story 2

- [X] T019 [P] [US2] Em `tests/integration/autopilot/run.test.ts`, criar uma skill em `.claude/skills/padroes/` no repositório temporário e fazer o `speckitModel` chamar `load_skill({ name: 'padroes' })` no passo `plan`, além de um nome inexistente no `implement`. Conferir no `.jsonl`:
  - um evento `skill.load` com `story: 1`, `feature`, `step: 'plan'`, `skill: 'padroes'`, `source: 'project-claude'` e `ok: true`;
  - outro com `ok: false` e sem `source`;
  - nenhuma linha com o corpo da skill.

  Se o `speckitModel` não aceitar chamadas extras, estender `tests/helpers/autopilotPorts.ts` com uma opção `extraCalls: { [step]: ToolCall[] }`.
- [X] T020 [P] [US2] Criar `tests/unit/security/noSecrets.skills.test.ts`. Uma skill com um corpo-sentinela (`SENTINELA-SKILL-123`) é carregada com `--debug` ligado. Nem o `debug.log` nem o `.jsonl` podem conter a sentinela, e `skills.discover` não pode conter caminhos do usuário.

### Implementation for User Story 2

- [X] T021 [US2] Em `src/session/controller.ts`:
  - acrescentar `onToolResult?: (name: string, result: ToolResult) => void` ao tipo de `overrides` e ao parâmetro de `runOverrides`, copiado em `this.overrides` e restaurado como os demais;
  - chamar `this.overrides.onToolResult?.(name, r)` no `onToolEnd` do `submit`.
- [X] T022 [US2] Em `src/autopilot/driver.ts`, no `runOverrides` de `start`/`resume`, passar um `onToolResult` que, quando `result.display?.skill` existir:
  - grava `appendJsonl(root, run.id, { event: 'skill.load', story, feature?, step, skill, source?, file?, ok })`, com o `Step` corrente (o mesmo `current()` que alimenta o decisor) e `feature` vindo de `run.stories[s.story].feature`, conforme `contracts/autopilot-skill-event.md` § 2;
  - loga `autopilot.skill` com `{ story, step, ok }`.

  Os campos ausentes devem ser omitidos, nunca `undefined` serializado.

**Checkpoint**: T019 e T020 verdes. `grep skill.load` no `.jsonl` responde "quais skills cada passo usou" (SC-005).

---

## Phase 5: User Story 3 — Ver e controlar as skills encontradas (Priority: P3)

**Goal**: o diagnóstico `/skills` e o desligamento por `skills.enabled`.

**Independent Test**: com uma skill válida, uma sem description, uma `speckit-*` e duas com o mesmo nome, `/skills` mostra os três blocos. Com `skills.enabled: false`, nada é lido e nada entra no prompt.

### Tests for User Story 3

- [X] T023 [P] [US3] Criar `tests/unit/session/skillsCommand.test.ts`, com o controller de teste existente em `tests/helpers/context.ts` e um catálogo montado à mão, cobrindo:
  - o texto de `/skills` com os blocos "Skills disponíveis (n)", "Sombreadas (n)" e "Ignoradas (n)";
  - os caminhos relativos e com `~/`;
  - o corte a 100 colunas;
  - a mensagem sem skills;
  - a mensagem com o recurso desligado;
  - a mensagem com `--no-tools`.
- [X] T024 [P] [US3] Em `tests/integration/session/skills.test.ts`, acrescentar o caso `skills.enabled: false`: `discoverSkills` não é chamado (`fs` espião), o prompt não traz `# Skills` e não existe `load_skill` entre as ferramentas. Acrescentar também o caso `tools.enabled: false` com o mesmo resultado.

### Implementation for User Story 3

- [X] T025 [US3] Em `src/session/controller.ts`, aceitar a opção `skills?: { catalog: SkillCatalog; state: 'on' | 'disabled' | 'no-tools' }` e expô-la como `readonly skills`. Em `src/index.ts`, preencher `state` a partir de `skills.enabled` e `tools.enabled`.
- [X] T026 [US3] Em `src/session/commands.ts`, criar o comando embutido `skills` (descrição `List the skills found (.claude/skills, .agents/skills, ~/.claude/skills).`), conforme `contracts/skills-discovery-and-prompt.md` § 3, emitindo `ctl.notice(texto, 'info')`, e registrá-lo na lista de comandos embutidos. A formatação fica numa função pura exportada, `skillsReport(catalog, state, cwd, home)`, em `src/skills/catalog.ts`, para o teste T023.
- [X] T027 [US3] Confirmar que `maestro -p "/skills"` imprime o relatório (o caminho de comandos embutidos em `src/cli/nonInteractive.ts`). Se os avisos `info` não chegarem ao stdout ou ao stderr em `-p`, ajustar para que cheguem, como no `/help`.

**Checkpoint**: T023 e T024 verdes.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T028 [P] Em `README.md`:
  - escrever a seção "Skills": as pastas, a precedência, a lista no prompt, `load_skill`, `/skills`, as skills `speckit-*` ignoradas, `--no-tools` e o evento `skill.load` do autopiloto;
  - incluir `"skills": { "enabled": true }` no exemplo de configuração;
  - incluir `/skills` na lista de comandos.
- [X] T029 [P] Em `CLAUDE.md`, acrescentar à Arquitetura um parágrafo **Skills (specs/013)** (`src/skills/`, `load_skill` confinada por `realpath`, `display.skill`, `runOverrides.onToolResult` → `skill.load`) e acrescentar `skills/` em Project Structure.
- [X] T030 Rodar `npm run typecheck`, `npm run lint`, `npx prettier --check --end-of-line auto .` e `npm test`, nessa ordem, e corrigir o que falhar. Os testes existentes precisam passar sem alteração de expectativa (SC-006), exceto o snapshot de configuração que ganha `skills`.
- [ ] T031 Rodar `npm run build` e executar `quickstart.md`, roteiros 1 a 4, com pelo menos dois provedores (um de API e um de CLI). Registrar o resultado no PR.

---

## Dependencies & Execution Order

- **Phase 1 (T001–T003)** → **Phase 2 (T004–T008)** → as histórias.
- **US1 (T009–T018)** é a base: a US2 depende de `display.skill` (T013) e do caminho das ferramentas, e a US3 depende do catálogo no controller (T016).
- **US2 (T019–T022)** e **US3 (T023–T027)** são independentes entre si depois da US1.
- **Polish (T028–T031)** fica para o fim.

Dentro de cada história, os testes vêm antes da implementação. T013 vem antes de T014 e de T017. T015 e T016 dependem de T007 e de T014. T021 vem antes de T022. T025 vem antes de T026.

## Parallel Execution Examples

- **Phase 2**: T005 e T008 podem ser escritos junto com T004 e T006 (pares teste/código em arquivos diferentes).
- **US1**: T009, T010 e T011 em paralelo; depois T013; então T015 e T017 em paralelo; T016 por último.
- **US2 e US3**: T019, T020, T023 e T024 em paralelo. Depois, as duas trilhas de implementação (T021→T022 e T025→T027) seguem em paralelo.
- **Polish**: T028 e T029 em paralelo.

## Implementation Strategy

1. **MVP = Phases 1–3 (US1)**: as skills aparecem no prompt e são carregadas por qualquer provedor, o que já resolve o acesso às skills do usuário.
2. **US2**: rastreabilidade no autopiloto, o segundo pedido explícito.
3. **US3**: diagnóstico e desligamento. Pode ser cortado sem afetar as outras histórias.
4. **Polish**: documentação, checagens completas e quickstart.
