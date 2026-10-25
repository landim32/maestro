# Feature Specification: Modos de Aprovação (TAB), Ferramenta `ask_user` e Créditos ao qwen-code

**Feature Branch**: `005-approval-modes-ask-user`  
**Created**: 2026-10-25  
**Status**: Draft  
**Input**: User description: "Melhorias: crie modos de desenvolvimento diferentes, como o qwen, posso mudar com o TAB: pedir permissão, aceitar edições automaticamente, modo automático, modo YOLO; crie uma ferramenta ask_user — quando o modelo precisa perguntar algo ao usuário ele faz uma pergunta de múltipla escolha, pode copiar do qwen-code (iremos colocar a referência); adicione onde for preciso os direitos do qwen-code pela cópia de parte de seu código; essa é uma ferramenta open-source e sempre será."

## Visão Geral

Hoje o Maestro tem um único comportamento diante de ações do modelo: toda escrita de arquivo e todo comando pedem aprovação (`y`/`n`), uma a uma, e no modo não interativo são todas recusadas. Para tarefas longas isso vira uma sequência de confirmações repetitivas; para tarefas delicadas, não há como tornar o Maestro ainda mais cauteloso. Além disso, quando o modelo precisa de uma decisão do usuário (qual abordagem seguir, qual arquivo é o certo, confirmar um entendimento), só consegue perguntar em texto corrido e esperar a próxima mensagem, sem estruturar as opções.

Esta feature traz três conjuntos de melhorias, seguindo o que o qwen-code oferece:

1. **Modos de aprovação alternáveis com TAB**: quatro níveis de autonomia — **Pedir permissão** (padrão), **Aceitar edições**, **Automático** e **YOLO** — que decidem quais ações do modelo precisam do `y` do usuário. O modo atual fica sempre visível na barra de status e muda com uma tecla.
2. **Ferramenta `ask_user`**: o modelo passa a poder fazer perguntas de múltipla escolha ao usuário durante um turno, com opções descritas e a possibilidade de resposta livre; a resposta volta para o modelo, que continua o trabalho. Independe do modo de aprovação: uma pergunta sempre é feita.
3. **Créditos e compromisso open-source**: todo trecho copiado ou adaptado do qwen-code recebe a atribuição exigida por sua licença (no arquivo, em um aviso de terceiros e no README), e o projeto declara formalmente que é e permanecerá open-source.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Alternar o modo de aprovação com TAB (Priority: P1)

Durante uma sessão, o usuário aperta TAB com o foco no prompt e o Maestro avança para o próximo modo de aprovação, em ciclo: Pedir permissão → Aceitar edições → Automático → YOLO → Pedir permissão. A barra de status mostra o modo em vigor o tempo todo e, logo após a troca, um aviso curto confirma o novo modo. A partir daí, as ações do modelo seguem a regra do modo escolhido: no padrão tudo que escreve ou executa pede `y`/`n`; em **Aceitar edições** as escritas de arquivo dentro da pasta de trabalho são aplicadas sem perguntar e os comandos continuam pedindo; em **Automático** escritas e comandos são executados sem perguntar, exceto comandos reconhecidos como destrutivos (apagar recursivamente, sobrescrever histórico remoto, formatar, desligar, etc.), que ainda pedem; em **YOLO** nada pede confirmação. A troca vale só para a sessão atual; ao abrir o Maestro de novo, volta o modo configurado (padrão: Pedir permissão).

**Why this priority**: É o pedido central e o de maior efeito no uso diário: hoje toda tarefa com várias edições exige uma confirmação por arquivo, e não há como relaxar ou endurecer isso sem mexer em código.

**Independent Test**: Abrir o Maestro, apertar TAB quatro vezes observando a barra de status percorrer os quatro modos e voltar ao inicial; em cada modo, pedir ao modelo (ou simular) uma escrita de arquivo e um comando e verificar quais pedem confirmação conforme a tabela de FR-003.

**Acceptance Scenarios**:

