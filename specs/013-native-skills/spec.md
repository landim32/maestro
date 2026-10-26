# Feature Specification: Suporte nativo a skills

**Feature Branch**: `013-native-skills`
**Created**: 2026-10-26
**Status**: Draft
**Input**: User description: "Suporte nativo a skills no maestro (recomendado). É o mesmo esquema do Claude Code: o modelo vê uma lista curta e só carrega o conteúdo inteiro quando precisa. Na inicialização, o maestro procura SKILL.md em .claude/skills/*, .agents/skills/* e ~/.claude/skills/*. Do frontmatter de cada uma, lê só name e description. Essa lista entra no system prompt, com uma regra: "antes de uma tarefa coberta por uma skill, carregue-a". Uma ferramenta nova, load_skill(name), devolve o SKILL.md e a lista dos arquivos de referência da skill. Isso também resolve o acesso às skills do usuário, que ficam fora do diretório do projeto. O log do autopiloto passa a gravar um evento skill.load com história, passo e skill. Assim você vê o que foi usado em cada passo."

## Contexto

Uma skill é uma pasta com um arquivo `SKILL.md`. O arquivo começa com um cabeçalho (frontmatter) que traz `name` e `description`, e o corpo traz instruções para um tipo de tarefa: um checklist de revisão, um padrão de projeto da equipe, o jeito de rodar os testes. A pasta pode ter arquivos de referência ao lado (exemplos, modelos, documentação). O Claude Code e outros agentes já leem skills em `.claude/skills/` e `.agents/skills/` do projeto e em `~/.claude/skills/` do usuário.

Hoje o Maestro ignora essas pastas. O modelo só chega a uma skill se resolver ler o arquivo por conta própria, e nunca alcança as skills do usuário, porque a leitura de arquivos é confinada à pasta de trabalho. No autopiloto isso fica pior: os passos do Spec Kit rodam sem as convenções que a equipe já escreveu como skills, e não há registro do que foi consultado.

A proposta segue o mesmo esquema do Claude Code. O modelo recebe só uma lista curta (nome e descrição de cada skill) e carrega o conteúdo inteiro de uma skill apenas quando a tarefa pede. O custo fixo no prompt fica pequeno, e o conteúdo completo entra só quando é útil.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O modelo conhece as skills e carrega a certa antes da tarefa (Priority: P1)

Como usuário com skills no projeto (`.claude/skills/` ou `.agents/skills/`) ou na minha pasta pessoal (`~/.claude/skills/`), abro o Maestro e peço uma tarefa que uma dessas skills cobre. O modelo já sabe que a skill existe, carrega o conteúdo dela e segue as instruções antes de fazer o trabalho. Não preciso citar o arquivo nem colar o conteúdo.

**Why this priority**: É o pedido central. Sem a lista e sem a ferramenta de carga, as skills que o usuário já mantém não servem para nada no Maestro.

**Independent Test**: Num projeto com uma skill `revisao-pr` em `.claude/skills/` e um modelo simulado, verificar que o prompt de sistema traz o nome e a descrição dela sem o corpo, e que uma chamada `load_skill("revisao-pr")` devolve o corpo do `SKILL.md` e a lista de arquivos da pasta.

**Acceptance Scenarios**:

1. **Given** skills em `.claude/skills/`, `.agents/skills/` e `~/.claude/skills/`, **When** o Maestro inicia, **Then** o prompt de sistema traz uma lista com o nome e a descrição de cada skill e a regra "antes de uma tarefa coberta por uma skill, carregue-a", mas não traz o corpo de nenhuma.
2. **Given** a lista no prompt, **When** o modelo chama `load_skill` com o nome de uma skill, **Then** recebe o conteúdo do `SKILL.md` e a lista dos arquivos de referência da pasta da skill (caminhos relativos à pasta).
3. **Given** uma skill pessoal em `~/.claude/skills/`, fora da pasta de trabalho, **When** o modelo a carrega, **Then** o conteúdo chega normalmente, embora a leitura comum de arquivos continue confinada à pasta de trabalho.
4. **Given** uma skill com arquivos de referência, **When** o modelo pede um desses arquivos pela mesma ferramenta (nome da skill + caminho relativo), **Then** recebe o conteúdo do arquivo. Um caminho que sai da pasta da skill é recusado.
5. **Given** um nome que não existe, **When** o modelo chama `load_skill`, **Then** recebe um erro que lista os nomes disponíveis, e o turno continua.
6. **Given** o provedor ativo é qualquer um (Claude, Qwen, Claude Code ou Codex), **When** o modelo carrega uma skill, **Then** a carga funciona da mesma forma e aparece na transcrição como as outras ferramentas (`⏺ Skill(nome)` com um resumo).
7. **Given** um projeto sem nenhuma skill, **When** o Maestro inicia, **Then** o prompt de sistema e as ferramentas ficam exatamente como hoje.

