# Feature Specification: Maestro CLI – Assistente de IA no Terminal (MVP)

**Feature Branch**: `001-maestro-cli-mvp`  
**Created**: 2026-10-24  
**Status**: Draft  
**Input**: User description: "Crie um projeto que um orquestrador de agentes (vai começar como um clone do qwen code, depois evoluiremos): o projeto se chamará maestro; deve ser uma aplicação de console cli, como o claude code e o qwen code; pode se basear no qwen code (https://github.com/QwenLM/qwen-code), mas extraia apenas o necessário; o aplicativo tem que começar simples, depois vamos evoluindo; depois irá se tornar um orquestrador de agentes, mas ainda não; deve funcionar com múltiplos modelos de IA, que devem ser ativados nas configurações; a princípio configure para usar o claude configurado na máquina e o qwen do alibaba, onde deve ser passada a url e a chave de API."

## Visão Geral

Maestro é uma aplicação de linha de comando que permite ao desenvolvedor conversar com um modelo de IA diretamente no terminal, a partir do diretório do projeto em que está trabalhando. Nesta primeira versão, o Maestro é deliberadamente simples: uma sessão interativa de chat com suporte a múltiplos provedores de modelos, ativados e configurados pelo usuário. A evolução para orquestração de múltiplos agentes está fora do escopo desta feature, mas a arquitetura conceitual (provedores plugáveis, configuração declarativa) deve deixar esse caminho aberto.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversar com um modelo de IA no terminal (Priority: P1)

Um desenvolvedor abre o terminal na pasta do seu projeto, executa `maestro` e entra em uma sessão interativa. Ele digita perguntas ou pedidos em linguagem natural e recebe respostas do modelo de IA ativo, exibidas de forma incremental conforme são geradas. A conversa mantém contexto: perguntas posteriores levam em conta as anteriores. O usuário encerra a sessão com um comando de saída.

**Why this priority**: É o valor central do produto. Sem a sessão interativa funcionando com ao menos um modelo, nada mais tem utilidade. Sozinha, esta história já entrega um "chat com IA no terminal" utilizável.

**Independent Test**: Com um único provedor configurado, executar `maestro`, enviar duas mensagens encadeadas (a segunda referenciando a primeira) e verificar que as respostas chegam, são coerentes com o contexto e a sessão encerra limpa com o comando de saída.

**Acceptance Scenarios**:

1. **Given** um provedor de modelo ativo e com credenciais válidas, **When** o usuário executa `maestro` e envia uma mensagem, **Then** a resposta do modelo é exibida no terminal de forma incremental (token a token ou em blocos) e o prompt volta a aceitar entrada ao final.
2. **Given** uma sessão em andamento com ao menos uma troca de mensagens, **When** o usuário envia uma nova mensagem que depende do contexto anterior (ex.: "resuma o que você acabou de dizer"), **Then** a resposta reflete o histórico da sessão.
3. **Given** uma sessão em andamento, **When** o usuário digita o comando de saída (ex.: `/exit`) ou pressiona o atalho de interrupção duas vezes, **Then** a aplicação encerra sem erros e sem deixar processos pendentes.
4. **Given** uma sessão em andamento, **When** o modelo está gerando uma resposta longa e o usuário pressiona o atalho de interrupção, **Then** a geração é cancelada, o conteúdo parcial permanece visível e o prompt volta a aceitar entrada.
5. **Given** um provedor ativo cujas credenciais são inválidas ou cujo serviço está indisponível, **When** o usuário envia uma mensagem, **Then** o Maestro exibe uma mensagem de erro clara indicando o provedor e a causa provável (credencial, rede, limite), sem encerrar a sessão.

---

### User Story 2 - Configurar e ativar múltiplos provedores de modelo (Priority: P2)

O desenvolvedor define, em um arquivo de configuração, quais provedores de IA estão disponíveis e qual está ativo. Nesta versão existem dois provedores: **Claude** (reutilizando as credenciais Claude já configuradas na máquina, sem precisar digitá-las novamente) e **Qwen (Alibaba Cloud)**, para o qual o usuário informa a URL do endpoint e a chave de API. O usuário pode trocar o provedor ativo tanto pela configuração quanto por um comando dentro da sessão, e pode consultar qual modelo está em uso a qualquer momento.