1. **Given** o prompt ativo e o modo "Pedir permissão", **When** o usuário aperta TAB, **Then** o modo passa a "Aceitar edições", a barra de status reflete a mudança no mesmo instante e um aviso breve nomeia o novo modo.
2. **Given** o modo "YOLO", **When** o usuário aperta TAB, **Then** o modo volta a "Pedir permissão" (ciclo fechado).
3. **Given** o modo "Aceitar edições", **When** o modelo pede para escrever um arquivo dentro da pasta de trabalho, **Then** a escrita é aplicada sem diálogo de confirmação e aparece na transcrição como ação executada, com o resumo do que mudou.
4. **Given** o modo "Aceitar edições", **When** o modelo pede para executar um comando, **Then** o diálogo de confirmação aparece como hoje.
5. **Given** o modo "Automático", **When** o modelo pede um comando comum (por exemplo, rodar os testes), **Then** ele é executado sem perguntar; **When** o modelo pede um comando reconhecido como destrutivo, **Then** a confirmação é exigida e o diálogo indica por que foi exigida.
6. **Given** o modo "YOLO", **When** o modelo pede qualquer escrita ou comando, **Then** é executado sem perguntar, e a barra de status deixa evidente que o modo é o menos protegido.
7. **Given** um diálogo de confirmação aberto (ação pendente), **When** o usuário aperta TAB, **Then** o modo muda mas a ação pendente continua aguardando a resposta explícita `y`/`n`; o novo modo vale para as próximas ações.
8. **Given** um diálogo `/auth` ou `/model` aberto, **When** o usuário aperta TAB, **Then** o modo de aprovação não muda (a tecla pertence ao diálogo).
9. **Given** o usuário iniciou o Maestro com um argumento ou configuração escolhendo o modo inicial, **When** a sessão abre, **Then** a barra de status mostra esse modo; **When** o usuário troca com TAB e reabre o Maestro, **Then** o modo configurado volta (a troca por TAB não é gravada).
10. **Given** o modo não interativo (`-p`), **When** o modelo pede uma ação que exige confirmação no modo em vigor, **Then** ela é recusada com a explicação atual ("confirmação necessária"); **When** o modo em vigor dispensa a confirmação para aquela ação, **Then** ela é executada, permitindo scripts com "Automático" ou "YOLO".

---

### User Story 2 - O modelo pergunta ao usuário com `ask_user` (Priority: P2)

Quando o modelo precisa de uma decisão para continuar — escolher entre abordagens, confirmar qual arquivo alterar, saber a preferência do usuário — ele chama a ferramenta `ask_user` com uma ou mais perguntas de múltipla escolha. Cada pergunta tem um título curto, o texto da pergunta e de duas a quatro opções com rótulo e descrição; pode permitir várias respostas. O Maestro mostra um diálogo, o usuário navega com ↑/↓, marca com Espaço (quando é múltipla) e confirma com Enter; sempre existe a opção "Outro…" para digitar uma resposta livre. As respostas voltam ao modelo em texto e o turno continua. Esc cancela e informa ao modelo que o usuário não respondeu. A ferramenta nunca é afetada pelo modo de aprovação: mesmo em YOLO uma pergunta é exibida.

**Why this priority**: Reduz idas e vindas: hoje o modelo precisa encerrar o turno e esperar uma mensagem para obter uma decisão. Vem depois dos modos porque depende do mesmo mecanismo de "ação que espera o usuário" e porque os modos têm impacto em todas as sessões.

**Independent Test**: Com uma resposta simulada do modelo que chama `ask_user` com duas perguntas (uma simples, uma múltipla), verificar que as duas são exibidas em sequência, que ↑/↓/Espaço/Enter funcionam, que "Outro…" aceita texto, que o modelo recebe as respostas no formato esperado e que Esc devolve "não respondido". Repetir em modo YOLO e verificar que o diálogo aparece do mesmo jeito.

**Acceptance Scenarios**:

1. **Given** o modelo chama `ask_user` com uma pergunta de escolha única, **When** o usuário seleciona uma opção e aperta Enter, **Then** o diálogo fecha, a escolha aparece na transcrição e o modelo recebe o rótulo escolhido como resposta daquela pergunta.
2. **Given** uma pergunta de múltipla escolha, **When** o usuário marca duas opções com Espaço e aperta Enter, **Then** o modelo recebe as duas escolhas, na ordem em que aparecem na lista.
3. **Given** qualquer pergunta, **When** o usuário escolhe "Outro…", **Then** um campo de texto aparece; o texto digitado é devolvido ao modelo como resposta livre e entra na transcrição (ele **não** entra no histórico de entradas ↑/↓, como os demais campos de diálogo).
4. **Given** uma chamada com várias perguntas, **When** o usuário responde a primeira, **Then** a segunda aparece imediatamente, com indicação "pergunta 2 de N"; o modelo só recebe o conjunto completo ao final.
5. **Given** o diálogo de pergunta aberto, **When** o usuário aperta Esc, **Then** o diálogo fecha, o modelo recebe a informação de que o usuário não respondeu (sem erro de ferramenta) e a geração continua.
6. **Given** o modo "YOLO" ou "Automático", **When** o modelo chama `ask_user`, **Then** o diálogo é exibido normalmente — perguntas nunca são respondidas automaticamente.
7. **Given** uma chamada inválida (menos de duas ou mais de quatro opções, pergunta sem texto, rótulos repetidos), **When** a ferramenta é invocada, **Then** nada é exibido e o modelo recebe uma mensagem de erro de validação apontando o problema.
8. **Given** o modo não interativo (`-p`), **When** o modelo chama `ask_user`, **Then** o modelo recebe a informação de que não há usuário disponível para responder, e nenhum diálogo é tentado.
9. **Given** o diálogo aberto, **When** o usuário aperta Esc ou Ctrl+C para cancelar a geração, **Then** o cancelamento vale como hoje (Esc fecha a pergunta como "não respondida" e um segundo Esc cancela a resposta em andamento).
10. **Given** `/help`, **When** exibido, **Then** descreve a ferramenta `ask_user` e as teclas do diálogo, junto do TAB dos modos.

---

### User Story 3 - Créditos ao qwen-code e compromisso open-source (Priority: P3)

Partes desta feature (o desenho dos modos de aprovação e o formato das perguntas de `ask_user`) serão copiadas ou adaptadas do qwen-code, um projeto open-source da Qwen Team (Alibaba) derivado do gemini-cli do Google. O Maestro precisa honrar a licença desses projetos: cada arquivo com código copiado ou adaptado identifica a origem e a licença; um aviso de terceiros na raiz do repositório lista o qwen-code (e o gemini-cli, por herança) com seus avisos de copyright e o texto da licença; o README dá o crédito e aponta o repositório de origem. Ao mesmo tempo, o próprio Maestro afirma explicitamente — no README, no manifesto do pacote e nos princípios do projeto — que é software livre e open-source e que assim permanecerá.

**Why this priority**: É obrigação legal e ética da cópia, e o compromisso open-source é uma decisão de projeto que precisa ficar registrada; tem menor urgência funcional, mas deve estar pronto antes de qualquer publicação da feature.

**Independent Test**: Listar os arquivos que contêm código copiado/adaptado e verificar que cada um traz o cabeçalho de atribuição; abrir o aviso de terceiros e verificar que contém o copyright e a licença do qwen-code (e gemini-cli); abrir o README e verificar a seção de créditos e a declaração open-source; verificar que o manifesto do pacote declara a licença e não marca o pacote como privado.

**Acceptance Scenarios**:

1. **Given** um arquivo do Maestro com trecho copiado ou adaptado do qwen-code, **When** aberto, **Then** suas primeiras linhas identificam a origem (projeto, repositório, licença e o aviso de copyright original) e indicam que o trecho foi modificado.
2. **Given** a raiz do repositório, **When** inspecionada, **Then** existe um aviso de terceiros listando qwen-code e gemini-cli, seus titulares de copyright, a licença aplicável e o texto completo dela, e a licença do Maestro continua sendo a atual (MIT) para o código próprio.
3. **Given** o README, **When** lido, **Then** há uma seção de créditos citando o qwen-code com link para o repositório, e uma declaração de que o Maestro é e continuará sendo open-source.
4. **Given** o manifesto do pacote, **When** lido, **Then** declara a licença do projeto e não marca o pacote como privado.
5. **Given** os princípios do projeto (constituição), **When** lidos, **Then** incluem o compromisso de o projeto permanecer open-source e a regra de atribuir código de terceiros.

---

### Edge Cases

