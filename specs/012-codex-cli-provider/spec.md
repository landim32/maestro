# Feature Specification: Provedor Codex (assinatura do ChatGPT pelo Codex CLI instalado)

**Feature Branch**: `012-codex-cli-provider`
**Created**: 2026-10-25
**Status**: Draft
**Input**: User description: "crie um novo provider para o codex, rodando local, chamando o executável do console, da mesma forma que está funcionando o claude code, sem api"

## Contexto

O Maestro já tem o provedor `claude-code` (specs/010). Ele executa o binário do Claude Code que o usuário instalou e logou, e assim usa a assinatura do claude.ai em vez de créditos de API. O usuário quer o mesmo caminho para os modelos da OpenAI. O Maestro deve executar o Codex CLI (`codex`) instalado e logado pelo usuário com a conta do ChatGPT, no modo não interativo. Não deve haver chave de API nem chamada direta à API da OpenAI.

Esta feature segue as mesmas regras do `claude-code`. O Maestro nunca lê, guarda, pede ou repassa credenciais ou tokens do ChatGPT. A autenticação é inteiramente do Codex, e se o Codex não estiver logado o Maestro só avisa e explica como fazer o login no próprio Codex. O Codex também não usa ferramentas próprias: ele só usa as ferramentas do Maestro, pela mesma ponte local, e por isso a política de aprovação, o confinamento à pasta e os passos nativos do Spec Kit continuam valendo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversar com os modelos da OpenAI pela assinatura, dentro do Maestro (Priority: P1)

Como usuário com o Codex CLI instalado e logado com a conta do ChatGPT, ativo o provedor "Codex" e converso no Maestro como sempre. As respostas vêm do modelo do Codex, com streaming, e não usam chave de API.

**Why this priority**: É o pedido central. Ele dá ao usuário um segundo provedor pago por assinatura, ao lado do Claude Code.

**Independent Test**: Com um Codex simulado que emite o fluxo de eventos JSON do modo não interativo, ativar o provedor, enviar uma mensagem e ver a resposta na transcrição, com o uso de tokens na barra de status.

**Acceptance Scenarios**:

1. **Given** o Codex instalado e logado com a conta do ChatGPT, **When** o usuário escolhe "Codex" em `/auth`, **Then** o Maestro confirma o login, mostra o método ("conta do ChatGPT"), habilita o provedor e oferece ativá-lo.
2. **Given** o provedor Codex ativo, **When** o usuário envia uma mensagem, **Then** a resposta aparece na transcrição e a mensagem fica marcada com o provedor `codex` e o modelo usado.
3. **Given** uma conversa que já tem respostas de outros provedores, **When** o próximo pedido vai para o Codex, **Then** ele recebe o histórico da conversa e responde levando-o em conta.
4. **Given** o provedor Codex ativo, **When** o usuário troca o modelo com `/model codex <modelo>`, **Then** os pedidos seguintes usam esse modelo.
5. **Given** um pedido em andamento, **When** o usuário aperta Esc, **Then** o processo do Codex e seus filhos são encerrados e o turno termina como cancelado.
6. **Given** uma rota (`/routes`) apontando para `codex`, **When** o comando da rota é usado, **Then** ele roda pelo Codex sem trocar o provedor ativo.

---

### User Story 2 - As ferramentas do Maestro funcionam pelo Codex, com a mesma política de aprovação (Priority: P1)

Como usuário, quando o modelo do Codex precisa ler um arquivo, escrever, rodar um comando ou me perguntar algo, ele usa as ferramentas do Maestro. Os modos de aprovação, o diálogo de confirmação com diff, o confinamento à pasta, os passos nativos do Spec Kit e o `ask_user` continuam valendo. O Codex não executa comandos nem edita arquivos por conta própria.

**Why this priority**: Sem ferramentas, o fluxo Spec Kit e o autopiloto ficam impossíveis com este provedor. Se o Codex usasse o próprio shell ou o próprio editor, a política de aprovação do Maestro seria contornada.

**Independent Test**: Com um Codex simulado que chama as ferramentas do Maestro, verificar que uma escrita pede confirmação no modo `default`, que uma leitura não pede, que um script do Spec Kit é interceptado e que uma recusa volta ao modelo como erro.

**Acceptance Scenarios**:

1. **Given** o modo de aprovação `default`, **When** o modelo pede para escrever um arquivo, **Then** o diálogo de confirmação aparece com o diff e a escrita só acontece se o usuário aprovar.
2. **Given** qualquer modo, **When** o modelo pede para ler um arquivo fora da pasta de trabalho, **Then** a leitura é recusada como hoje.
3. **Given** um comando `/speckit.*`, **When** o modelo roda um script de `.specify/scripts/`, **Then** o passo nativo é executado e o JSON do script volta ao modelo.
4. **Given** o modelo chama `ask_user`, **When** o usuário responde, **Then** a resposta volta ao modelo.
5. **Given** chamadas de ferramenta durante o turno, **When** a transcrição é exibida, **Then** cada chamada e cada resultado aparecem como nos outros provedores (`⏺`/`⎿`).
6. **Given** o processo do Codex, **When** ele inicia, **Then** o shell, a edição de arquivos e as demais ferramentas próprias do Codex, os servidores MCP configurados pelo usuário e as regras e perfis do usuário não ficam disponíveis ao modelo. Só as ferramentas do Maestro ficam.
7. **Given** `--no-tools`, **When** o turno roda, **Then** só `ask_user` fica disponível, como nos outros provedores.
8. **Given** o autopiloto (`/autopilot`) com rotas apontando para `codex`, **When** uma história é executada, **Then** todos os passos funcionam como com os outros provedores.

---

### User Story 3 - Limites de uso e avisos claros (Priority: P2)

Como usuário, vejo em `/auth`, em `/model` e no README que o provedor "Codex" usa a assinatura do ChatGPT pelo Codex instalado. Quando o limite de uso da assinatura é atingido, o Maestro espera e tenta de novo, como já faz com os outros provedores, em vez de encerrar o turno.

**Why this priority**: Evita confusão sobre cobrança e mantém a regra de que a execução nunca para por limite de taxa. Não bloqueia o uso básico.

**Independent Test**: Abrir `/auth` e `/model` e conferir os textos. Simular o erro de limite de uso do Codex e conferir que o turno espera e reenvia.

**Acceptance Scenarios**:

1. **Given** o menu `/auth`, **When** é exibido, **Then** a opção "Codex" diz que usa a assinatura do ChatGPT pelo Codex instalado.
2. **Given** o seletor `/model`, **When** é exibido, **Then** o grupo `codex` indica "assinatura".
3. **Given** o Codex responde que o limite de uso foi atingido, **When** o turno está rodando, **Then** o Maestro avisa, espera (o tempo indicado pelo Codex ou o intervalo crescente padrão) e reenvia o mesmo pedido. O Esc interrompe a espera.
4. **Given** o README, **When** o usuário lê a seção de provedores, **Then** encontra como instalar e logar o Codex, como ativar o provedor e a diferença entre ele e os provedores por API.

---

### Edge Cases

- **Codex não instalado**: `/auth` → "Codex" mostra como instalar e oferece tentar de novo. O provedor fica "não configurado".
- **Codex instalado, mas não logado**: `/auth` explica que o login é feito no próprio Codex (`codex login`). O Maestro nunca inicia o login.
- **Codex logado por chave de API**: o login é aceito, com aviso de que consome créditos da API da OpenAI.
- **Modelo inexistente ou sem acesso na assinatura**: o erro do Codex aparece como erro do provedor, com a mensagem dele.
- **Processo termina sem resultado**: erro com a última linha útil da saída de erro, sem segredos.
- **Pedido de ferramenta depois do cancelamento**: a ferramenta não roda e o modelo recebe "cancelado".
- **Modo `-p`**: funciona igual aos outros provedores. O que exigiria confirmação é recusado.
- **Conversa muito longa**: o histórico vai pela entrada padrão do processo, nunca pela linha de comando, então o limite de tamanho da linha de comando do Windows não se aplica.
- **Imagens anexadas**: são enviadas ao Codex, se ele aceitar imagens no modo não interativo. Se não aceitar, o provedor declara que não suporta imagens e o Maestro avisa como já faz com o Qwen.
- **Pasta que não é um repositório git**: o provedor funciona mesmo assim.
- **Outro processo na máquina tenta usar as ferramentas do Maestro**: a ponte local só escuta em 127.0.0.1, numa porta aleatória, e exige um token aleatório por turno, como no `claude-code`.
- **Versão do Codex sem algum recurso exigido** (fluxo de eventos JSON, ferramentas próprias desligadas, MCP por linha de comando): `/auth` e o primeiro turno avisam qual versão mínima é necessária, em vez de rodar com as ferramentas próprias do Codex ligadas.

## Requirements *(mandatory)*

### Functional Requirements

**Provedor**

- **FR-001**: O sistema MUST oferecer um provedor `codex` que atende cada pedido executando o binário `codex` instalado pelo usuário no modo não interativo, com o histórico enviado pela entrada padrão.
- **FR-002**: O sistema MUST NOT ler, gravar, pedir, exibir ou repassar credenciais ou tokens do ChatGPT ou da OpenAI. A autenticação é inteiramente do Codex. Variáveis de ambiente com chave da OpenAI não são repassadas ao processo.
- **FR-003**: O provedor MUST vir desabilitado por padrão. Sem configuração, o comportamento atual não muda.
- **FR-004**: O provedor MUST ter modelo, lista de modelos e esforço de raciocínio configuráveis como os demais provedores, e o caminho do executável opcionalmente configurável.
- **FR-005**: O provedor MUST mostrar o texto da resposta à medida que o Codex o entrega, informar o uso de tokens ao fim e respeitar o cancelamento encerrando o processo e seus filhos.
- **FR-006**: O provedor MUST traduzir os erros do Codex (não logado, limite de uso, modelo inválido, falha do processo, executável ausente, versão incompatível) em erros do Maestro com categoria e mensagem sem segredos. O limite de uso vira erro de limite de taxa, com o tempo de espera quando o Codex o informar.
- **FR-007**: O processo do Codex MUST rodar sem ferramentas próprias (shell, edição de arquivos, navegador, busca e afins), sem os servidores MCP do usuário, sem regras e perfis do usuário e sem persistir a sessão em disco. Se a versão instalada não permitir isso, o provedor MUST recusar o turno com aviso, em vez de rodar com as ferramentas próprias ligadas.