**Why this priority**: O suporte a múltiplos modelos é o diferencial declarado do projeto e a base para a futura orquestração. Depende da história 1 para ter utilidade, por isso é P2.

**Independent Test**: Configurar os dois provedores, iniciar o Maestro com Claude ativo e confirmar que a resposta vem do Claude; trocar para Qwen pelo comando de sessão e confirmar que a resposta seguinte vem do Qwen; reiniciar e confirmar que a escolha persistida na configuração é respeitada.

**Acceptance Scenarios**:

1. **Given** nenhuma configuração existente, **When** o usuário executa `maestro` pela primeira vez, **Then** o Maestro cria um arquivo de configuração inicial com os provedores Claude e Qwen listados (Qwen desativado até que URL e chave sejam informadas) e orienta o usuário sobre como preenchê-lo.
2. **Given** o provedor Qwen configurado com URL e chave de API válidas e marcado como ativo, **When** o usuário envia uma mensagem, **Then** a resposta é obtida do endpoint Qwen informado.
3. **Given** o provedor Claude marcado como ativo e credenciais Claude presentes na máquina, **When** o usuário envia uma mensagem, **Then** a resposta é obtida do Claude sem que o usuário precise informar chave no arquivo de configuração do Maestro.
4. **Given** uma sessão em andamento, **When** o usuário executa o comando de troca de modelo (ex.: `/model qwen`), **Then** as mensagens seguintes são enviadas ao novo provedor e o Maestro confirma a troca em tela, preservando o histórico da conversa.
5. **Given** uma sessão em andamento, **When** o usuário executa o comando de consulta (ex.: `/model`), **Then** o Maestro exibe o provedor e o modelo atualmente ativos e a lista dos provedores disponíveis com seu estado (ativo, configurado, não configurado).
6. **Given** o provedor marcado como ativo não possui credenciais (ex.: Qwen sem chave), **When** o usuário executa `maestro`, **Then** o Maestro informa exatamente o que falta e, se houver outro provedor pronto, oferece usá-lo como alternativa.
7. **Given** um valor de chave de API presente no arquivo de configuração, **When** o Maestro exibe informações de configuração em tela ou em logs, **Then** a chave aparece mascarada (apenas os últimos 4 caracteres visíveis).

---

### User Story 3 - Dar contexto do projeto ao modelo (Priority: P3)

Durante a sessão, o desenvolvedor pede ao modelo para analisar arquivos do projeto atual (ex.: "explique o que faz o arquivo src/main.ts"). O Maestro permite que o modelo leia arquivos e liste diretórios dentro da pasta de trabalho, de modo que as respostas sejam fundamentadas no código real. Qualquer ação que altere o sistema (escrever arquivos, executar comandos) exige confirmação explícita do usuário antes de acontecer.

**Why this priority**: É o que diferencia um "chat no terminal" de um "assistente de código no terminal", aproximando-o do qwen code. Porém é incremental sobre as histórias 1 e 2 e pode ser entregue depois sem comprometer o MVP.

**Independent Test**: Em um projeto com alguns arquivos, pedir ao Maestro para resumir um arquivo específico e verificar que a resposta cita conteúdo real desse arquivo; pedir para criar um arquivo e verificar que o Maestro solicita confirmação e só cria após o "sim".

**Acceptance Scenarios**:

1. **Given** uma sessão iniciada na pasta de um projeto, **When** o usuário pede informações sobre um arquivo existente, **Then** o modelo recebe o conteúdo do arquivo e a resposta reflete esse conteúdo.
2. **Given** uma sessão em andamento, **When** o modelo propõe criar ou alterar um arquivo, **Then** o Maestro mostra o que será alterado e pede confirmação; a alteração só ocorre após aprovação explícita.
3. **Given** uma sessão em andamento, **When** o modelo tenta acessar um caminho fora da pasta de trabalho, **Then** o acesso é negado e o usuário é informado.
4. **Given** uma sessão em andamento, **When** o modelo propõe executar um comando de terminal, **Then** o Maestro exibe o comando, pede confirmação e, após aprovação, mostra a saída ao usuário e ao modelo.