---

### User Story 2 - O autopiloto registra quais skills cada passo usou (Priority: P1)

Como usuário que roda `/autopilot` ou `maestro -p --autopilot`, quero saber depois quais skills o modelo consultou em cada história e em cada passo (specify, plan, implement...). Assim consigo conferir se as convenções da equipe foram seguidas e ajustar as descrições das skills que não estão sendo usadas.

**Why this priority**: O usuário pediu explicitamente. O autopiloto roda sem supervisão, e o registro é a única forma de auditar o que guiou cada passo.

**Independent Test**: Numa execução do autopiloto com um modelo simulado que chama `load_skill` durante o passo `plan`, verificar que o registro `.maestro/autopilot/<id>.jsonl` ganha um evento `skill.load` com a história, o passo e o nome da skill.

**Acceptance Scenarios**:

1. **Given** uma execução do autopiloto, **When** o modelo carrega uma skill durante um passo, **Then** o registro da execução ganha um evento `skill.load` com o horário, o número da história, a feature, o passo, o nome da skill e a origem (projeto ou usuário).
2. **Given** o modelo lê um arquivo de referência de uma skill, **When** o evento é gravado, **Then** ele traz também o caminho relativo do arquivo lido.
3. **Given** uma carga que falhou (nome inexistente, arquivo fora da pasta), **When** o evento é gravado, **Then** ele indica a falha, para que o usuário veja tentativas sem sucesso.
4. **Given** o evento gravado, **When** o usuário abre o registro, **Then** ele não contém o conteúdo da skill, só a identificação.

---

### User Story 3 - Ver e controlar as skills encontradas (Priority: P3)

Como usuário, quero conferir quais skills o Maestro encontrou, de onde vieram e quais foram ignoradas (e por quê). Também quero poder desligar o recurso por configuração.

**Why this priority**: Ajuda a diagnosticar uma skill que não aparece (cabeçalho inválido, nome repetido), mas o recurso funciona sem isso.

**Independent Test**: Com uma skill válida, uma sem descrição e duas com o mesmo nome, rodar o comando de listagem e verificar as válidas com a origem, a ignorada com o motivo e a sombreada indicada.

**Acceptance Scenarios**:

1. **Given** skills encontradas, **When** o usuário digita `/skills`, **Then** vê cada skill com nome, descrição e origem, mais as ignoradas e o motivo.
2. **Given** `"skills": { "enabled": false }` nas configurações, **When** o Maestro inicia, **Then** nenhuma pasta é lida, a lista não entra no prompt e a ferramenta não é oferecida.

---

### Edge Cases

