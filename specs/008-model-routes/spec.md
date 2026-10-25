# Feature Specification: Rotas por Modelo (chat, Spec Kit, GitHub, infra e comandos)

**Feature Branch**: `008-model-routes`  
**Created**: 2026-10-25  
**Status**: Draft  
**Input**: User description: "Implemente a questão das routes como vc propos: deve existir várias rotas diferentes, as que vc propos e que achar necessárias e: chat, todos os comandos do speckit, github, infra. Todos os comandos do maestro, incluindo os do speckit, devem ter uma rota própria. O comando /routes deve abrir uma tela no maestro onde eu possa configurar as rotas."

## Contexto

Hoje o Maestro conversa com **um** provedor/modelo ativo por vez (`/model` troca para a sessão inteira). Uma **rota** é um nome estável (`chat`, `github`, `infra`, `speckit.plan`, …) que aponta para um provedor e um modelo (e, opcionalmente, ajustes como esforço e tamanho máximo de resposta). Cada pedido do usuário é resolvido para uma rota antes de ir ao modelo: a conversa comum usa a rota `chat`; cada comando do Maestro (inclusive cada `/speckit.*`) usa a sua própria rota; pedidos explícitos sobre GitHub ou infraestrutura usam `github` e `infra`. Todas as rotas trabalham sobre a **mesma conversa**: o que o Claude respondeu na rota `chat` está no contexto quando o Qwen responde na rota `speckit.specify`, e vice-versa. O comando `/routes` abre uma tela para ver e alterar esse mapeamento sem editar arquivos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configurar as rotas numa tela e ver os comandos seguirem o mapeamento (Priority: P1)

Como usuário, abro `/routes`, vejo a lista de rotas com o provedor/modelo de cada uma, escolho uma rota (por exemplo `speckit.specify`), troco para `qwen / qwen3-coder-plus`, salvo e, a partir daí, `/speckit.specify …` roda no Qwen enquanto a conversa comum continua no Claude. A tela também permite voltar uma rota ao padrão ("segue `chat`").

**Why this priority**: É a entrega central: sem a tela e sem a resolução de rota por comando, o restante não tem como ser usado. Sozinha já permite dividir o trabalho entre dois modelos.

**Independent Test**: Abrir `/routes`, alterar a rota de um comando para outro provedor, salvar, executar o comando e confirmar na transcrição que a resposta veio do provedor/modelo configurado, enquanto uma mensagem comum vai para o modelo da rota `chat`.

**Acceptance Scenarios**:

1. **Given** dois provedores configurados, **When** o usuário digita `/routes`, **Then** uma tela lista todas as rotas (de propósito e de comando) com provedor e modelo de cada uma, marcando as que seguem o padrão e as que foram personalizadas.
2. **Given** a tela `/routes` aberta, **When** o usuário seleciona a rota `speckit.specify`, escolhe o provedor `qwen` e um modelo da lista dele e confirma, **Then** a configuração é gravada e a tela mostra a rota como personalizada.
3. **Given** `speckit.specify` roteado para o Qwen e `chat` para o Claude, **When** o usuário envia `/speckit.specify Adicionar login`, **Then** a resposta vem do Qwen e a transcrição indica a rota e o modelo usados; **When** em seguida envia "resuma o que fizemos", **Then** a resposta vem do Claude e inclui o que o Qwen produziu.
4. **Given** uma rota personalizada, **When** o usuário escolhe "voltar ao padrão", **Then** a rota passa a seguir `chat` e a configuração persiste sem a personalização.
5. **Given** a tela aberta, **When** o usuário aperta Esc, **Then** a tela fecha sem alterar nada.

---

### User Story 2 - Cada comando do Maestro tem a sua rota, incluindo todos os do Spec Kit (Priority: P1)

Como usuário, quero que cada comando que gera texto com um modelo (`/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.implement`, `/speckit.clarify`, `/speckit.analyze`, `/speckit.checklist`, `/speckit.constitution`, `/speckit.taskstoissues` e qualquer outro comando de prompt do projeto) apareça como uma rota própria, com padrão "segue `chat`", para que eu possa, por exemplo, planejar num modelo mais forte e implementar num mais barato.

**Why this priority**: É o pedido explícito do usuário e o caso de uso concreto que motiva as rotas. Depende da US1 para a tela, mas a resolução por comando é testável por configuração em arquivo.

**Independent Test**: Com rotas definidas em arquivo (sem a tela), executar dois comandos Spec Kit distintos e confirmar que cada um usou o provedor/modelo da sua rota; comandos recém-instalados por `/speckit.init` aparecem na lista de rotas sem configuração extra.

**Acceptance Scenarios**:

1. **Given** o Spec Kit instalado no projeto, **When** o usuário abre `/routes`, **Then** há uma rota para cada comando `/speckit.*` disponível, mais uma para cada comando de prompt de `.maestro/commands/` ou da pasta da integração, com o padrão "segue `chat`".
2. **Given** `speckit.plan` roteado para o Claude e `speckit.implement` para o Qwen, **When** o usuário executa os dois em sequência, **Then** cada um roda no modelo da sua rota, e o segundo vê na conversa o resultado do primeiro.
3. **Given** um comando que não chama o modelo (`/help`, `/clear`, `/model`, `/auth`, `/mouse`, `/routes`, `/speckit.init`, `/speckit.status`), **When** o usuário abre `/routes`, **Then** ele não aparece como rota (não há modelo a escolher), e a documentação explica o critério.
4. **Given** um comando novo instalado depois (`/speckit.init --upgrade` ou um arquivo novo em `.maestro/commands/`), **When** o usuário reabre `/routes`, **Then** a rota do comando novo aparece com o padrão, sem precisar reiniciar.

---

### User Story 3 - Rotas de propósito: chat, github, infra e `/ask` (Priority: P2)

Como usuário, quero rotas nomeadas por propósito, além das rotas de comando: `chat` (padrão da conversa), `github` (pull requests, issues, revisões, fluxo de branch) e `infra` (deploy, servidores, containers, CI). Quero enviar um pedido para uma rota específica com `/ask <rota> <pedido>` (ou pelo atalho `/<rota> <pedido>` para as rotas de propósito), sem trocar o modelo ativo, e quero poder criar rotas de propósito minhas (por exemplo `review` ou `docs`).

**Why this priority**: Dá uso imediato às rotas fora do Spec Kit e materializa o pedido de `github` e `infra`. Depende da resolução de rotas da US1/US2.

**Independent Test**: Com `github` roteado para um provedor diferente de `chat`, enviar `/ask github abra um PR desta branch` e confirmar que a resposta veio do provedor da rota, na mesma conversa, e que o modelo ativo não mudou.

**Acceptance Scenarios**:

1. **Given** as rotas padrão, **When** o usuário envia `/ask github resuma o PR #6`, **Then** o pedido roda na rota `github` e a resposta entra na conversa comum com a marca da rota; o cabeçalho continua mostrando o modelo ativo.
2. **Given** `infra` com o atalho habilitado, **When** o usuário envia `/infra como escalar o container?`, **Then** o efeito é o mesmo de `/ask infra …`.
3. **Given** a tela `/routes`, **When** o usuário cria a rota `review` apontando para `claude / claude-sonnet-5-5`, **Then** `/ask review …` passa a funcionar e `/help` lista a rota nova.
4. **Given** `/ask` sem rota ou com rota inexistente, **When** o usuário envia, **Then** recebe um aviso com as rotas disponíveis e nada é enviado ao modelo.
5. **Given** uma rota de propósito, **When** o usuário a remove na tela, **Then** `chat`, `github` e `infra` não podem ser removidas (apenas redefinidas), e rotas criadas pelo usuário podem.

---

### User Story 4 - Contexto compartilhado, indisponibilidade e visibilidade (Priority: P2)

Como usuário, quero que qualquer rota veja toda a conversa até ali, que a transcrição deixe claro qual rota/modelo respondeu cada mensagem, e que, se o provedor de uma rota não estiver configurado ou falhar antes de responder, o Maestro avise e use a rota `chat` em vez de deixar o comando sem resposta.

**Why this priority**: Sem contexto compartilhado as rotas viram sessões separadas, contrariando o objetivo; sem o fallback, uma rota mal configurada bloqueia o Spec Kit. É transversal às demais histórias.

**Independent Test**: Rotear um comando para um provedor sem credenciais, executar o comando e confirmar o aviso e a execução na rota `chat`; em outra execução, perguntar a um modelo de outra rota sobre algo dito ao primeiro e confirmar que a resposta considera o histórico.

**Acceptance Scenarios**:

1. **Given** uma mensagem respondida na rota `chat` pelo Claude, **When** um comando roteado ao Qwen é executado, **Then** o pedido enviado ao Qwen contém a conversa completa anterior (com as mensagens de ambos os modelos).
2. **Given** uma rota apontando para um provedor sem credenciais ou desabilitado, **When** o usuário executa o comando dessa rota, **Then** um aviso nomeia a rota e o motivo, e o comando roda na rota `chat`; a tela `/routes` marca a rota como indisponível.
3. **Given** a rota `chat` apontando para um provedor indisponível, **When** o usuário envia uma mensagem, **Then** o Maestro usa o provedor ativo configurado (comportamento atual) e avisa uma vez por sessão.
4. **Given** respostas de rotas diferentes na mesma conversa, **When** o usuário rola a transcrição, **Then** cada resposta vinda de uma rota diferente da `chat` mostra a rota e o provedor/modelo; a barra de status mostra a rota em uso enquanto a resposta é gerada.
5. **Given** o modo `-p`, **When** o usuário passa um comando com rota configurada, **Then** a rota é respeitada; `--route <rota>` força uma rota para o pedido inteiro.

