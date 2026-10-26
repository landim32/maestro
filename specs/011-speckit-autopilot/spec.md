# Feature Specification: Modo autopiloto (Spec Kit de ponta a ponta, sem interação)

**Feature Branch**: `011-speckit-autopilot`
**Created**: 2026-10-25
**Status**: Draft
**Input**: User description: "Modo autopiloto no Maestro: executar todo o desenvolvimento de forma autônoma a partir de histórias de usuário, percorrendo todos os passos do Spec Kit sem interação, tomando as decisões automaticamente e registrando-as. Entrada /autopilot <arquivo> (e -p --autopilot); pipeline specify → clarify → plan → tasks → analyze → implement → verificação, cada passo em turno novo; decisor automático com justificativa; registro em decisions.md e jsonl; portões entre passos; modo auto (não yolo), commit por passo, push/PR só com opção explícita; limites por história; retomada; seção autopilot no settings.json; status na UI e progresso no stderr do -p."

## Contexto

Hoje o usuário roda o Spec Kit no Maestro passo a passo: `/speckit.specify`, depois `/speckit.clarify`, depois `/speckit.plan` e assim por diante. Ele responde às perguntas do clarify, confirma ações, digita "continue" quando o implement para no meio e verifica os testes por conta própria. Cada passo depende de alguém olhando a tela.

O **modo autopiloto** recebe uma lista de histórias de usuário e conduz cada uma por todos os passos do Spec Kit sem nenhuma interação. Quando um passo faria uma pergunta, um **decisor** automático escolhe a resposta, justifica e **registra a decisão**, para revisão posterior. Entre um passo e outro há **portões** objetivos (artefato criado, tarefas concluídas, testes passando), e a execução para com um relatório quando um portão falha, em vez de seguir às cegas. Cada passo concluído vira um commit, então todo o trabalho é reversível. Nada sai da máquina (push, PR, merge) sem uma opção explícita.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Uma história de usuário vira uma feature pronta, sem interação (Priority: P1)

Como usuário, escrevo uma história num arquivo, rodo `/autopilot historias.md` e saio. O Maestro cria a branch da feature e executa specify, clarify, plan, tasks, analyze e implement. Depois roda a verificação do projeto (testes, lint, build). No fim, encontro a feature implementada na branch, um commit por passo e um relatório do que foi feito.

**Why this priority**: É o objetivo da feature. Sozinha, já tira o usuário do papel de operador do fluxo para uma história.

**Independent Test**: Com um provedor simulado roteirizado que responde a cada passo criando os artefatos esperados, rodar o autopiloto numa história e verificar que os seis passos rodaram em ordem, cada um num turno novo, que existe um commit por passo, que a verificação rodou e que o relatório final lista passos, duração e resultado.

**Acceptance Scenarios**:

1. **Given** um repositório git limpo com o Spec Kit inicializado e um arquivo com uma história, **When** o usuário roda `/autopilot historias.md`, **Then** o Maestro cria a branch `NNN-nome` da história e executa, nesta ordem, specify, clarify, plan, tasks, analyze, implement e a verificação, sem pedir nada ao usuário.
2. **Given** um passo em execução, **When** ele começa, **Then** o turno parte de uma conversa limpa, recebe só o comando do passo e o que estiver nos artefatos em disco, e usa a rota configurada para aquele passo.
3. **Given** um passo concluído com sucesso, **When** o portão dele passa, **Then** as mudanças do passo são commitadas na branch da feature com uma mensagem que identifica a história e o passo.
4. **Given** a verificação passou, **When** a execução termina, **Then** o Maestro mostra um relatório com cada história, cada passo (resultado, duração, tokens), as decisões tomadas e onde encontrar o registro completo.
5. **Given** o repositório tem alterações não commitadas, **When** o usuário tenta iniciar o autopiloto, **Then** o Maestro recusa e explica que a árvore precisa estar limpa.
6. **Given** o autopiloto em execução na sessão interativa, **When** o usuário aperta Esc, **Then** o passo atual é cancelado, nenhum commit parcial é feito e o estado fica salvo para retomar.

---

### User Story 2 - Decisões automáticas, justificadas e registradas (Priority: P1)

Como usuário, quero que as perguntas que os passos fariam a mim (as clarificações do specify e do clarify, as confirmações do implement e as perguntas em texto que o modelo deixa no fim de um turno) sejam respondidas automaticamente com critério, e que cada resposta fique registrada com o motivo, para eu revisar depois e corrigir se discordar.

