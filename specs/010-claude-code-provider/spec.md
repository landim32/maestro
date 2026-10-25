# Feature Specification: Provedor Claude Code (assinatura do claude.ai pelo Claude Code instalado)

**Feature Branch**: `010-claude-code-provider`
**Created**: 2026-10-25
**Status**: Draft
**Input**: User description: "Preciso que inclua essa opção de usar o Claude Code direto para a parte do Claude. O que já está funcionando com a API, deixe. Apenas avise que funciona sobre a API. Ou seja, dentro do Maestro deve chamar o Claude Code."

## Contexto

O provedor `claude` do Maestro fala com a API da Anthropic, seja por chave, seja pelo perfil do `ant auth login`. Nos dois casos o uso é cobrado dos créditos de API da organização do console. Quando os créditos acabam, o Maestro mostra "Your credit balance is too low". O usuário tem uma assinatura do claude.ai e o Claude Code instalado e logado com ela. Ele quer que o Maestro use o Claude por esse caminho.

Os termos da Anthropic não permitem que um aplicativo de terceiros ofereça login do claude.ai, nem colete, guarde ou repasse credenciais ou tokens da assinatura. O que eles permitem é o usuário entrar com a própria assinatura no binário original do Claude Code. Esta feature fica dentro desse limite. O Maestro executa o binário `claude` que o usuário instalou e logou, no modo não interativo, e nunca lê, guarda, pede ou repassa credencial nenhuma. Se o Claude Code não estiver logado, o Maestro só avisa e explica como fazer o login no próprio Claude Code.

O usuário decidiu seguir com esse caminho depois de ser avisado de que os termos não tratam explicitamente de uma ferramenta pessoal que chama o Claude Code. Essa ressalva fica registrada no README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversar com o Claude pela assinatura, dentro do Maestro (Priority: P1)

Como usuário com o Claude Code instalado e logado, ativo o provedor "Claude Code" e converso no Maestro como sempre. As respostas vêm do Claude, com streaming, e não consomem créditos de API.

**Why this priority**: É o pedido central. Sem isso o usuário fica sem Claude quando os créditos de API acabam.

**Independent Test**: Com um Claude Code simulado que emite o fluxo JSON do modo não interativo, ativar o provedor, enviar uma mensagem e ver o texto aparecer aos poucos na transcrição, com o uso de tokens na barra de status.

**Acceptance Scenarios**:

1. **Given** o Claude Code instalado e logado com a assinatura, **When** o usuário escolhe "Claude Code" em `/auth`, **Then** o Maestro confirma o login, mostra o e-mail mascarado e o método ("assinatura do claude.ai"), habilita o provedor e oferece ativá-lo.
2. **Given** o provedor Claude Code ativo, **When** o usuário envia uma mensagem, **Then** a resposta chega em streaming e a mensagem fica marcada com o provedor `claude-code` e o modelo usado.
3. **Given** uma conversa que já tem respostas do Qwen ou do Claude pela API, **When** o próximo pedido vai para o Claude Code, **Then** ele recebe o histórico da conversa e responde levando-o em conta.
4. **Given** o provedor Claude Code ativo, **When** o usuário troca o modelo com `/model claude-code claude-sonnet-5-5`, **Then** os pedidos seguintes usam esse modelo.
5. **Given** um pedido em andamento, **When** o usuário aperta Esc, **Then** o processo do Claude Code é encerrado e o turno termina como cancelado.
6. **Given** uma rota (`/routes`) apontando para `claude-code`, **When** o comando da rota é usado, **Then** ele roda pelo Claude Code sem trocar o provedor ativo.

---

### User Story 2 - As ferramentas do Maestro funcionam pelo Claude Code, com a mesma política de aprovação (Priority: P1)

Como usuário, quando o Claude (via Claude Code) precisa ler um arquivo, escrever, rodar um comando ou me perguntar algo, ele usa as ferramentas do Maestro. Os modos de aprovação, o diálogo de confirmação com diff, o confinamento à pasta, os passos nativos do Spec Kit e o `ask_user` continuam valendo. O Claude Code não usa nenhuma ferramenta própria.

**Why this priority**: Sem ferramentas, o fluxo Spec Kit e qualquer trabalho no código ficam impossíveis. Se o Claude Code usasse as próprias ferramentas, a política de aprovação do Maestro seria contornada.