---

### Edge Cases

- Uma rota aponta para um modelo que não está na lista do provedor: aceita (o nome é passado ao provedor) e a tela marca "modelo fora do catálogo"; o nome entra no catálogo como já acontece no `/model`.
- Rota de comando configurada para um comando que deixou de existir (arquivo removido): a configuração é mantida, mas a tela a mostra como "comando ausente" e permite removê-la.
- Troca de modelo por `/model` durante a sessão: muda apenas o provedor ativo; a rota `chat` padrão **segue o provedor ativo**, então `/model` continua funcionando como hoje. Uma rota `chat` personalizada ignora `/model` até ser redefinida (a tela avisa).
- Troca de rota no meio de uma resposta em geração: a tela `/routes` não abre enquanto o modelo responde (mesma regra dos diálogos atuais).
- `/ask <rota>` dentro de um comando de prompt (`/speckit.specify /ask github …`): o texto é tratado como argumento do comando, não como novo comando.
- Dois provedores com protocolos diferentes na mesma conversa: as chamadas de ferramenta e resultados anteriores continuam no histórico neutro e são convertidos para cada provedor como hoje; anexos de imagem só vão a provedores que os aceitam (regra da feature 007).
- Configuração de rotas por projeto: `./.maestro/settings.json` sobrescreve rota a rota o arquivo global; a tela mostra de onde veio cada valor e grava no arquivo global, avisando quando o projeto sobrescreve.
- Nome de rota inválido (espaços, `/`, maiúsculas) na configuração: rejeitado na validação com o caminho da chave, como as demais chaves.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST manter um conjunto de **rotas nomeadas**, cada uma apontando para um provedor e um modelo (e opcionalmente ajustes de esforço e tamanho máximo de resposta do provedor), persistido na configuração do usuário e sobreposto pela configuração do projeto, chave a chave.
- **FR-002**: O sistema MUST ter as rotas de propósito fixas `chat`, `github` e `infra`, e MUST permitir rotas de propósito criadas pelo usuário; `chat`, `github` e `infra` podem ser redefinidas, mas não removidas.
- **FR-003**: O sistema MUST expor uma rota para **cada comando que envia um prompt ao modelo** (todos os `/speckit.*` de prompt e todo comando de prompt descoberto em `.maestro/commands/` ou na pasta da integração), identificada pelo nome do comando; comandos que não chamam o modelo não têm rota.
- **FR-004**: Toda rota de comando MUST ter como padrão "segue `chat`"; a rota `chat` MUST ter como padrão "segue o provedor/modelo ativo" (o que `/model` controla), preservando o comportamento atual quando nada está configurado.
- **FR-005**: Ao executar um pedido, o sistema MUST resolver a rota na ordem: rota forçada (`/ask <rota>`, atalho `/<rota>`, `--route`) → rota do comando → `chat`, e MUST usar o provedor/modelo resolvido **apenas para aquele turno**, sem alterar o provedor ativo da sessão.
- **FR-006**: Todas as rotas MUST operar sobre a mesma conversa: o histórico completo (mensagens de usuário, respostas de qualquer rota, chamadas e resultados de ferramentas) é enviado a qualquer rota, convertido para o protocolo do provedor como hoje.
- **FR-007**: A transcrição MUST identificar a rota e o provedor/modelo de cada resposta produzida por uma rota diferente da `chat`, e a barra de status MUST mostrar a rota em uso enquanto a resposta é gerada.
- **FR-008**: O comando `/routes` MUST abrir uma tela na própria interface que lista todas as rotas (propósito e comando) com provedor, modelo, origem do valor (padrão, global, projeto) e disponibilidade, e MUST permitir: escolher provedor e modelo a partir do catálogo (com "digitar outro modelo"), voltar ao padrão, criar e remover rotas de propósito do usuário, e cancelar com Esc sem gravar.
- **FR-009**: Alterações feitas na tela MUST ser gravadas na configuração global de forma validada e atômica, preservando comentários, e MUST valer imediatamente na sessão, sem reinício.
- **FR-010**: `/ask <rota> <pedido>` MUST enviar o pedido pela rota indicada; para rotas de propósito, o atalho `/<rota> <pedido>` MUST ter o mesmo efeito quando não colidir com um comando existente (colisão → o comando vence e a tela avisa).
- **FR-011**: Se o provedor de uma rota estiver indisponível (não configurado, desabilitado, sem credenciais), o sistema MUST avisar com o nome da rota e o motivo e MUST executar o pedido pela rota `chat`; se a própria `chat` estiver indisponível, MUST usar o provedor ativo e avisar uma vez por sessão.
- **FR-012**: A lista de rotas de comando MUST refletir os comandos disponíveis no momento (inclusive após `/speckit.init`), sem reinício; configurações de comandos ausentes MUST ser mantidas, sinalizadas e removíveis.
- **FR-013**: `/help` MUST listar `/routes`, `/ask` e os atalhos de rotas de propósito; `-p` MUST respeitar as rotas configuradas e aceitar `--route <rota>`.
- **FR-014**: Nomes de rota MUST seguir um formato único (minúsculas, dígitos, `.`, `-` e `_`), validados com mensagem que aponta a chave inválida; o modelo de uma rota MUST ser um nome único sem espaços.
- **FR-015**: Nenhuma credencial MUST aparecer na tela `/routes` nem nos logs; os logs MUST registrar apenas nome da rota, provedor e modelo resolvidos por turno.