- **TAB sem Shift+TAB distinguível**: alguns terminais não diferenciam Shift+TAB; o ciclo com TAB sozinho basta para alcançar qualquer modo em até três toques. Shift+TAB, quando reconhecido, percorre o ciclo ao contrário.
- **TAB durante a geração**: a troca é aceita e vale para as próximas ações do turno em curso; a ação já pendente não é afetada (cenário 7 da US1).
- **TAB com texto digitado**: o prompt não tem autocompletar; TAB nunca insere caracteres nem apaga o texto em edição.
- **Terminal estreito (modo compacto)**: a barra de status mostra o modo em forma abreviada, mas sempre o mostra.
- **Comando destrutivo não reconhecido em "Automático"**: a lista de padrões destrutivos é uma proteção de conveniência, não uma barreira de segurança; a documentação deixa isso claro e recomenda "Pedir permissão" em repositórios sem controle de versão limpo.
- **Escrita fora da pasta de trabalho**: continua proibida em todos os modos, inclusive YOLO (o confinamento à pasta não é uma confirmação, é uma regra).
- **`ask_user` com pergunta longa ou muitas descrições**: o diálogo cabe na altura do terminal com o mesmo recurso de janela do seletor `/model`; o texto da pergunta quebra em linhas.
- **`ask_user` chamada repetidamente**: cada chamada abre um diálogo quando chega sua vez; o modelo nunca recebe respostas de uma pergunta anterior.
- **Resposta livre vazia em "Outro…"**: Enter com texto vazio não confirma; o campo indica que é preciso digitar algo ou voltar com Esc.
- **Resposta livre nunca vai para o histórico ↑/↓ nem para logs**: só o rótulo das opções e a resposta livre aparecem na transcrição.
- **Modo inicial inválido na configuração ou argumento**: rejeitado com mensagem apontando os valores aceitos, como os demais erros de configuração.
- **Ferramentas desligadas (`--no-tools`)**: escritas e comandos somem; `ask_user` continua disponível, pois não toca o workspace. O modo de aprovação segue visível, embora sem efeito.

## Requirements *(mandatory)*

### Functional Requirements

**Modos de aprovação**

- **FR-001**: O sistema MUST oferecer quatro modos de aprovação, nesta ordem de ciclo: **Pedir permissão** (`default`), **Aceitar edições** (`auto-edit`), **Automático** (`auto`) e **YOLO** (`yolo`).
- **FR-002**: Com o prompt ativo (sem diálogo aberto), TAB MUST avançar para o próximo modo do ciclo e Shift+TAB, quando o terminal o reporta, MUST voltar ao anterior. TAB nunca altera o texto em edição.
- **FR-003**: Cada ação do modelo MUST ser classificada em **leitura**, **edição** (escrita de arquivo na pasta de trabalho), **comando** ou **comando destrutivo**, e a exigência de confirmação MUST seguir a tabela:

  | Modo             | Leitura | Edição | Comando | Comando destrutivo |
  | ---------------- | ------- | ------ | ------- | ------------------ |
  | Pedir permissão  | não     | pede   | pede    | pede               |
  | Aceitar edições  | não     | auto   | pede    | pede               |
  | Automático       | não     | auto   | auto    | pede               |
  | YOLO             | não     | auto   | auto    | auto               |

- **FR-004**: Comandos destrutivos MUST ser reconhecidos por uma lista de padrões documentada (ao menos: remoção recursiva ou forçada, descarte de alterações e reescrita de histórico de versionamento, envio forçado ao remoto, formatação de discos, desligamento/reinício, alteração de permissões em massa, redirecionamento que sobrescreve arquivos de sistema). O diálogo de confirmação MUST dizer qual padrão foi reconhecido.
- **FR-005**: Uma ação executada sem confirmação MUST aparecer na transcrição com a mesma informação que o diálogo mostraria (resumo da edição ou comando) e a indicação do modo que a liberou.
- **FR-006**: A barra de status MUST exibir o modo em vigor permanentemente (forma abreviada em terminais compactos) e MUST destacar visualmente os modos "Automático" e "YOLO". A troca MUST produzir um aviso transitório com o nome do novo modo.
- **FR-007**: O modo inicial MUST ser configurável por argumento de linha de comando e por chave de configuração (global e de projeto, com a precedência atual); o padrão é "Pedir permissão". A troca por TAB MUST valer apenas para a sessão e nunca ser gravada.
- **FR-008**: Uma ação pendente de confirmação MUST continuar aguardando resposta explícita mesmo que o modo mude enquanto ela espera; o novo modo vale para as ações seguintes.
- **FR-009**: Em diálogos (`/auth`, `/model`, `ask_user`, confirmação), TAB MUST ser ignorado pelo ciclo de modos.
- **FR-010**: No modo não interativo (`-p`), o modo de aprovação (argumento ou configuração) MUST decidir o que é executado; ações que exigiriam confirmação MUST continuar sendo recusadas com a explicação atual.
- **FR-011**: `/help` MUST listar os modos, a tecla TAB e o argumento correspondente.