**Why this priority**: Sem um decisor, o fluxo trava na primeira pergunta. Sem registro, o usuário perde o controle do que foi decidido em seu nome. Junto com a US1, forma o MVP.

**Independent Test**: Com um provedor simulado que faz uma pergunta de múltipla escolha no clarify e termina o implement com "Do you want to proceed? (yes/no)", verificar que as duas foram respondidas sem interação, que a escolha seguiu a política (opção recomendada; senão a mais conservadora) e que as duas aparecem no registro legível e no estruturado, com pergunta, opções, escolha e justificativa.

**Acceptance Scenarios**:

1. **Given** um passo que faz uma pergunta de múltipla escolha com uma opção marcada como recomendada, **When** o autopiloto está ativo, **Then** o decisor escolhe a recomendada e o passo continua sem interação.
2. **Given** uma pergunta sem opção recomendada, **When** o decisor responde, **Then** ele escolhe a opção que menos amplia escopo e risco, e escreve uma justificativa curta.
3. **Given** um turno que termina com uma pergunta em texto livre ao usuário, **When** o portão do passo avalia o turno, **Then** o decisor gera uma resposta, que é enviada como próximo turno do mesmo passo, e a pergunta e a resposta são registradas.
4. **Given** qualquer decisão tomada, **When** ela é registrada, **Then** aparece em `specs/NNN/decisions.md`, em linguagem legível, com passo, pergunta, opções, escolha, justificativa e modelo, e numa linha do registro estruturado da execução.
5. **Given** o clarify, **When** o decisor responde às clarificações, **Then** as respostas também são gravadas na spec pelo próprio passo, como acontece hoje com respostas humanas.
6. **Given** o decisor falha (erro do provedor ou resposta inválida), **When** isso acontece, **Then** o autopiloto tenta mais uma vez e, se falhar de novo, para a história com o motivo no relatório, sem inventar uma resposta.

---

### User Story 3 - Portões entre passos e correções limitadas (Priority: P1)

Como usuário, quero que cada passo só avance quando o resultado for verificável, que problemas sejam corrigidos automaticamente dentro de um limite e que, se não der, a execução pare e explique, em vez de seguir com uma base quebrada.

**Why this priority**: É o que torna a autonomia confiável. Sem portões, um passo ruim contamina todos os seguintes.

**Independent Test**: Simular cada falha separadamente (passo sem artefato, analyze com problema CRITICAL, implement que para no meio, testes falhando) e verificar a reação descrita para cada uma: avançar, corrigir dentro do limite ou parar com relatório.

**Acceptance Scenarios**:

1. **Given** um passo que deveria criar ou atualizar um artefato (spec, plan, tasks), **When** o turno termina sem ele, **Then** o portão falha e a história para com o motivo.
2. **Given** o analyze reporta pelo menos um problema CRITICAL, **When** o portão avalia, **Then** o autopiloto faz uma rodada de correção nos artefatos e roda o analyze de novo. Se ainda houver CRITICAL, a história para.
3. **Given** o implement terminou o turno com tarefas ainda abertas no `tasks.md`, **When** o portão avalia, **Then** o autopiloto envia "continue" no mesmo passo. Ele repete enquanto houver progresso (mais tarefas marcadas) e para quando todas estiverem concluídas ou quando uma rodada não marcar nenhuma tarefa nova.
4. **Given** o comando de verificação configurado falha, **When** o portão avalia, **Then** o autopiloto dá ao modelo a saída da falha e pede a correção, até o número máximo de tentativas configurado. Se continuar falhando, a história para.
5. **Given** o preflight de um comando do Spec Kit bloqueia o passo, **When** isso acontece, **Then** a história para com a mensagem do preflight.
6. **Given** uma história parou num portão, **When** a execução termina, **Then** o relatório diz qual passo, qual portão, a última saída relevante e o comando para retomar.

---

### User Story 4 - Várias histórias, limites e retomada (Priority: P2)

Como usuário, quero colocar várias histórias no arquivo e deixar o autopiloto trabalhar nelas em sequência, com tetos de turnos, tempo e tokens por história. Se algo interromper a execução (Esc, queda de energia, limite do provedor), quero retomar do último passo concluído, sem refazer o que já foi feito.