**Independent Test**: Com um Claude Code simulado que chama as ferramentas do Maestro, verificar que uma escrita pede confirmação no modo `default`, que uma leitura não pede, que um script do Spec Kit é interceptado e que uma recusa volta ao modelo como erro.

**Acceptance Scenarios**:

1. **Given** o modo de aprovação `default`, **When** o modelo pede para escrever um arquivo, **Then** o diálogo de confirmação aparece com o diff e a escrita só acontece se o usuário aprovar.
2. **Given** qualquer modo, **When** o modelo pede para ler um arquivo fora da pasta de trabalho, **Then** a leitura é recusada como hoje.
3. **Given** um comando `/speckit.*`, **When** o modelo roda um script de `.specify/scripts/`, **Then** o passo nativo é executado e o JSON do script volta ao modelo.
4. **Given** o modelo chama `ask_user`, **When** o usuário responde, **Then** a resposta volta ao modelo.
5. **Given** chamadas de ferramenta durante o turno, **When** a transcrição é exibida, **Then** cada chamada e cada resultado aparecem como nos outros provedores.
6. **Given** o processo do Claude Code, **When** ele inicia, **Then** nenhuma ferramenta própria do Claude Code, nenhum servidor MCP do usuário e nenhum comando ou skill do usuário fica disponível ao modelo; só as ferramentas do Maestro.
7. **Given** `--no-tools`, **When** o turno roda, **Then** só `ask_user` fica disponível, como nos outros provedores.

---

### User Story 3 - Avisos claros sobre o que consome créditos de API (Priority: P2)

Como usuário, vejo nos menus de `/auth` e `/model` e na documentação que o provedor "Claude" funciona sobre a API e consome créditos, e que o "Claude Code" usa a assinatura do Claude Code instalado. Quando os créditos de API acabam, a mensagem de erro diz isso em português e sugere o Claude Code ou outro provedor.

**Why this priority**: O usuário pediu explicitamente o aviso. Ele evita a confusão que gerou esta feature, mas não bloqueia o uso.

**Independent Test**: Abrir `/auth` e `/model` e conferir os textos; simular um erro 400 de saldo insuficiente e conferir a mensagem.

**Acceptance Scenarios**:

1. **Given** o menu `/auth`, **When** é exibido, **Then** as opções "Claude API" e "Claude Console (login)" dizem que consomem créditos de API, e "Claude Code" diz que usa a assinatura do Claude Code instalado.
2. **Given** o seletor `/model`, **When** é exibido, **Then** o grupo do provedor `claude` indica "API · créditos" e o grupo `claude-code` indica "assinatura".
3. **Given** a API responde que o saldo de créditos é insuficiente, **When** o erro é exibido, **Then** a mensagem diz em português que os créditos de API acabaram e sugere `/model claude-code` (se configurado) ou outro provedor, sem despejar o JSON da API.
4. **Given** o README, **When** o usuário lê a seção de credenciais, **Then** encontra a diferença entre API e Claude Code e a ressalva sobre os termos.

---

### Edge Cases

- **Claude Code não instalado**: `/auth` → "Claude Code" mostra como instalar e oferece tentar de novo; o provedor fica "não configurado".
- **Claude Code instalado, mas não logado ou logado por chave de API**: `/auth` mostra o método detectado e explica que só o login da assinatura evita créditos de API. Login por chave é aceito, com aviso de que consome créditos.
- **Limite de uso da assinatura atingido**: o erro do Claude Code vira uma mensagem de limite de uso, com o horário de reinício quando ele vier no fluxo.
- **Modelo inexistente ou sem acesso**: o erro do Claude Code aparece como erro do provedor, com a mensagem dele.
- **Processo termina sem resultado**: erro com a última linha útil da saída de erro, sem segredos.
- **Pedido de ferramenta depois do cancelamento**: a ferramenta não roda e o modelo recebe "cancelado".
- **Modo `-p`**: funciona igual aos outros provedores; o que exigiria confirmação é recusado.
- **Conversa muito longa**: o histórico vai pela entrada padrão do processo, nunca pela linha de comando, então o limite de tamanho da linha de comando do Windows não se aplica.
- **Imagens anexadas**: são enviadas ao Claude Code.
- **Outro processo na máquina tenta usar as ferramentas do Maestro**: o servidor local só escuta em 127.0.0.1, numa porta aleatória, e exige um token aleatório por turno.

## Requirements *(mandatory)*

### Functional Requirements

**Provedor**