- **Nome repetido**: a mesma skill pode existir no projeto e na pasta do usuário. Vale a primeira na ordem `.claude/skills/` do projeto → `.agents/skills/` do projeto → `~/.claude/skills/`. As outras são ignoradas e aparecem como sombreadas em `/skills`.
- **Cabeçalho sem `name`**: o nome da pasta é usado no lugar.
- **Cabeçalho sem `description`**, ou cabeçalho que não pode ser lido: a skill é ignorada, com o motivo registrado e exibido em `/skills`. O Maestro não falha ao iniciar.
- **Descrição longa**: na lista, a descrição é cortada num limite fixo, com reticências. O corpo completo continua disponível pela carga.
- **Muitas skills**: a lista no prompt tem um limite de itens e de tamanho. O excesso é omitido, com uma linha avisando quantas ficaram de fora e que `load_skill` aceita qualquer nome que aparece em `/skills`.
- **Skills do Spec Kit** (`speckit-*`/`speckit.*`, instaladas quando o projeto usa skills em vez de comandos): são ignoradas, porque o Maestro hospeda esses comandos de forma nativa e duplicá-las confundiria o modelo.
- **`SKILL.md` ou arquivo de referência muito grande**: a carga devolve um erro que pede um arquivo menor, em vez de despejar o conteúdo.
- **Arquivo binário**: a carga recusa e informa que o arquivo não é texto.
- **Link simbólico ou caminho com `..`** que leva para fora da pasta da skill: a carga é recusada.
- **Pastas inexistentes ou sem permissão de leitura**: são ignoradas em silêncio (a pasta pessoal ou a do projeto pode não existir).
- **Skill alterada durante a sessão**: a lista é a da inicialização, mas a carga lê o arquivo do disco na hora, então o conteúdo carregado está sempre atualizado.
- **`--no-tools`**: a lista não entra no prompt e a ferramenta não é oferecida, porque as skills orientam tarefas que dependem das ferramentas do espaço de trabalho.
- **Modelo carrega a mesma skill várias vezes no turno**: cada carga é atendida e registrada, sem bloqueio.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Ao iniciar a sessão (interativa, `-p` e autopiloto), o Maestro MUST procurar skills em `.claude/skills/*/SKILL.md` e `.agents/skills/*/SKILL.md` da pasta de trabalho e em `~/.claude/skills/*/SKILL.md`, só um nível abaixo de cada pasta.
- **FR-002**: Na descoberta, o Maestro MUST ler apenas o cabeçalho de cada `SKILL.md` e guardar nome, descrição, origem (projeto ou usuário) e pasta. O corpo não é lido nessa etapa.
- **FR-003**: Quando houver ao menos uma skill válida e as ferramentas estiverem habilitadas, o prompt de sistema MUST incluir uma seção com a regra "antes de uma tarefa coberta por uma skill, carregue-a com `load_skill`" e a lista de nome e descrição de cada skill, respeitando os limites de itens e de tamanho dos casos de borda.
- **FR-004**: Sem nenhuma skill válida, com `skills.enabled: false` ou com `--no-tools`, o prompt de sistema e o conjunto de ferramentas MUST ficar idênticos aos de hoje.
- **FR-005**: O Maestro MUST oferecer ao modelo a ferramenta `load_skill`, com o nome da skill como argumento obrigatório e um caminho de arquivo de referência como argumento opcional.
- **FR-006**: Sem caminho, `load_skill` MUST devolver o corpo do `SKILL.md` (sem o cabeçalho), a origem e a lista dos arquivos da pasta da skill, em caminhos relativos e com limite de itens.
- **FR-007**: Com caminho, `load_skill` MUST devolver o conteúdo daquele arquivo, desde que ele fique dentro da pasta da skill depois de resolver links e `..`. Fora da pasta, binário ou grande demais, a ferramenta MUST devolver um erro explicativo ao modelo.
- **FR-008**: `load_skill` MUST ser tratada como leitura: não pede confirmação em nenhum modo de aprovação e não dá acesso a nenhum arquivo fora das pastas de skills descobertas.
- **FR-009**: Um nome desconhecido MUST resultar em erro devolvido ao modelo, com a lista dos nomes disponíveis. O turno não termina.
- **FR-010**: Conflitos de nome MUST ser resolvidos pela ordem projeto `.claude/skills/` → projeto `.agents/skills/` → usuário `~/.claude/skills/`.
- **FR-011**: Skills sem descrição ou com cabeçalho ilegível MUST ser ignoradas sem interromper a inicialização, e o motivo MUST ficar disponível em `/skills`.
- **FR-012**: Skills cujo nome começa com `speckit-` ou `speckit.` MUST ser ignoradas, com esse motivo.
- **FR-013**: A carga de uma skill MUST funcionar com todos os provedores, inclusive os que executam pelo binário do usuário (Claude Code, Codex), pelo mesmo caminho das demais ferramentas do Maestro.
- **FR-014**: Na transcrição, cada carga MUST aparecer como uma chamada de ferramenta (`⏺ Skill(nome)` ou `⏺ Skill(nome/arquivo)`) com um resumo do resultado (por exemplo, o número de linhas e de arquivos de referência).
- **FR-015**: Durante uma execução do autopiloto, cada chamada de `load_skill` MUST gravar no registro `.jsonl` um evento `skill.load` com horário, história, feature, passo, nome da skill, origem, arquivo (quando houver) e indicação de sucesso ou falha.
- **FR-016**: O evento `skill.load` e o log de depuração MUST NOT conter o conteúdo da skill nem dos arquivos de referência.
- **FR-017**: O comando `/skills` MUST listar as skills válidas (nome, descrição, origem), as sombreadas e as ignoradas com o motivo.
- **FR-018**: A configuração `skills.enabled` (padrão: ligado) MUST permitir desligar o recurso. A chave ausente mantém o padrão, e a configuração MUST ser documentada no README.
- **FR-019**: A ferramenta MUST ler o arquivo do disco no momento da carga, para refletir alterações feitas durante a sessão.