**Why this priority**: Multiplica o valor da US1, mas depende dela. A retomada protege execuções longas.

**Independent Test**: Rodar com duas histórias, interromper no meio do plan da segunda, retomar e verificar que a primeira não é refeita, que a segunda continua do plan e que os tetos param uma história que os excede.

**Acceptance Scenarios**:

1. **Given** um arquivo com três histórias, **When** o autopiloto roda, **Then** elas são processadas na ordem do arquivo, cada uma com a sua feature e a sua branch.
2. **Given** a segunda história depende da primeira, **When** a segunda começa, **Then** a branch dela parte do resultado final da primeira.
3. **Given** uma história excede o teto de turnos, de tempo ou de tokens, **When** isso acontece, **Then** ela para com o motivo e a execução também para, porque as histórias seguintes partiriam de uma base incompleta.
4. **Given** uma execução interrompida, **When** o usuário roda `/autopilot --resume` (ou o mesmo comando de novo), **Then** o autopiloto lê o estado salvo, confere a branch e os artefatos e continua do primeiro passo não concluído.
5. **Given** o estado salvo não confere com o repositório (branch apagada ou commits reescritos), **When** o usuário tenta retomar, **Then** o autopiloto recusa e explica o que não confere.
6. **Given** o limite de uso do provedor é atingido no meio de um passo, **When** o erro chega, **Then** o passo é marcado como interrompido (não como falho) e pode ser retomado depois.

---

### User Story 5 - Execução sem terminal e ações externas sob opção (Priority: P3)

Como usuário, quero rodar o autopiloto em scripts e CI com `maestro -p --autopilot historias.md`, com progresso no stderr e um código de saída que diga se tudo passou. Quero também, se eu ligar a opção, que ao fim de cada história o Maestro faça push da branch e abra o PR.

**Why this priority**: Amplia o uso, mas o núcleo funciona sem isso.

**Independent Test**: Rodar em `-p` com um provedor simulado e verificar o progresso no stderr, o relatório final e os códigos de saída para sucesso, história parada e erro de configuração. Com a opção de push/PR ligada e um git e um `gh` simulados, verificar as chamadas na ordem certa. Com a opção desligada, verificar que nenhuma acontece.

**Acceptance Scenarios**:

1. **Given** `maestro -p --autopilot historias.md`, **When** a execução corre, **Then** cada passo iniciado e concluído é escrito no stderr, o relatório final vai para o stdout e o código de saída é 0 (tudo passou), 1 (alguma história parou) ou 2 (entrada ou configuração inválida).
2. **Given** a opção de push/PR desligada (padrão), **When** uma história termina, **Then** nada é enviado ao remoto.
3. **Given** a opção ligada, **When** uma história passa em todos os portões, **Then** a branch é enviada e um PR é aberto para a base configurada, e o link entra no relatório. Merge nunca é feito automaticamente, a menos que uma opção separada o permita.
4. **Given** a sessão interativa, **When** o autopiloto roda, **Then** a barra de status mostra a história (n de N) e o passo atual, e a transcrição mostra cada passo como nos turnos normais.

---

### Edge Cases

- **Arquivo vazio ou sem histórias reconhecíveis**: o autopiloto recusa e mostra o formato esperado.
- **Spec Kit não inicializado no projeto**: o autopiloto recusa e sugere `/speckit.init`.
- **Projeto que não é repositório git**: o autopiloto recusa, porque commits por passo e retomada dependem do git.
- **Nenhum comando de verificação configurado**: o autopiloto avisa no início e o portão de verificação passa sem rodar nada, registrado como "não verificado" no relatório.
- **Comando destrutivo pedido pelo modelo**: continua bloqueado, como no modo `auto`. A recusa volta ao modelo, que precisa seguir de outro jeito.
- **Pergunta do decisor sobre algo fora do escopo da história**: o decisor prefere sempre a opção que não amplia o escopo.
- **O modelo tenta editar o registro de decisões ou o estado do autopiloto**: esses arquivos são escritos só pelo autopiloto. Alterações feitas pelo modelo são descartadas antes do commit do passo.
- **Duas execuções simultâneas no mesmo projeto**: a segunda recusa iniciar enquanto o estado indicar uma execução ativa.
- **Rota de um passo apontando para um provedor indisponível**: vale a cadeia de fallback das rotas, com o aviso registrado no relatório.
- **História muito grande**: o specify divide em user stories como hoje. Os tetos por história evitam execuções sem fim.

