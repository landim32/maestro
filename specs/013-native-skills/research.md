# Research: Suporte nativo a skills

Decisões técnicas da feature 013, no formato Decisão / Justificativa / Alternativas.

## R1. Leitura do cabeçalho sem dependência nova

- **Decisão**: um parser puro e mínimo (`src/skills/frontmatter.ts`) para o subconjunto de YAML usado nos cabeçalhos de skill. Ele cobre:
  - o bloco entre a primeira linha `---` e a próxima `---`;
  - pares `chave: valor` no primeiro nível;
  - valores sem aspas, com aspas simples (`''` vira `'`) e com aspas duplas (escapes `\"`, `\\`, `\n`);
  - blocos `|` e `>` (com `-`/`+` opcionais), formados pelas linhas mais indentadas que seguem;
  - um valor sem aspas continuado nas linhas indentadas seguintes (juntadas com espaço).

  Listas e mapas aninhados são pulados pela indentação. BOM e `\r\n` são aceitos. O parser devolve `{ fields: Record<string, string>, body: string }` ou um erro com motivo ("cabeçalho sem fechamento `---`").
- **Justificativa**: só `name` e `description` interessam, e as skills reais usam strings simples, com aspas ou dobradas. Um exemplo é `~/.claude/skills/.../built-in-browser/SKILL.md`, com `description` entre aspas duplas, `\"` dentro e cerca de 800 caracteres. A constituição (I) pede não adicionar dependência quando o stack resolve.
- **Alternativas**: `yaml` ou `js-yaml` foram rejeitadas, por serem dependência nova para dois campos. Usar só uma regex `^name:` foi rejeitado, porque quebra com aspas e blocos dobrados.

## R2. Onde procurar e precedência

- **Decisão**: três raízes, nesta ordem:
  1. `<cwd>/.claude/skills`
  2. `<cwd>/.agents/skills`
  3. `<homeDir()>/.claude/skills`

  `homeDir()` de `config/paths.ts` respeita `MAESTRO_HOME`, o que isola os testes. Em cada raiz, só as subpastas imediatas que contêm `SKILL.md` contam. Vale o primeiro nome encontrado, e os seguintes ficam como `shadowed`. A ordem dentro de uma raiz é alfabética, para que o prompt seja estável.
- **Justificativa**: é o pedido do usuário. Um só nível é o layout do Claude Code. Nesta máquina, `~/.claude/skills/synced/<bucket>/<nome>/SKILL.md` guarda as skills sincronizadas do app Claude. Elas dependem de ferramentas que o Maestro não tem (navegador, computer use, Docs) e têm licença proprietária, e o nível único as deixa de fora naturalmente. O projeto vem antes do usuário porque é mais específico.
- **Alternativas**: uma varredura recursiva foi rejeitada, porque pegaria `synced/`, `node_modules` e exemplos dentro de skills. A raiz do usuário em `~/.agents/skills` fica fora desta versão (spec, Assumptions).

## R3. Custo da lista no prompt

- **Decisão**: os limites ficam em `src/skills/catalog.ts`:
  - `DESCRIPTION_MAX` = 250 caracteres, com espaços colapsados e `…` no corte;
  - `LIST_MAX_ITEMS` = 50;
  - `LIST_MAX_CHARS` = 12 000.

  Ao estourar um limite, a lista para e ganha a linha `- … mais N skills (use /skills para ver todas; load_skill aceita qualquer nome válido)`.

  O formato de cada item é `- <name>: <description>`. A seção vem antes de "Project guidelines" e depois das diretrizes de ferramentas. Ela não tem timestamp, o que mantém o prefixo estável para o cache de prompt.
- **Justificativa**: 20 skills × (250 + nome + 4) + cabeçalho da seção ≈ 6 300 caracteres, dentro do SC-001 (7 000). O corte a 250 caracteres mantém a parte da descrição que diz quando usar a skill, que costuma ser a primeira frase.
- **Alternativas**: não cortar foi rejeitado, porque descrições de 800 caracteres somariam cerca de 16 000 com 20 skills. Mandar só os nomes também foi rejeitado, porque o modelo não saberia quando carregar cada skill.