**Ferramentas**

- **FR-008**: As ferramentas disponíveis no turno MUST ser expostas ao Codex pela mesma ponte local do `claude-code`: só em 127.0.0.1, numa porta aleatória, com um token aleatório por turno e encerrada ao fim do turno.
- **FR-009**: Cada chamada de ferramenta MUST passar pelo mesmo caminho dos outros provedores: validação da entrada, interceptação do Spec Kit, política de aprovação, confirmação e confinamento à pasta.
- **FR-010**: Chamadas e resultados MUST ser registrados no histórico da conversa como nos outros provedores, para aparecerem na transcrição e no contexto das outras rotas.
- **FR-011**: O turno MUST seguir as regras atuais: sem limite de rodadas por padrão (`tools.maxToolIterations`) e com espera e nova tentativa no limite de taxa.

**Configuração e avisos**

- **FR-012**: `/auth` MUST ter a opção "Codex". Ela localiza o executável, lê o estado de login pelo próprio Codex, mostra o método, habilita o provedor e oferece ativá-lo, sem nunca iniciar um login nem abrir arquivos de credenciais.
- **FR-013**: O provedor MUST aparecer em `/model`, `/routes`, na barra de status e na ajuda, com indicação de que usa a assinatura do ChatGPT.
- **FR-014**: O README MUST documentar o provedor: como instalar e logar o Codex, como ativá-lo, os modelos, a cobrança pela assinatura e as limitações.
- **FR-015**: Os logs MUST registrar só eventos e contagens do provedor (início, fim, ferramenta chamada, código de saída), nunca conteúdo, e-mail ou tokens.
- **FR-016**: O provedor `codex` MUST ser independente dos provedores por API. Habilitar ou desabilitar um não altera os outros.

### Key Entities

- **Configuração do provedor Codex**: habilitado, modelo, lista de modelos, esforço, caminho opcional do executável.
- **Estado do Codex**: instalado ou não, versão, logado ou não, método de login (conta do ChatGPT ou chave de API).
- **Ponte de ferramentas**: a mesma do `claude-code`. É um servidor local de um turno, com porta, token e a lista de ferramentas do turno.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Com o Codex logado pela conta do ChatGPT, uma conversa no Maestro pelo provedor `codex` não usa nenhuma chave de API.
- **SC-002**: O primeiro texto da resposta aparece em até 10 segundos depois do envio, em condições normais de rede.
- **SC-003**: Em 100% das chamadas de ferramenta, a política de aprovação produz a mesma decisão que produziria com o provedor `claude-code`.
- **SC-004**: Em 100% dos turnos, nenhum comando é executado nem arquivo é alterado fora das ferramentas do Maestro.
- **SC-005**: Nenhuma credencial do ChatGPT ou da OpenAI aparece em arquivos do Maestro, em logs ou na tela, o que é verificado pelos testes de segredos.
- **SC-006**: Um comando `/speckit.*` completo (specify até tasks) roda pelo provedor `codex` sem intervenção além das confirmações do modo de aprovação.
- **SC-007**: Sem configuração nova, a suíte de testes existente passa sem alterações de comportamento.

## Assumptions

- O usuário instala e faz login no Codex por conta própria (`codex login`). O Maestro só verifica o estado, com `codex login status`.
- O modo não interativo do Codex (`codex exec`) com eventos JSON, servidores MCP passados por linha de comando, sessão efêmera e configuração do usuário ignorada está disponível nas versões instaladas. Foi conferido na versão 0.161.0. Se dá para desligar todas as ferramentas próprias do Codex é decidido no plano. A spec exige o resultado (FR-007), não o mecanismo.
- O Codex pode entregar a resposta em blocos, e não letra a letra. A exibição em streaming aceita essa granularidade.
- Ajustes de `maxTokens` não se aplicam ao Codex. O esforço de raciocínio se aplica.
- Como no `claude-code`, o histórico vai como texto estruturado na entrada do primeiro pedido, e os resultados de ferramentas de turnos anteriores vão resumidos no mesmo texto.
- A ponte MCP, o caminho de ferramentas conduzido pelo provedor e a espera no limite de taxa já existem (specs/010, specs/011 e a correção de limites) e são reaproveitados.