## Requirements *(mandatory)*

### Functional Requirements

**Entrada e execução**

- **FR-001**: O sistema MUST oferecer o comando `/autopilot <arquivo>` na sessão interativa e `maestro -p --autopilot <arquivo>` sem terminal.
- **FR-002**: O sistema MUST reconhecer histórias num arquivo Markdown, em que cada título de segundo nível (`##`) inicia uma história e o texto até o próximo título é a descrição dela. Um arquivo sem títulos de segundo nível é tratado como uma única história.
- **FR-003**: O sistema MUST recusar o início quando o projeto não for um repositório git, a árvore tiver alterações não commitadas, o Spec Kit não estiver inicializado ou já houver uma execução ativa.
- **FR-004**: Para cada história, o sistema MUST executar, em ordem, specify, clarify, plan, tasks, analyze, implement e verificação. Cada passo do Spec Kit MUST rodar com o histórico da conversa limpo e usar a rota configurada para o comando.
- **FR-005**: O sistema MUST usar o modo de aprovação `auto` durante a execução: edições e comandos comuns rodam, comandos destrutivos continuam exigindo confirmação e, portanto, são recusados. O modo `yolo` MUST NOT ser usado pelo autopiloto.

**Decisões**

- **FR-006**: Durante a execução, toda pergunta feita por `ask_user` MUST ser respondida por um decisor automático que usa a rota `autopilot.decide` (padrão: segue `chat`).
- **FR-007**: O decisor MUST escolher a opção marcada como recomendada quando houver uma. Caso contrário, MUST escolher a opção que menos amplia escopo e risco. Em todos os casos MUST fornecer uma justificativa de no máximo três frases.
- **FR-008**: Ao fim de cada turno, o sistema MUST detectar quando o modelo deixou uma pergunta ao usuário (por exemplo, pedido de confirmação para prosseguir) e MUST respondê-la pelo decisor como próximo turno do mesmo passo, contando para os tetos.
- **FR-009**: Cada decisão MUST ser registrada em `specs/NNN-nome/decisions.md` (legível) e no registro estruturado `.maestro/autopilot/<execução>.jsonl`, com data, história, passo, pergunta, opções, escolha, justificativa, provedor e modelo.
- **FR-010**: Se o decisor falhar duas vezes seguidas na mesma pergunta, a história MUST parar com o motivo, sem resposta inventada.

**Portões**

- **FR-011**: Cada passo MUST ter um portão de saída: specify, plan e tasks exigem o artefato correspondente criado ou alterado; clarify exige a spec presente; analyze exige ausência de problemas CRITICAL; implement exige todas as tarefas do `tasks.md` concluídas; verificação exige sucesso do comando configurado.
- **FR-012**: No analyze com problema CRITICAL, o sistema MUST fazer no máximo uma rodada de correção seguida de um novo analyze.
- **FR-013**: No implement, o sistema MUST repetir o turno com "continue" enquanto cada rodada marcar pelo menos uma tarefa nova, e parar quando todas estiverem concluídas ou quando uma rodada não tiver progresso.
- **FR-014**: Na verificação com falha, o sistema MUST pedir a correção ao modelo, informando a saída da falha, até `autopilot.verify.maxAttempts` vezes (padrão 3).
- **FR-015**: Um portão que falha MUST parar a história e a execução, com o passo, o portão, a última saída relevante e o comando de retomada no relatório.

**Commits, ações externas e limites**

- **FR-016**: Cada passo concluído MUST gerar um commit na branch da história, com uma mensagem que identifica a história e o passo, no prefixo de commit configurado (padrão `fix:`).
- **FR-017**: A branch de cada história MUST partir do resultado final da história anterior. A primeira parte da branch em que o autopiloto foi iniciado.
- **FR-018**: Push e abertura de PR MUST acontecer só com `autopilot.push` ligado. Merge MUST acontecer só com `autopilot.merge` ligado, que exige `autopilot.push`.
- **FR-019**: O sistema MUST aplicar, por história, tetos de turnos (padrão 60), tempo (padrão 120 minutos) e tokens (padrão: sem teto), além de `tools.maxToolIterations` por turno.
- **FR-020**: Os arquivos de decisões e de estado MUST ser escritos só pelo autopiloto. Mudanças feitas neles por turnos do modelo MUST ser descartadas antes do commit.

