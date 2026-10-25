# Feature Specification: Spec Kit Nativo no Maestro

**Feature Branch**: `006-native-spec-kit`  
**Created**: 2026-10-25  
**Status**: Draft  
**Input**: User description: "Preciso que o speckit do github seja implementado nativamente no maestro https://github.com/github/spec-kit"

## Visão Geral

O [Spec Kit](https://github.com/github/spec-kit) (GitHub, MIT) é o fluxo de desenvolvimento orientado a especificação que este projeto já usa: `/speckit.constitution`, `/speckit.specify`, `/speckit.clarify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.analyze`, `/speckit.checklist`, `/speckit.implement` e `/speckit.taskstoissues`. Hoje ele só funciona dentro do Claude Code: a CLI `specify` (Python) instala templates e scripts em `.specify/` e arquivos de comando em `.claude/commands/`, e é o Claude Code que descobre os comandos, injeta o texto deles no prompt e deixa o modelo rodar os scripts PowerShell/bash que criam branches, numeram features e verificam pré‑requisitos.

Esta feature torna o Maestro um hospedeiro completo do Spec Kit, sem depender do Claude Code, da CLI `specify` ou de um shell específico:

1. **Comandos nativos**: o Maestro descobre e oferece os comandos `/speckit.*` do projeto (ou os embutidos nele), com autocompletar e `/help`, em qualquer provedor (Claude ou Qwen).
2. **Passos determinísticos nativos**: numerar e criar a branch da feature, verificar pré‑requisitos, copiar templates e atualizar o arquivo de contexto do agente são feitos pelo próprio Maestro, com o mesmo resultado que os scripts do Spec Kit produzem, sem executar PowerShell, bash ou Python.
3. **Projetos novos e existentes**: `/speckit.init` prepara um projeto do zero com os templates embutidos; um projeto já inicializado pela CLI `specify` (como este repositório) funciona sem alteração e com suas customizações respeitadas.
4. **Integração com o que o Maestro já tem**: perguntas de clarificação viram diálogos `ask_user`; escritas e comandos seguem o modo de aprovação; o fluxo inteiro também funciona no modo `-p`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rodar o fluxo Spec Kit de um projeto já inicializado (Priority: P1)

Em um projeto que já tem `.specify/` e os arquivos de comando (instalados pela CLI `specify` ou por outro agente), o usuário abre o Maestro, digita `/speckit.specify Quero…` e o Maestro executa o comando exatamente como o Claude Code faria: lê o arquivo do comando, substitui os argumentos, cria a branch `NNN-nome` e o `specs/NNN-nome/spec.md` a partir do template, e o modelo preenche a spec. Em seguida `/speckit.plan`, `/speckit.tasks` e `/speckit.implement` funcionam na sequência, cada um encontrando os artefatos do anterior. Os passos que o Spec Kit delega a scripts (numerar a feature, criar a branch, checar pré‑requisitos, copiar o template do plano, atualizar o arquivo de contexto) são executados pelo Maestro, sem shell.

**Why this priority**: É o caso de uso imediato do próprio projeto Maestro: continuar desenvolvendo com Spec Kit sem precisar do Claude Code, inclusive com o Qwen.

**Independent Test**: Neste repositório, com o Maestro em qualquer provedor, rodar `/speckit.specify` com uma descrição de teste e verificar que a branch `007-…` e `specs/007-…/spec.md` são criados e preenchidos; rodar `/speckit.plan` e verificar `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/` e a atualização de `CLAUDE.md`; rodar `/speckit.tasks` e verificar `tasks.md`. Nenhum processo PowerShell/bash deve ter sido iniciado pelo Maestro para esses passos.

**Acceptance Scenarios**:

1. **Given** um projeto com `.specify/` e arquivos de comando, **When** o usuário digita `/` no prompt, **Then** os comandos `/speckit.*` aparecem na lista de comandos (e em `/help`) com a descrição de cada um.
2. **Given** o usuário envia `/speckit.specify <descrição>`, **When** o comando roda, **Then** a branch `NNN-<nome-curto>` é criada com o próximo número livre (considerando branches locais, remotas e pastas em `specs/`), `specs/NNN-<nome>/spec.md` é criado a partir do template e o modelo o preenche conforme as instruções do comando; a transcrição mostra a branch e o arquivo criados.
3. **Given** a branch de feature ativa, **When** o usuário roda `/speckit.plan`, **Then** o plano é criado a partir do template, os artefatos de pesquisa e desenho são gerados conforme o comando, e o arquivo de contexto do agente do projeto é atualizado só com as tecnologias novas, preservando a seção de adições manuais.
4. **Given** `plan.md` existe, **When** o usuário roda `/speckit.tasks`, `/speckit.analyze`, `/speckit.checklist` ou `/speckit.implement`, **Then** cada um recebe os caminhos dos artefatos disponíveis e segue suas instruções; `/speckit.implement` marca as tarefas concluídas em `tasks.md`.
5. **Given** o comando precisa de um artefato que não existe (por exemplo `/speckit.tasks` sem `plan.md`, ou qualquer comando fora de uma branch de feature), **When** roda, **Then** o Maestro informa o que falta e qual comando rodar antes, sem chamar o modelo.
6. **Given** o projeto customizou um template ou um arquivo de comando, **When** o comando roda, **Then** é a versão do projeto que é usada, nunca a embutida.
7. **Given** um comando `/speckit.*`, **When** o modelo pede para executar algo que o modo de aprovação exige confirmar (comandos, escritas), **Then** as regras do modo valem como em qualquer outro turno; os passos determinísticos do próprio fluxo (criar branch, copiar template) são anunciados na transcrição e não pedem confirmação.
8. **Given** o modo não interativo, **When** o usuário roda `maestro -p "/speckit.tasks"`, **Then** o fluxo executa do mesmo jeito e a saída vai para stdout; perguntas ao usuário são respondidas com a suposição documentada pelo próprio comando.

---

### User Story 2 - Perguntas de clarificação como diálogos (Priority: P2)

Quando um comando do Spec Kit precisa decidir algo com o usuário (os marcadores de clarificação do `/speckit.specify`, as até cinco perguntas do `/speckit.clarify`, a pergunta "prosseguir com checklists incompletos?" do `/speckit.implement`), o modelo usa `ask_user`: cada pergunta aparece como um diálogo com as opções sugeridas (A, B, C) e "Outro…" para resposta própria, e as respostas voltam ao modelo, que as grava na spec.

**Why this priority**: Transforma o ponto mais frágil do fluxo (perguntas em texto corrido que o usuário precisa responder "Q1: A, Q2: B") na interação estruturada que o Maestro acabou de ganhar. Depende da US1.

**Independent Test**: Rodar `/speckit.clarify` numa spec propositalmente vaga e verificar que as perguntas aparecem como diálogos, que as respostas escolhidas são escritas na seção de clarificações da spec e que Esc encerra a rodada sem alterar o arquivo.

**Acceptance Scenarios**:

1. **Given** `/speckit.specify` produz marcadores de clarificação, **When** chega a hora de perguntar, **Then** cada marcador vira uma pergunta de múltipla escolha com as opções sugeridas e "Outro…", na ordem de prioridade do comando (no máximo três).
2. **Given** `/speckit.clarify` em execução, **When** o modelo formula uma pergunta, **Then** ela é exibida como diálogo; a resposta é registrada na spec antes da próxima pergunta, como o comando exige.
3. **Given** um diálogo de pergunta aberto, **When** o usuário aperta Esc, **Then** o comando encerra a rodada de perguntas, mantém o que já foi gravado e relata o que ficou em aberto.
4. **Given** o modo `-p`, **When** uma pergunta seria feita, **Then** o modelo recebe que não há usuário e segue com a suposição padrão, registrando-a na seção de suposições.

---

### User Story 3 - Iniciar o Spec Kit em um projeto novo (Priority: P2)

Em uma pasta sem `.specify/`, o usuário roda `/speckit.init` e o Maestro cria a estrutura completa a partir dos templates embutidos: `.specify/memory/constitution.md` (template), `.specify/templates/*`, os arquivos de comando em uma pasta do Maestro e um registro da versão do Spec Kit embutida. O usuário pode então começar por `/speckit.constitution`. Em um projeto já inicializado, `/speckit.init` só acrescenta o que falta e nunca sobrescreve arquivos modificados pelo usuário; com a opção de atualização, substitui apenas os arquivos idênticos à versão embutida anterior, listando o que foi e o que não foi atualizado.

**Why this priority**: Sem isso o Maestro ainda depende da CLI `specify` (Python/uv) para começar um projeto; com isso o fluxo é 100% nativo.

**Independent Test**: Em uma pasta vazia com `git init`, rodar `/speckit.init` e verificar a estrutura criada; rodar `/speckit.constitution` e depois `/speckit.specify` até a spec. Repetir `/speckit.init` e verificar que nada foi sobrescrito; editar um template, rodar a atualização e verificar que o arquivo editado foi preservado e listado.

**Acceptance Scenarios**:

1. **Given** uma pasta sem `.specify/`, **When** o usuário roda `/speckit.init`, **Then** a estrutura é criada com os templates e comandos embutidos, a versão do Spec Kit embutida fica registrada e a transcrição lista o que foi criado e o próximo passo sugerido.
2. **Given** um projeto já inicializado, **When** o usuário roda `/speckit.init`, **Then** só arquivos ausentes são criados; nenhum existente é alterado; a transcrição lista o que foi pulado.
3. **Given** um projeto inicializado com uma versão anterior, **When** o usuário roda a atualização, **Then** arquivos iguais à versão anterior embutida são substituídos, arquivos modificados pelo usuário são preservados e listados como "mantido (modificado)".
4. **Given** a pasta não é um repositório git, **When** o usuário roda `/speckit.init`, **Then** a estrutura é criada mesmo assim e o Maestro avisa que a criação de branches ficará indisponível até haver um repositório.
5. **Given** o Maestro é usado em `-p`, **When** `maestro -p "/speckit.init"`, **Then** a inicialização acontece e o resumo vai para stdout.

---

### User Story 4 - Contexto do projeto para o modelo (Priority: P3)

O Spec Kit mantém um arquivo de contexto do agente com as tecnologias e a estrutura do projeto (neste repositório, `CLAUDE.md`). Para que o fluxo seja útil no Maestro, o modelo precisa ler esse contexto: o Maestro passa a incluir no prompt de sistema o conteúdo do arquivo de contexto do projeto, e o `/speckit.plan` atualiza esse arquivo (criando‑o se não existir) além dos arquivos de outros agentes já presentes.

**Why this priority**: Fecha o ciclo: o que o plano registra, o modelo lê na próxima sessão. Vem por último porque o fluxo já funciona sem isso, só com menos contexto.

**Independent Test**: Criar `MAESTRO.md` com uma regra reconhecível ("responda sempre começando com OK:") e verificar que o modelo a segue; rodar `/speckit.plan` e verificar que `MAESTRO.md` ganhou a tecnologia nova e manteve a seção manual.

**Acceptance Scenarios**:

1. **Given** um `MAESTRO.md` na raiz do projeto, **When** a sessão inicia, **Then** seu conteúdo faz parte das instruções do modelo e o cabeçalho/`--debug` indicam que foi carregado.
2. **Given** não há `MAESTRO.md` mas há `CLAUDE.md`, **When** a sessão inicia, **Then** o Maestro usa `CLAUDE.md` como contexto e informa isso.
3. **Given** `/speckit.plan` roda, **When** chega o passo de atualizar o contexto, **Then** `MAESTRO.md` é criado ou atualizado com as tecnologias do plano, preservando a seção de adições manuais, e os arquivos de outros agentes existentes também são atualizados.
4. **Given** o arquivo de contexto passa de um tamanho razoável, **When** é carregado, **Then** o Maestro avisa o tamanho e inclui o conteúdo mesmo assim (o usuário decide cortar).

---

### Edge Cases

- **Comandos com o mesmo nome em mais de um lugar** (`.maestro/commands/` e `.claude/commands/`): a pasta do Maestro vence, depois a pasta da integração registrada em `.specify/`, depois os embutidos; `/help` indica a origem de cada comando.
- **Arquivo de comando que referencia um script** (`.specify/scripts/powershell/…`): o Maestro reconhece as referências aos scripts padrão do Spec Kit e executa o passo nativo equivalente, devolvendo ao modelo o mesmo JSON que o script devolveria; scripts desconhecidos são executados como comandos normais, sujeitos ao modo de aprovação.
- **Número de feature em conflito** (branch remota `007-x` e pasta `specs/007-y`): o próximo número é o maior encontrado em qualquer fonte mais um, como o Spec Kit faz.
- **Nome curto longo ou com caracteres inválidos**: normalizado para minúsculas, hifens e no máximo quatro palavras, com o limite de tamanho de nome de branch do GitHub.
- **Working tree com alterações não commitadas ao criar a branch**: a branch é criada e as alterações a acompanham (comportamento do git); o Maestro avisa que há alterações pendentes.
- **Fora de uma branch de feature** (`main`): comandos que dependem de uma feature explicam como escolher uma (voltar à branch) ou rodar `/speckit.specify`; `/speckit.specify`, `/speckit.constitution` e `/speckit.init` funcionam em qualquer branch.
- **Projeto sem git**: `/speckit.specify` cria a pasta `specs/NNN-…` e avisa que não criou branch; os demais comandos localizam a feature pela pasta mais recente.
- **Extensões do Spec Kit** (`.specify/extensions.yml` com hooks): os comandos já descrevem como anunciar hooks; o Maestro só garante que o arquivo é legível. Instalar ou gerenciar extensões fica fora de escopo.
- **`/speckit.taskstoissues`**: exige acesso ao GitHub; sem servidor MCP no Maestro, o comando usa a CLI `gh` se estiver instalada (via comando, com confirmação conforme o modo) e, se não estiver, explica como instalar.
- **Template embutido desatualizado em relação ao upstream**: a versão embutida é fixada e documentada; a atualização do Maestro traz a nova.
- **Comando interrompido no meio** (Esc durante `/speckit.plan`): artefatos já escritos ficam; a transcrição diz onde parou; rodar o comando de novo continua do que existe.

## Requirements *(mandatory)*

### Functional Requirements

**Descoberta e execução de comandos**

- **FR-001**: O sistema MUST descobrir arquivos de comando do Spec Kit (markdown com frontmatter `description` e corpo com `$ARGUMENTS`) nesta ordem de precedência: `.maestro/commands/`, a pasta da integração registrada em `.specify/integration.json` (por exemplo `.claude/commands/`), e os comandos embutidos no Maestro; e MUST oferecê‑los como `/speckit.<nome>` no prompt, no autocompletar e em `/help`, com a descrição e a origem.
- **FR-002**: Ao executar um comando, o sistema MUST substituir `$ARGUMENTS` pelo texto após o nome, incluir o corpo do comando como instrução do turno e manter a conversa atual como contexto; a transcrição MUST mostrar qual comando foi invocado.
- **FR-003**: O sistema MUST executar nativamente, sem iniciar PowerShell, bash ou Python, os passos determinísticos do Spec Kit referenciados pelos comandos: criar nova feature (numerar, nomear, criar branch e pasta, copiar o template da spec), configurar o plano (copiar o template), verificar pré‑requisitos (branch de feature, artefatos disponíveis, caminhos absolutos) e atualizar o contexto do agente; o resultado devolvido ao modelo MUST ter o mesmo formato (JSON com `BRANCH_NAME`, `SPEC_FILE`, `FEATURE_DIR`, `AVAILABLE_DOCS` etc.) que os scripts oficiais produzem, para que os arquivos de comando funcionem sem alteração.
- **FR-004**: A numeração de features MUST considerar branches locais e remotas e as pastas `specs/NNN-*`, e usar o maior número mais um, com três dígitos; nomes curtos MUST ser normalizados (minúsculas, hifens, até quatro palavras significativas) e respeitar o limite de tamanho de nome de branch do GitHub.
- **FR-005**: Quando um comando exige artefatos ausentes (sem branch de feature, sem `spec.md`, sem `plan.md`, sem `tasks.md`), o sistema MUST informar o que falta e o comando anterior a rodar, sem chamar o modelo.
- **FR-006**: Passos determinísticos do fluxo (criar branch e pasta, copiar template, atualizar contexto) MUST ser anunciados na transcrição e MUST NOT exigir confirmação; qualquer outra escrita ou comando pedido pelo modelo durante o fluxo MUST seguir o modo de aprovação em vigor.
- **FR-007**: Todos os comandos MUST funcionar no modo `-p`, com a saída em stdout e os avisos em stderr.
- **FR-008**: Os comandos MUST funcionar com qualquer provedor configurado; o modelo usado é o ativo da sessão.

**Perguntas**

- **FR-009**: Os comandos embutidos MUST orientar o modelo a usar `ask_user` para toda pergunta ao usuário (clarificações, confirmação de prosseguir com checklists incompletos), com as opções sugeridas pelo comando e "Outro…"; respostas MUST ser gravadas no artefato antes da próxima pergunta, conforme cada comando determina.
- **FR-010**: Esc em uma pergunta MUST encerrar a rodada de perguntas sem descartar o que já foi gravado; o comando MUST relatar os pontos em aberto.

**Inicialização e atualização**

- **FR-011**: `/speckit.init` MUST criar `.specify/memory/constitution.md` (template), `.specify/templates/` (spec, plan, tasks, checklist, constitution, agent-file), os arquivos de comando em `.maestro/commands/`, um registro da versão do Spec Kit embutida e das opções escolhidas, e MUST listar o que criou; em projeto já inicializado MUST criar só o que falta e MUST NOT alterar arquivos existentes.
- **FR-012**: `/speckit.init --upgrade` MUST substituir apenas arquivos idênticos à versão embutida anterior, preservar e listar os modificados pelo usuário, e atualizar o registro de versão.
- **FR-013**: O Maestro MUST embutir os templates e comandos de uma versão fixada do Spec Kit, com atribuição (MIT) em `THIRD_PARTY_NOTICES.md` e no README, e MUST documentar a versão embutida em `/speckit.init` e em `--version`.
- **FR-014**: `/speckit.init` MUST funcionar sem repositório git, avisando que a criação de branches ficará indisponível; `/speckit.specify` sem git MUST criar a pasta da feature e avisar que não criou branch.

**Contexto do projeto**

- **FR-015**: O sistema MUST incluir no prompt de sistema o conteúdo de `MAESTRO.md` na raiz do projeto, ou de `CLAUDE.md` quando `MAESTRO.md` não existir, informando no `--debug` qual arquivo e tamanho foram carregados; acima de um tamanho razoável MUST avisar o usuário.
- **FR-016**: O passo nativo de atualização de contexto MUST atualizar `MAESTRO.md` (criando‑o do template de arquivo de agente se não existir) e os arquivos de contexto de outros agentes já presentes no projeto, acrescentando só tecnologias novas do plano, mantendo as três mais recentes em "Recent Changes" e preservando a seção entre os marcadores de adições manuais, como o script oficial faz.

**Compatibilidade**

- **FR-017**: Um projeto inicializado pela CLI `specify` (versões 0.4.x e 1.x) MUST funcionar sem alteração: templates, comandos e `.specify/integration.json` do projeto MUST ser respeitados; o repositório do Maestro MUST ser usado como caso de teste.
- **FR-018**: `/speckit.taskstoissues` MUST usar a CLI `gh` quando disponível, criando issues apenas no repositório do remoto `origin`, e MUST explicar como instalar a CLI quando ausente.

### Key Entities *(include if feature involves data)*

- **Comando Spec Kit**: nome (`speckit.<x>`), descrição, corpo com `$ARGUMENTS`, origem (projeto/integração/embutido), passos determinísticos referenciados.
- **Feature**: número de três dígitos, nome curto, branch, pasta `specs/NNN-nome/`, artefatos (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/`, `tasks.md`, `checklists/`), estado dos pré‑requisitos.
- **Passo determinístico**: tipo (nova feature, configurar plano, verificar pré‑requisitos, atualizar contexto), parâmetros, resultado em JSON compatível com os scripts oficiais, mensagens exibidas.
- **Instalação do Spec Kit no projeto**: pasta `.specify/`, templates, comandos, versão embutida registrada, opções (`branch_numbering`, integração), arquivos modificados pelo usuário.
- **Arquivo de contexto do projeto**: caminho (`MAESTRO.md`, `CLAUDE.md`, outros agentes), seção de tecnologias, "Recent Changes", seção de adições manuais.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em uma máquina sem Claude Code, sem a CLI `specify` e sem Python, um usuário conclui o ciclo `/speckit.init` → `/speckit.constitution` → `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement` dentro do Maestro, com o Qwen ou com o Claude, produzindo os mesmos artefatos que o fluxo no Claude Code produz.
- **SC-002**: Neste repositório, os nove comandos `/speckit.*` existentes funcionam sem nenhuma alteração nos arquivos de comando ou templates, e nenhum processo de shell é iniciado pelo Maestro para os passos de numeração, branch, pré‑requisitos, cópia de template e contexto.
- **SC-003**: 100% das perguntas de clarificação dos comandos embutidos aparecem como diálogos de múltipla escolha, e cada resposta é gravada no artefato correspondente.
- **SC-004**: `/speckit.init` em pasta vazia leva menos de 2 segundos e cria uma estrutura que o `specify check` da CLI oficial reconhece como válida; repetido, não altera nenhum arquivo.
- **SC-005**: Um comando rodado fora dos pré‑requisitos retorna a orientação em menos de 1 segundo, sem consumir tokens.
- **SC-006**: O mesmo fluxo roda em `-p` e gera os artefatos, para uso em scripts e CI.

## Assumptions

- O escopo são os nove comandos atuais do Spec Kit (`constitution`, `specify`, `clarify`, `plan`, `tasks`, `analyze`, `checklist`, `implement`, `taskstoissues`) mais os nativos `/speckit.init` e um `/speckit.status` (feature atual e artefatos existentes). Comandos de extensões (`bug.*` etc.), presets, bundles, o servidor MCP e o gerenciamento de extensões da CLI `specify` ficam fora de escopo; arquivos de comando de extensões já instalados no projeto são descobertos e executados como qualquer outro.
- A versão embutida segue o último release estável do Spec Kit na data do planejamento (v1.2.3, 2026-10-22, MIT); a referência exata é fixada na fase de planejamento e registrada em `THIRD_PARTY_NOTICES.md`.
- A pasta nativa de comandos do Maestro é `.maestro/commands/`; projetos com `.claude/commands/` continuam funcionando por meio da precedência de FR-001. `/speckit.init` grava em `.maestro/commands/` e registra `maestro` como integração em `.specify/integration.json`, preservando a integração anterior se houver.
- Os passos determinísticos reproduzem o comportamento dos scripts oficiais (`create-new-feature`, `setup-plan`, `check-prerequisites`, `update-agent-context`) na versão embutida, inclusive o formato JSON e o modo de numeração (`sequential` ou `timestamp`) lido de `.specify/init-options.json`.
- A escolha do modelo para um comando usa o modelo ativo da sessão; rotear comandos para modelos específicos é assunto da feature de rotas, prevista a seguir.
- O arquivo de contexto do Maestro é `MAESTRO.md` na raiz do projeto, com `CLAUDE.md` como alternativa de leitura quando ele não existe; o formato é o do template de arquivo de agente do Spec Kit.
- Criar a branch da feature é um passo do fluxo e não pede confirmação, como no Spec Kit original; a transcrição sempre o anuncia.
- Esta feature reutiliza o sistema de comandos `/`, a ferramenta `ask_user`, os modos de aprovação e o `-p` existentes; não introduz dependências novas.