---

### User Story 4 - Uso não interativo (Priority: P4)

O desenvolvedor executa `maestro` com um prompt passado como argumento (ou via entrada padrão) e recebe apenas a resposta, sem entrar na sessão interativa. Isso permite usar o Maestro em scripts e pipelines.

**Why this priority**: Conveniência útil e barata, mas não essencial para o MVP.

**Independent Test**: Executar `maestro -p "diga olá"` e verificar que a resposta é impressa e o processo termina com código de sucesso.

**Acceptance Scenarios**:

1. **Given** um provedor ativo válido, **When** o usuário executa o Maestro com um prompt como argumento, **Then** a resposta é impressa na saída padrão e o processo termina com código de sucesso.
2. **Given** um provedor ativo com erro de credencial, **When** o usuário executa o Maestro em modo não interativo, **Then** a mensagem de erro vai para a saída de erro e o processo termina com código diferente de zero.

---

### Edge Cases

- O que acontece quando o arquivo de configuração está corrompido ou tem campos inválidos? O Maestro deve apontar a linha/campo problemático e não iniciar com configuração parcial silenciosamente.
- O que acontece quando o usuário envia uma mensagem vazia? Deve ser ignorada sem chamar o provedor.
- O que acontece quando a conversa fica longa demais para o limite de contexto do modelo? O Maestro deve informar o usuário e oferecer iniciar uma nova conversa (ex.: `/clear`), em vez de falhar de forma obscura.
- O que acontece quando a rede cai no meio de uma resposta? O conteúdo parcial permanece visível, o erro é informado e a sessão continua.
- O que acontece quando o usuário troca de provedor no meio de uma conversa? O histórico é mantido e enviado ao novo provedor; se o novo provedor rejeitar o histórico por tamanho, o usuário é avisado.
- O que acontece quando a URL do Qwen é informada sem esquema (ex.: sem `https://`) ou com barra final? O Maestro deve normalizar ou rejeitar com mensagem clara.
- O que acontece quando o terminal não suporta cores ou formatação rica? A saída deve degradar para texto simples legível.
- O que acontece quando o usuário executa `maestro` fora de um repositório/projeto? A sessão funciona normalmente; apenas as ferramentas de arquivo ficam limitadas à pasta atual.

## Requirements *(mandatory)*

### Functional Requirements

**Sessão interativa**

- **FR-001**: O sistema MUST iniciar uma sessão interativa no terminal ao ser executado sem argumentos, apresentando um prompt para entrada de texto.
- **FR-002**: O sistema MUST enviar cada mensagem do usuário ao provedor de modelo ativo e exibir a resposta de forma incremental conforme ela é gerada.
- **FR-003**: O sistema MUST manter o histórico da conversa dentro da sessão e enviá-lo ao modelo em cada nova mensagem, de modo que o modelo tenha contexto das trocas anteriores.
- **FR-004**: O sistema MUST permitir ao usuário cancelar uma resposta em geração por meio de um atalho de interrupção, preservando o conteúdo parcial já exibido.
- **FR-005**: O sistema MUST oferecer comandos de sessão iniciados por `/`, incluindo no mínimo: `/exit` (encerrar), `/clear` (nova conversa), `/model` (consultar/trocar provedor) e `/help` (listar comandos).
- **FR-006**: O sistema MUST exibir mensagens de erro compreensíveis, indicando provedor e causa provável (credencial inválida, rede indisponível, limite excedido, resposta inesperada), sem encerrar a sessão.
- **FR-007**: O sistema MUST ignorar mensagens vazias ou compostas apenas de espaços, sem acionar o provedor.

**Provedores e configuração**