## R4. Texto da regra no prompt

- **Decisão**: a seção abaixo, em inglês como o resto do prompt de sistema:

  ```text
  # Skills

  Skills are instructions written by the user or the project for specific kinds of tasks.
  - Before starting a task that one of the skills below covers, call load_skill with its name and follow its instructions.
  - A skill may point to reference files in its folder; read them with load_skill(name, file), not with read_file.
  - Do not load skills that are unrelated to the current task.

  - <name>: <description>
  ```
- **Justificativa**: a regra repete a do Claude Code ("antes de uma tarefa coberta por uma skill, carregue-a") e impede o erro previsível de tentar `read_file` numa pasta fora do cwd.
- **Alternativas**: colocar a regra na descrição da ferramenta foi rejeitado. Alguns provedores (Claude Code, Codex) reescrevem ou resumem as descrições das ferramentas, e o prompt de sistema é o único texto que todos recebem igual.

## R5. Ferramenta `load_skill`: forma e confinamento

- **Decisão**: um `ToolDefinition` criado por fábrica, `createLoadSkillTool(catalog, deps?)`, porque precisa do catálogo da sessão.
  - **Entrada**: `{ name: string, file?: string }`, com `file` em `.optional()`, como manda o CLAUDE.md.
  - **Tipo**: `kind: 'read'`. Pela política, `needsConfirmation(mode, 'read')` é `false` em todos os modos.
  - **Sem `file`**: devolve o corpo do `SKILL.md` sem o cabeçalho e a lista de arquivos da pasta. A lista é recursiva até 3 níveis e tem no máximo 100 entradas. Ignora pastas que começam com `.` e `node_modules`. Deixa o próprio `SKILL.md` de fora e usa `/` como separador.
  - **Com `file`**: o caminho absoluto é `realpath(join(realpath(dir), file))` e precisa começar com `realpath(dir) + sep`. Se não começar, ou se o caminho for absoluto, o erro é `file outside the skill folder`.
  - **Limites**: o teto é de 256 KB, e acima dele o erro é `file too large`. Um NUL nos primeiros 8 000 bytes dá o erro `not a text file`, o mesmo teste do `read_file`. A saída passa por `truncate(…, settings.maxOutputChars)`.
  - **Nome desconhecido**: o erro `unknown skill "x". Available: a, b, c` traz até 50 nomes.
- **Justificativa**: assim a ferramenta lê só dentro das pastas descobertas, o que cumpre FR-007, FR-008 e SC-004. `realpath` dos dois lados trata links simbólicos e `..`. Uma pasta de skill que é ela própria um link, caso comum quando se instala com `ln -s`, continua válida, porque a raiz confiável é o destino real.
- **Alternativas**: ampliar `resolveInsideCwd` para aceitar as pastas de skills foi rejeitado, porque abriria `write_file` e `run_command` para fora do cwd. Uma segunda ferramenta, `read_skill_file`, também foi rejeitada: um argumento opcional basta (YAGNI).

## R6. Metadados para a transcrição e o autopiloto

- **Decisão**: `ToolResultDisplay` ganha `skill?: { name: string; source: SkillSource; file?: string; ok: boolean; lines?: number; files?: number }`. O `load_skill` o preenche sempre, também no erro, com `ok: false` e `source` ausente quando o nome não existe. Como `display` nunca vai ao modelo (`tests/contract/display.test.ts`), isso é só local.
- **Justificativa**: um único dado serve à transcrição (`⏺ Skill(nome)` com `⎿ 120 linhas · 3 arquivos de referência`), ao evento `skill.load` do autopiloto e ao log de depuração. Nenhum deles precisa ler a saída textual da ferramenta.
- **Alternativas**: extrair esses dados do texto de saída foi rejeitado por ser frágil. Um canal de eventos novo no `ToolContext` também foi rejeitado, porque é um mecanismo a mais para um único uso.

## R7. Como o autopiloto vê as cargas