- **FR-001**: O sistema MUST oferecer um provedor `claude-code` que atende cada pedido executando o binário `claude` instalado pelo usuário no modo não interativo, com o histórico enviado pela entrada padrão.
- **FR-002**: O sistema MUST NOT ler, gravar, pedir, exibir ou repassar credenciais ou tokens do claude.ai; a autenticação é inteiramente do Claude Code.
- **FR-003**: O provedor MUST vir desabilitado por padrão. Sem configuração, o comportamento atual não muda.
- **FR-004**: O provedor MUST ter modelo, lista de modelos e esforço configuráveis como o provedor `claude`, e o caminho do executável opcionalmente configurável.
- **FR-005**: O provedor MUST transmitir o texto em streaming, informar o uso de tokens ao fim e respeitar o cancelamento encerrando o processo.
- **FR-006**: O provedor MUST traduzir os erros do Claude Code (não logado, limite de uso, modelo inválido, falha do processo, executável ausente) em erros do Maestro com mensagem sem segredos.
- **FR-007**: O processo do Claude Code MUST rodar sem ferramentas próprias, sem servidores MCP do usuário, sem comandos e skills do usuário e sem persistir a sessão em disco.

**Ferramentas**

- **FR-008**: As ferramentas disponíveis no turno MUST ser expostas ao Claude Code por um servidor local acessível só em 127.0.0.1, numa porta aleatória, protegido por um token aleatório por turno e encerrado ao fim do turno.
- **FR-009**: Cada chamada de ferramenta MUST passar pelo mesmo caminho dos outros provedores: validação da entrada, interceptação do Spec Kit, política de aprovação, confirmação e confinamento à pasta.
- **FR-010**: Chamadas e resultados MUST ser registrados no histórico da conversa como nos outros provedores, para aparecerem na transcrição e no contexto das outras rotas.
- **FR-011**: O turno MUST limitar o número de chamadas de ferramenta e encerrar com aviso quando o limite é atingido.

**Configuração e avisos**

- **FR-012**: `/auth` MUST ter a opção "Claude Code" que localiza o executável, lê o estado de login do Claude Code, mostra o método e o e-mail mascarado, habilita o provedor e oferece ativá-lo, sem nunca iniciar um login.
- **FR-013**: As opções e os nomes do provedor `claude` MUST indicar que funcionam sobre a API e consomem créditos.
- **FR-014**: O erro de saldo de créditos insuficiente da API MUST ter mensagem própria, em português, com sugestão de alternativa.
- **FR-015**: O README MUST documentar o provedor, a diferença de cobrança e a ressalva sobre os termos da Anthropic.
- **FR-016**: Os logs MUST registrar só eventos e contagens do provedor (início, fim, ferramenta chamada, código de saída), nunca conteúdo, e-mail ou tokens.

### Key Entities

- **Configuração do provedor Claude Code**: habilitado, modelo, lista de modelos, esforço, caminho opcional do executável.
- **Estado do Claude Code**: instalado ou não, logado ou não, método de login (assinatura ou chave), e-mail mascarado.
- **Ponte de ferramentas**: servidor local de um turno, com porta, token e a lista de ferramentas do turno.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Com o Claude Code logado pela assinatura, uma conversa no Maestro pelo provedor `claude-code` não gera nenhum consumo de créditos de API.
- **SC-002**: O primeiro trecho de texto aparece em até 5 segundos depois do envio, em condições normais de rede.
- **SC-003**: Em 100% das chamadas de ferramenta, a política de aprovação produz a mesma decisão que produziria com o provedor `claude`.
- **SC-004**: Nenhuma credencial do claude.ai aparece em arquivos do Maestro, em logs ou na tela, o que é verificado pelos testes de segredos.
- **SC-005**: Sem configuração nova, a suíte de testes existente passa sem alterações de comportamento.

## Assumptions

- O usuário instala e faz login no Claude Code por conta própria. O Maestro só verifica o estado.
- O modo não interativo do Claude Code com fluxo JSON, ferramentas desligadas e servidores MCP explícitos continua disponível nas versões instaladas. Foi validado com a versão 2.1.310.
- Ajustes de `maxTokens` não se aplicam ao Claude Code. O esforço se aplica.
- O histórico vai como texto estruturado na primeira mensagem, porque o Claude Code não aceita mensagens de assistente injetadas. Os resultados de ferramentas de turnos anteriores vão resumidos no mesmo texto.
- O limite de chamadas de ferramenta por turno é fixo nesta versão.