**Estado, retomada e relatório**

- **FR-021**: O estado da execução (histórias, passo atual, branch, último commit, tentativas) MUST ser salvo em `.specify/autopilot.json` a cada transição.
- **FR-022**: `/autopilot --resume` (e rodar o mesmo comando com uma execução interrompida) MUST continuar do primeiro passo não concluído, depois de conferir que a branch e o último commit registrados existem.
- **FR-023**: Um limite de uso do provedor ou um cancelamento MUST marcar o passo como interrompido, retomável, e não como falho.
- **FR-024**: O sistema MUST produzir um relatório final com cada história, cada passo (resultado, duração, tokens, tentativas), contagem de decisões, links de PR (quando houver) e o caminho dos registros.

**Interface**

- **FR-025**: Na sessão interativa, a barra de status MUST mostrar `autopiloto · história n/N · <passo>` durante a execução, e Esc MUST cancelar o passo atual com segurança.
- **FR-026**: No `-p`, o progresso MUST ir para o stderr, o relatório para o stdout, com saída 0 (sucesso), 1 (história parada) ou 2 (entrada ou configuração inválida).
- **FR-027**: Os logs de depuração MUST registrar só eventos e contagens (passo, portão, resultado, tentativas). Conteúdo das histórias, perguntas e respostas fica fora deles, e o registro de decisões é o lugar desse conteúdo.

### Key Entities

- **Execução**: identificador, arquivo de entrada, branch base, histórias, início, estado (ativa, interrompida, concluída, parada).
- **História**: título, descrição, número e branch da feature, passo atual, passos concluídos com commit, tentativas, consumo (turnos, tempo, tokens).
- **Passo**: nome, resultado (ok, falhou, interrompido), duração, tokens, rodadas ("continue", correções), commit.
- **Decisão**: data, história, passo, pergunta, opções, escolha, justificativa, provedor e modelo.
- **Configuração do autopiloto**: comando de verificação, tentativas de verificação, tetos por história, prefixo de commit, push, base do PR, merge.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma história de tamanho típico (uma a três user stories) vai do arquivo de entrada até a feature implementada e verificada sem nenhuma interação humana.
- **SC-002**: 100% das perguntas feitas durante a execução aparecem no registro de decisões, com escolha e justificativa.
- **SC-003**: Nenhuma execução avança para o passo seguinte quando o portão do passo atual falhou.
- **SC-004**: Depois de uma interrupção, a retomada não repete nenhum passo já concluído.
- **SC-005**: Qualquer passo pode ser desfeito voltando um commit, porque cada passo concluído corresponde a exatamente um commit.
- **SC-006**: Com as opções padrão, nenhuma ação chega ao remoto (push, PR, merge).
- **SC-007**: Nenhum comando destrutivo é executado durante a execução.

## Assumptions

- **Formato do arquivo de histórias**: Markdown, com cada título `##` iniciando uma história. É o formato mais simples de escrever à mão e de gerar. Outros formatos (issues do GitHub, JSON) ficam para depois.
- **Branches empilhadas**: as histórias de um mesmo arquivo costumam depender umas das outras, então cada branch parte da anterior. Se uma história parar, a execução inteira para, porque as seguintes partiriam de uma base incompleta.
- **Decisor = modelo**: o decisor é uma chamada ao modelo da rota `autopilot.decide`, com a pergunta, as opções, a história e os artefatos relevantes. A política de escolha (recomendada; senão a mais conservadora) vai no próprio pedido e é conferida no resultado: a escolha tem que ser uma das opções.
- **Detecção de pergunta em texto**: um turno que termina com uma pergunta dirigida ao usuário é reconhecido por padrões simples (por exemplo, "(yes/no)", "Deseja", "Do you want") e, na dúvida, pelo próprio decisor.
- **Verificação**: o comando vem de `autopilot.verify.command`. Sem configuração, o autopiloto tenta, nesta ordem, os scripts `test`, `lint` e `build` do `package.json`, se existirem.
- **Prefixo de commit**: padrão `fix:`, por coerência com a convenção do repositório. Configurável.
- **Checklists do Spec Kit**: o passo `/speckit.checklist` fica fora da sequência padrão nesta versão, e o implement trata os checklists que já existirem como hoje.
- **Merge automático**: desligado por padrão e só disponível com push ligado. Merge é uma ação externa e irreversível no remoto.