**Ferramenta `ask_user`**

- **FR-012**: O sistema MUST disponibilizar ao modelo uma ferramenta `ask_user` que recebe de uma a quatro perguntas; cada pergunta tem título curto (até 12 caracteres), texto da pergunta, de duas a quatro opções (rótulo único e descrição) e um indicador de múltipla escolha.
- **FR-013**: A entrada da ferramenta MUST ser validada antes de qualquer exibição; entradas inválidas MUST devolver ao modelo uma mensagem de erro de validação apontando o campo, sem abrir diálogo.
- **FR-014**: O diálogo MUST apresentar uma pergunta por vez, com indicação "pergunta N de M", título, texto, as opções com descrições e uma opção extra "Outro…" para resposta livre; ↑/↓ navegam, Espaço marca/desmarca quando é múltipla escolha, Enter confirma, Esc cancela.
- **FR-015**: A resposta devolvida ao modelo MUST conter, por pergunta, o(s) rótulo(s) escolhido(s) ou o texto livre, em formato legível; se o usuário cancelar, MUST informar que o usuário não respondeu (sem marcar erro de ferramenta), e a geração continua.
- **FR-016**: `ask_user` MUST ignorar o modo de aprovação: nunca é respondida automaticamente, em nenhum modo, e MUST continuar disponível com `--no-tools`.
- **FR-017**: No modo não interativo, `ask_user` MUST devolver ao modelo que não há usuário disponível, sem tentar exibir diálogo.
- **FR-018**: Escolhas e respostas livres MUST aparecer na transcrição como entrada do usuário; respostas livres MUST NOT entrar no histórico de entradas ↑/↓ nem em logs.
- **FR-019**: A descrição da ferramenta enviada ao modelo MUST orientar seu uso (perguntar apenas quando uma decisão do usuário é necessária, oferecer opções concretas, não usar para confirmações já cobertas pelos modos de aprovação).

**Créditos e open-source**

- **FR-020**: Todo arquivo com código copiado ou adaptado do qwen-code MUST abrir com um cabeçalho que identifique o projeto de origem, o repositório, o aviso de copyright original, a licença (Apache-2.0) e que o trecho foi modificado para o Maestro.
- **FR-021**: A raiz do repositório MUST ter um arquivo de avisos de terceiros listando qwen-code e gemini-cli (titulares de copyright e licença) e incluindo o texto da licença Apache-2.0; a licença MIT do Maestro MUST permanecer para o código próprio e MUST fazer referência a esse arquivo.
- **FR-022**: O README MUST ter uma seção de créditos citando o qwen-code (com link) e uma declaração explícita de que o Maestro é e permanecerá open-source.
- **FR-023**: O manifesto do pacote MUST declarar a licença MIT e MUST NOT marcar o pacote como privado.
- **FR-024**: A constituição do projeto MUST registrar dois princípios: o projeto permanece open-source sob licença permissiva, e qualquer código de terceiros incorporado é atribuído conforme sua licença.
- **FR-025**: O pacote distribuído (tarball gerado pelo build) MUST incluir a licença e o arquivo de avisos de terceiros.

### Key Entities *(include if feature involves data)*