- **Decisão**: `SessionController.runOverrides` ganha `onToolResult?: (name: string, result: ToolResult) => void`, chamado no `onToolEnd` de `submit`, e é chamado nos dois laços de ferramenta, porque ambos passam por `executeTool`. O `AutopilotDriver` instala esse callback e, quando `result.display?.skill` existe, grava `appendJsonl(root, id, { event: 'skill.load', story, feature, step, skill, source, file?, ok })` e loga `autopilot.skill` sem conteúdo. A história e o passo vêm do `Step` corrente, que o driver já mantém (`current()`, usado pelo decisor). A feature vem de `story.feature` no estado.
- **Justificativa**: o driver é o único módulo do autopiloto com efeitos (CLAUDE.md), e `runOverrides` já é o ponto onde ele se pluga no controller (`ask`, `confirm`, `networkRetries`). Nenhum módulo puro muda.
- **Alternativas**: fazer o `load_skill` escrever no `.jsonl` foi rejeitado, porque a ferramenta passaria a conhecer o autopiloto. Ler o histórico da sessão depois do turno também foi rejeitado: o autopiloto roda com `record: false`, então não há histórico para ler.

## R8. Skills do Spec Kit, `--no-tools` e configuração

- **Decisão**:
  - Nomes que casam com `/^speckit[-.]/i` ficam como `ignored` com o motivo "comando do Spec Kit hospedado nativamente pelo Maestro".
  - A descoberta só roda quando `settings.skills.enabled` é verdadeiro (chave nova `skills: { enabled: true }`, padrão ligado) e `tools.enabled` também. Com `--no-tools`, o catálogo fica vazio. Com catálogo vazio, `toolsFor` e `buildSystemPrompt` devolvem exatamente o que devolvem hoje, o que cumpre FR-004 e SC-006.
- **Justificativa**: o `specify init --ai-skills` instala as próprias skills `speckit-*` em `.claude/skills/`. Listá-las faria o modelo carregar o prompt original do Spec Kit, que manda rodar os scripts, em vez de usar o comando nativo. A chave fica no nível de cima, e não em `tools`, porque o recurso também altera o prompt de sistema.
- **Alternativas**: listar `skills.paths` configuráveis foi rejeitado nesta versão (YAGNI), e fica como extensão natural depois.

## R9. Descoberta síncrona na inicialização

- **Decisão**: `discoverSkills({ cwd, home, fs? })` é síncrono e usa `readdirSync`, `statSync` e `readFileSync`. Lê o arquivo inteiro, mas guarda só o cabeçalho. `fs` é injetável nos testes de erro (EACCES). Pastas inexistentes ou ilegíveis são puladas sem aviso. Uma skill com cabeçalho inválido vira `ignored` com o motivo.
- **Justificativa**: o carregamento de `MAESTRO.md` já é síncrono no mesmo ponto de `index.ts`. Ler 50 arquivos pequenos leva poucos milissegundos (SC-002 < 200 ms, fixado por um teste de desempenho com 50 skills em pasta temporária). Ler o corpo "sem guardar" não fere FR-002, que trata do que entra no catálogo e no prompt.
- **Alternativas**: ler só os primeiros N bytes foi rejeitado. Isso cortaria cabeçalhos longos (a `description` de 800 caracteres) e complica o código sem ganho mensurável.

## R10. Exibição em `/skills` e no modo `-p`

- **Decisão**: `/skills` é um comando embutido que emite um aviso `info` com três blocos: "Skills disponíveis" (nome, origem, descrição cortada a 100 colunas), "Sombreadas" (nome, origem e qual vence) e "Ignoradas" (caminho relativo e motivo). Sem nada a mostrar, a mensagem é "Nenhuma skill encontrada em .claude/skills, .agents/skills ou ~/.claude/skills." Com o recurso desligado, a mensagem é "Skills desligadas (skills.enabled: false)." Em `-p "/skills"` o mesmo texto sai pelo caminho de avisos que os outros comandos já usam.
- **Justificativa**: o princípio II pede um equivalente em texto, e os comandos embutidos já usam `ctl.notice`.
- **Alternativas**: um diálogo Ink foi rejeitado, por ser pesado para uma listagem de leitura.