### Key Entities *(include if feature involves data)*

- **Rota**: nome único; tipo (propósito ou comando); alvo (provedor + modelo + ajustes opcionais) ou "segue outra rota" (`chat`, ou o ativo no caso da `chat`); origem do valor (padrão / global / projeto); disponibilidade calculada a partir do estado do provedor.
- **Resolução de rota**: para um pedido, a cadeia rota forçada → rota do comando → `chat` → provedor ativo, com o motivo de cada salto (útil para o aviso e para o log).
- **Turno roteado**: um turno da conversa executado com o provedor/modelo de uma rota; as mensagens resultantes carregam a rota e o modelo para a transcrição.
- **Configuração de rotas**: a seção `routes` dos arquivos de configuração (global e projeto), com validação e precedência iguais às demais seções.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um usuário com dois provedores configurados consegue, apenas pela tela `/routes`, colocar um comando Spec Kit num provedor e a conversa noutro em menos de 1 minuto, sem editar arquivos.
- **SC-002**: 100% dos comandos de prompt disponíveis (Spec Kit e projeto) aparecem como rotas; nenhum comando sem modelo aparece.
- **SC-003**: Em uma conversa com respostas de duas rotas, 100% das respostas de rotas diferentes da `chat` mostram rota e modelo na transcrição.
- **SC-004**: Um pedido enviado por qualquer rota contém 100% do histórico anterior da conversa (verificável pelo conteúdo enviado ao provedor).
- **SC-005**: Com uma rota apontando para um provedor indisponível, o comando conclui pela rota `chat` com um aviso em 100% dos casos; nenhum comando fica sem resposta por configuração de rota.
- **SC-006**: Sem nenhuma configuração de rotas, o comportamento do Maestro é idêntico ao atual (todos os testes existentes continuam passando).

## Assumptions

- As rotas resolvem **provedor + modelo**; a execução paralela de sub-agentes (fork de sessão, ferramenta `delegate`) e o carregamento de agentes/skills de arquivo ficam para features seguintes, como proposto antes. Esta feature entrega a referência de modelo, a resolução por comando/propósito, o `/ask` e a tela.
- `github` e `infra` são rotas de propósito: o Maestro não classifica pedidos automaticamente como "de GitHub" ou "de infra"; o usuário as aciona por `/ask github …`, `/github …`, `/infra …` ou atribuindo-as a comandos. Elas vêm com um texto de sistema curto que orienta o modelo para o tema (fluxo de branch/PR/issues; deploy/CI/containers), editável no futuro.
- A rota `chat` por padrão segue o provedor ativo, para que `/model` continue sendo o jeito rápido de trocar o modelo da conversa.
- A tela `/routes` segue o padrão dos diálogos existentes (`/model`, `/auth`): lista navegável por ↑/↓, Enter seleciona, Esc volta/fecha, campos de texto para "outro modelo" e "nova rota". Gravação no arquivo global; o arquivo de projeto é lido, mostrado como origem, mas não editado pela tela.
- Um turno roteado herda o modo de aprovação, as ferramentas e os limites da sessão; apenas provedor, modelo e ajustes mudam.
- Em `-p`, `--route` força a rota do pedido; sem ela, valem as rotas da configuração.
- Os provedores disponíveis continuam sendo `claude` e `qwen`; rotas podem apontar para qualquer um deles e para qualquer modelo aceito pelo provedor.