- **Modo de aprovação**: um dos quatro níveis (`default`, `auto-edit`, `auto`, `yolo`), com rótulo exibível, forma abreviada e a regra de quais classes de ação exigem confirmação; tem um valor configurado (inicial) e um valor da sessão (alterável por TAB).
- **Classe de ação**: leitura, edição, comando ou comando destrutivo; derivada da ferramenta chamada e, para comandos, da lista de padrões destrutivos, que também fornece o motivo exibido.
- **Pergunta ao usuário**: título, texto, opções (rótulo, descrição), múltipla escolha; agrupadas em uma chamada de `ask_user` com até quatro perguntas; cada uma recebe uma resposta (rótulos escolhidos, texto livre ou "não respondida").
- **Aviso de terceiros**: projeto de origem, repositório, titulares de copyright, licença, lista de arquivos do Maestro que contêm material adaptado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O usuário alcança qualquer um dos quatro modos com no máximo três toques de TAB, e a barra de status reflete cada troca no mesmo quadro de tela, sem atraso perceptível.
- **SC-002**: Em uma tarefa com dez edições de arquivo no modo "Aceitar edições", o usuário responde a zero confirmações de escrita; no modo "Pedir permissão", a dez.
- **SC-003**: Em "Automático", 100% dos comandos da lista de padrões destrutivos documentada pedem confirmação, e nenhum comando fora dela pede.
- **SC-004**: Uma pergunta de escolha única do `ask_user` é respondida com no máximo dois toques após a leitura (↑/↓ e Enter), e o modelo continua o turno sem que o usuário precise enviar uma nova mensagem.
- **SC-005**: Em 100% das chamadas de `ask_user` com entrada inválida, o modelo recebe a descrição do problema e nenhum diálogo é exibido.
- **SC-006**: 100% dos arquivos com código adaptado do qwen-code carregam o cabeçalho de atribuição, verificável por uma checagem automática que falha se algum arquivo listado no aviso de terceiros estiver sem ele.
- **SC-007**: A documentação (README e `/help`) explica os quatro modos e a ferramenta `ask_user` de forma que um usuário novo identifique o modo em vigor e saiba trocá‑lo sem consultar o código.

## Assumptions

- "Modo automático" e "Modo YOLO" diferem apenas na proteção contra comandos destrutivos: Automático ainda pede confirmação para eles; YOLO não pede para nada. Essa diferenciação segue o espírito do qwen-code (cujos modos são `plan`, `default`, `auto-edit` e `yolo`) adaptado aos quatro nomes pedidos; um modo "somente leitura/plano" fica fora de escopo.
- A tecla pedida é TAB (o qwen-code usa Shift+TAB). TAB avança; Shift+TAB, quando o terminal o distingue, volta. O Maestro não tem autocompletar no prompt, então TAB está livre.
- A lista de padrões destrutivos é mantida no código, documentada no README e tratada como conveniência; em nenhum modo o Maestro deixa de confinar escritas e comandos à pasta de trabalho.
- O modo inicial é lido de um novo argumento (`--approval-mode <modo>`, com `--yolo` como atalho) e de uma chave em `tools` do arquivo de configuração; a troca por TAB não grava nada.
- No modo `-p`, o comportamento atual (recusar tudo que pede confirmação) continua sendo o padrão, pois o modo padrão é "Pedir permissão"; scripts que quiserem executar ações passam o modo por argumento.
- `ask_user` é inspirada na ferramenta homônima do qwen-code: até quatro perguntas por chamada, de duas a quatro opções por pergunta, título curto, descrição por opção, múltipla escolha opcional e resposta livre. O formato exato do que o modelo recebe segue o do qwen-code onde fizer sentido.
- O qwen-code é licenciado sob Apache-2.0 (Copyright 2025 Qwen Team, Alibaba Group) e deriva do gemini-cli (Apache-2.0, Copyright 2025 Google LLC); ambos entram no aviso de terceiros. O código próprio do Maestro continua sob MIT (licença já presente no repositório), que é compatível com a incorporação de trechos Apache-2.0 desde que os avisos sejam preservados.
- A referência exata (URL e versão/commit) do qwen-code será fornecida pelo usuário na fase de planejamento; até então o aviso usa o repositório público `https://github.com/QwenLM/qwen-code`.
- Esta feature reaproveita o diálogo de confirmação, o `SelectList`/`TextField` dos diálogos e a infraestrutura de ferramentas existentes; não introduz novas dependências.