- **FR-008**: O sistema MUST suportar múltiplos provedores de modelo de IA, sendo cada um ativável ou desativável pelo usuário via configuração.
- **FR-009**: O sistema MUST incluir, nesta versão, dois provedores: Claude e Qwen (Alibaba Cloud).
- **FR-010**: Para o provedor Qwen, o sistema MUST aceitar na configuração a URL do endpoint, a chave de API e o nome do modelo a utilizar.
- **FR-011**: Para o provedor Claude, o sistema MUST reutilizar as credenciais Claude já presentes na máquina do usuário, sem exigir que a chave seja redigitada na configuração do Maestro; a configuração do Maestro pode opcionalmente sobrescrever o nome do modelo.
- **FR-012**: O sistema MUST manter a configuração em um arquivo legível e editável pelo usuário, em local previsível (configuração global do usuário), com possibilidade de sobrescrita por configuração local do projeto.
- **FR-013**: O sistema MUST criar um arquivo de configuração inicial na primeira execução, com os provedores conhecidos listados e instruções sobre como preenchê-los.
- **FR-014**: O sistema MUST validar a configuração ao iniciar e, em caso de erro, informar o campo problemático e interromper o início em vez de operar com configuração parcial.
- **FR-015**: O sistema MUST permitir trocar o provedor ativo durante a sessão por comando, preservando o histórico da conversa.
- **FR-016**: O sistema MUST permitir consultar, durante a sessão, qual provedor e modelo estão ativos e o estado de cada provedor disponível (ativo, configurado, não configurado).
- **FR-017**: O sistema MUST permitir informar o provedor desejado por argumento de linha de comando no início da execução, sobrescrevendo a configuração para aquela sessão.
- **FR-018**: O sistema MUST aceitar chaves de API também por variável de ambiente, para que o usuário não precise gravar segredos no arquivo de configuração.
- **FR-019**: O sistema MUST mascarar chaves de API em qualquer exibição em tela ou registro, mostrando no máximo os 4 últimos caracteres.
- **FR-020**: O sistema MUST NOT enviar credenciais de um provedor a outro provedor nem a qualquer serviço que não seja o endpoint configurado para aquele provedor.

**Contexto do projeto (User Story 3)**

- **FR-021**: O sistema MUST permitir que o modelo leia arquivos e liste diretórios dentro da pasta de trabalho atual quando necessário para responder ao usuário.
- **FR-022**: O sistema MUST negar qualquer acesso a caminhos fora da pasta de trabalho atual e informar o usuário quando isso ocorrer.
- **FR-023**: O sistema MUST exigir confirmação explícita do usuário antes de criar ou alterar arquivos ou executar comandos propostos pelo modelo, exibindo previamente o que será feito.
- **FR-024**: O sistema MUST reportar ao usuário e ao modelo o resultado de cada ação executada (conteúdo lido, arquivo gravado, saída do comando).

**Modo não interativo (User Story 4)**

- **FR-025**: O sistema MUST aceitar um prompt como argumento de linha de comando ou via entrada padrão, imprimir a resposta e encerrar com código de saída que reflita sucesso ou falha.

**Produto e evolução**

- **FR-026**: O produto MUST chamar-se "maestro" e ser invocável pelo comando `maestro` no terminal.
- **FR-027**: O sistema MUST funcionar nos sistemas operacionais Windows, macOS e Linux.
- **FR-028**: O sistema MUST ser estruturado de modo que novos provedores de modelo possam ser adicionados sem alterar o fluxo da sessão interativa (provedores plugáveis), deixando aberto o caminho para a futura orquestração de agentes.

### Key Entities