### Key Entities

- **Skill**: uma pasta com `SKILL.md`. Atributos: nome, descrição, origem (projeto `.claude`, projeto `.agents`, usuário), pasta, estado (válida, sombreada, ignorada com motivo).
- **Catálogo de skills**: o resultado da descoberta na inicialização. É a lista ordenada de skills, usada pelo prompt de sistema, por `load_skill` e por `/skills`.
- **Carga de skill**: uma chamada de `load_skill`. Atributos: skill, arquivo opcional, resultado (conteúdo ou erro). No autopiloto, vira um evento `skill.load` no registro.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Num projeto com 20 skills, a seção de skills do prompt de sistema ocupa no máximo 7 000 caracteres, qualquer que seja o tamanho das descrições, e não contém nenhuma linha do corpo das skills.
- **SC-002**: A descoberta de 50 skills acrescenta menos de 200 ms à inicialização.
- **SC-003**: Em 100% das cargas de uma skill válida, com qualquer provedor, o modelo recebe o corpo completo do `SKILL.md` e a lista de arquivos de referência na mesma chamada.
- **SC-004**: 100% das tentativas de ler, por `load_skill`, um arquivo fora da pasta da skill são recusadas.
- **SC-005**: Depois de uma execução do autopiloto, o usuário identifica pelo registro, sem abrir outro arquivo, quais skills cada passo de cada história carregou.
- **SC-006**: Sem skills, ou com o recurso desligado, o prompt de sistema e a lista de ferramentas são idênticos aos da versão anterior. Os testes existentes passam sem alteração.

## Assumptions

- O formato de `SKILL.md` é o do Claude Code: cabeçalho YAML entre `---` com `name` e `description`, seguido de Markdown. Outros campos do cabeçalho (por exemplo, `allowed-tools`) são lidos mas ignorados nesta versão. A política de aprovação do Maestro continua sendo a única que vale.
- Só um nível de pastas é varrido (`skills/<nome>/SKILL.md`). Skills dentro de plugins, de `~/.agents/skills/` e de outras pastas ficam fora desta versão.
- A descoberta acontece uma vez por sessão. Para enxergar uma skill nova, basta abrir uma sessão nova.
- O conteúdo de uma skill é texto confiável do próprio usuário ou do projeto, como o `MAESTRO.md`. Ele orienta o modelo, mas não amplia permissões: toda ação que a skill sugerir passa pelas mesmas ferramentas e aprovações de sempre.
- Skills que trazem scripts não são executadas pela carga. Se o modelo quiser rodar um script, usa `run_command` dentro da pasta de trabalho, com a aprovação de sempre.
- Os provedores Claude Code e Codex continuam com os recursos próprios de skills desligados (eles já rodam isolados). As skills chegam a eles pela ferramenta do Maestro.
- Fora do autopiloto, a carga aparece na transcrição e no log de depuração (nome e tamanho, sem conteúdo). Não há um registro persistente adicional.