- **Provedor de Modelo (Provider)**: Um serviço de IA que o Maestro sabe acionar. Atributos: identificador (ex.: `claude`, `qwen`), nome amigável, estado (ativo/inativo), modelo padrão, parâmetros de conexão (URL, chave quando aplicável), origem das credenciais (configuração, variável de ambiente ou credenciais da máquina).
- **Configuração**: Conjunto de preferências do usuário: lista de provedores com seus parâmetros, provedor ativo por padrão, preferências de exibição. Existe em nível global (usuário) e opcionalmente em nível de projeto, com o nível de projeto prevalecendo.
- **Sessão**: Uma execução interativa do Maestro. Possui pasta de trabalho, provedor ativo, histórico de mensagens e estado (ociosa, gerando resposta, aguardando confirmação).
- **Mensagem**: Uma unidade do histórico. Atributos: papel (usuário, assistente, sistema, resultado de ferramenta), conteúdo, momento, provedor que a produziu (para mensagens do assistente).
- **Ação de Ferramenta**: Uma operação proposta pelo modelo sobre o ambiente (ler arquivo, listar diretório, escrever arquivo, executar comando). Atributos: tipo, parâmetros, se exige confirmação, resultado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um desenvolvedor com credenciais Claude já configuradas na máquina consegue instalar o Maestro, executá-lo e receber a primeira resposta de IA em menos de 5 minutos, sem consultar documentação além da mensagem de boas-vindas.
- **SC-002**: Um desenvolvedor consegue configurar o provedor Qwen (URL + chave) e obter uma resposta dele em menos de 3 minutos a partir da leitura do arquivo de configuração inicial gerado.
- **SC-003**: O primeiro trecho de resposta aparece em tela em até 3 segundos após o envio da mensagem em 95% das interações, em condições normais de rede (o restante da latência é do provedor).
- **SC-004**: A troca de provedor durante a sessão é concluída em menos de 1 segundo e 100% das mensagens seguintes vão para o provedor escolhido.
- **SC-005**: 100% das falhas de credencial, rede ou limite resultam em mensagem de erro que nomeia o provedor e a causa provável, e em nenhum caso a sessão interativa é encerrada por essas falhas.
- **SC-006**: Nenhuma chave de API aparece em texto claro em saída de tela, logs ou mensagens de erro em qualquer cenário de teste.
- **SC-007**: 100% das ações que alteram arquivos ou executam comandos passam por confirmação explícita do usuário antes de serem efetivadas.
- **SC-008**: A aplicação inicia e exibe o prompt em menos de 2 segundos em um computador de desenvolvimento típico.
- **SC-009**: Os mesmos fluxos de aceitação passam em Windows, macOS e Linux.

## Assumptions

- **Escopo do MVP**: "Começar simples" foi interpretado como: sessão de chat interativa (P1) + múltiplos provedores (P2) são obrigatórios para o MVP; ferramentas de contexto do projeto (P3) e modo não interativo (P4) são incrementos desejáveis mas podem ser entregues em seguida. Orquestração de agentes, sub-agentes, servidores de ferramentas externos (MCP), memória persistente entre sessões, extensões/plugins, temas e modo de ferramentas "sem confirmação" estão **fora do escopo** desta feature.
- **"Extrair apenas o necessário do qwen code"**: O qwen code serve como referência de experiência de uso (sessão interativa, comandos `/`, streaming de resposta, ferramentas com confirmação). Apenas os conceitos e fluxos listados nas histórias acima são trazidos; o restante (integração com IDE, telemetria, autenticação por OAuth do Qwen, extensões, sub-agentes etc.) fica de fora.
- **"Claude configurado na máquina"**: Entendido como reutilizar credenciais Claude que já existam no ambiente do usuário (por exemplo, chave de API em variável de ambiente ou configuração local já usada por outras ferramentas Claude), sem que o Maestro peça ao usuário para redigitar a chave. Se nenhuma credencial for encontrada, o Maestro deve explicar como fornecê-la. *Esta interpretação merece confirmação do usuário em `/speckit.clarify`.*
- **Qwen (Alibaba Cloud)**: Acessado por um endpoint compatível com API de chat, informado por URL e chave de API na configuração. O nome do modelo padrão será um modelo de código do Qwen; o usuário pode alterá-lo na configuração.
- **Credenciais**: Chaves podem ser gravadas no arquivo de configuração ou fornecidas por variável de ambiente; a variável de ambiente prevalece. O arquivo de configuração é responsabilidade do usuário quanto a permissões de acesso.
- **Persistência**: O histórico da conversa vive apenas durante a sessão; nada é salvo em disco além da configuração nesta versão.
- **Ambiente**: O usuário tem acesso à internet e permissão para alcançar os endpoints dos provedores. O terminal é um emulador moderno; a aplicação degrada para texto simples quando não há suporte a formatação.
- **Usuários**: Desenvolvedores de software confortáveis com terminal e edição de arquivos de configuração. Não há múltiplos perfis, equipes ou controle de acesso.
- **Idioma**: A interface responde no idioma em que o usuário escreve; textos fixos da interface (comandos, mensagens de erro) são em inglês por convenção de ferramentas CLI, com possibilidade de localização futura.
