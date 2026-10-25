# Feature Specification: Histórico de Entradas e Catálogo de Modelos por Provedor

**Feature Branch**: `004-history-model-catalog`  
**Created**: 2026-10-25  
**Status**: Draft  
**Input**: User description: "Melhorias: deve guardar um histórico de comandos, apertando seta para cima e para baixo deve mover no histórico, igual o claude code; no comando /model ao selecionar 'Digitar outro modelo…', deve dar a opção de escolher entre claude e qwen; quando digitar esse novo modelo ele passa a ficar disponível na lista; os modelos disponíveis para aquela LLM devem ficar listados no arquivo de configuração."

## Visão Geral

Hoje o Maestro lembra apenas as mensagens da conversa atual: ao reabrir o programa o histórico some, os comandos `/` nunca entram nele, `/clear` o apaga e o texto que estava sendo digitado se perde ao navegar. Já o seletor `/model` conhece um único modelo por provedor (o configurado); "Digitar outro modelo…" assume o provedor ativo, e o nome digitado não fica guardado para a próxima vez.

Esta feature traz dois conjuntos de melhorias de uso diário:

1. **Histórico de entradas persistente**, no espírito do Claude Code: tudo que o usuário envia pelo prompt (mensagens e comandos `/`) fica guardado entre sessões, e ↑/↓ percorrem esse histórico a partir do mais recente, preservando o texto em edição.
2. **Catálogo de modelos por provedor**: o arquivo de configuração lista os modelos disponíveis de cada provedor; o seletor `/model` mostra todos eles agrupados por provedor; "Digitar outro modelo…" pede antes para qual provedor (Claude ou Qwen) o modelo é, e o nome digitado entra no catálogo e passa a aparecer na lista nas próximas vezes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navegar pelo histórico de entradas com ↑/↓ (Priority: P1)

Durante a sessão, o usuário aperta ↑ com o prompt vazio e vê a última entrada enviada (mensagem ou comando `/`) aparecer no prompt; apertando ↑ de novo volta mais no tempo; ↓ avança até retornar ao texto que estava digitando antes de começar a navegar (ou ao prompt vazio). Enter envia a entrada recuperada, podendo editá‑la antes. O histórico sobrevive ao fechamento do Maestro: ao abrir de novo no dia seguinte, ↑ recupera as entradas da sessão anterior. É o mesmo comportamento do Claude Code.

**Why this priority**: É o pedido principal e o de maior impacto diário: repetir comandos (`/model …`, perguntas longas) hoje exige redigitar tudo, e o histórico atual é perdido a cada execução.

**Independent Test**: Enviar três entradas (uma mensagem, `/model`, outra mensagem), fechar o Maestro, reabrir, apertar ↑ três vezes e verificar que as três entradas aparecem na ordem inversa; apertar ↓ até voltar ao prompt vazio. Digitar um texto parcial, apertar ↑ e depois ↓ e verificar que o texto parcial volta intacto.

**Acceptance Scenarios**:

1. **Given** um prompt vazio e um histórico com entradas, **When** o usuário aperta ↑, **Then** o prompt passa a mostrar a entrada mais recente; a cada ↑ seguinte mostra a anterior, parando na mais antiga.
2. **Given** o usuário navegando no histórico, **When** aperta ↓, **Then** o prompt avança para a entrada mais recente seguinte e, após a última, volta ao texto que estava sendo digitado antes de navegar (ou vazio).
3. **Given** uma entrada recuperada do histórico, **When** o usuário a edita e aperta Enter, **Then** a versão editada é enviada e passa a ser a entrada mais recente do histórico; a original permanece no histórico.
4. **Given** o Maestro foi fechado e reaberto (mesmo usuário, mesma máquina), **When** o usuário aperta ↑, **Then** as entradas da sessão anterior estão disponíveis, da mais recente para a mais antiga.
5. **Given** o prompt está ativo, **When** o usuário aperta ↑ ou ↓, **Then** apenas o histórico reage; a transcrição não rola. A rolagem continua disponível por Shift+↑/↓, PageUp/PageDown, Home/End e roda do mouse.
6. **Given** a entrada enviada é idêntica à última do histórico, **When** é enviada de novo, **Then** não gera entrada duplicada consecutiva; ela vai para o topo uma única vez.
7. **Given** um diálogo (`/auth`, `/model`) aberto, **When** o usuário digita nos campos do diálogo, **Then** nada disso entra no histórico de entradas (campos de diálogo, incluindo chaves, nunca são guardados).
8. **Given** o usuário começou a digitar algo e navegou no histórico, **When** envia uma entrada recuperada, **Then** o rascunho anterior não é perdido silenciosamente: ele é descartado apenas se o usuário o substituiu de propósito (ou seja, ↓ até o fim sempre o devolve antes do envio).
9. **Given** o modo não interativo (`-p`), **When** uma entrada é processada, **Then** ela não é adicionada ao histórico interativo.

---

### User Story 2 - Catálogo de modelos por provedor no arquivo de configuração e no `/model` (Priority: P1)

O arquivo de configuração passa a listar, para cada provedor, os modelos disponíveis (por exemplo, para Claude: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`; para Qwen: `qwen3-coder-plus`, `qwen3-max`, …), com uma lista padrão criada na primeira execução. O seletor `/model` mostra todos os modelos de todos os provedores configurados, agrupados por provedor, com o ativo marcado; o usuário escolhe um deles para ativá‑lo (provedor e modelo passam a ser os ativos e são gravados). Quem prefere editar o arquivo pode adicionar ou remover modelos da lista diretamente.

**Why this priority**: É o que dá sentido às demais melhorias do `/model`: sem o catálogo, só existe "o modelo configurado" e não há onde o modelo digitado "ficar disponível".

**Independent Test**: Partindo de uma configuração nova, abrir `/model` e verificar que aparecem os modelos padrão de cada provedor configurado, agrupados; escolher um modelo de outro provedor e verificar que a próxima mensagem vai para ele; adicionar um modelo à lista no arquivo, reabrir `/model` e vê‑lo na lista.

**Acceptance Scenarios**:

1. **Given** a primeira execução do Maestro, **When** o arquivo de configuração é criado, **Then** cada provedor traz uma lista de modelos padrão, e o modelo configurado faz parte dela.
2. **Given** provedores configurados, **When** o usuário abre `/model`, **Then** a lista mostra os modelos de cada provedor agrupados sob o nome do provedor, o modelo ativo marcado, e os modelos de provedores não configurados aparecem indisponíveis (com indicação de como configurar).
3. **Given** a lista aberta, **When** o usuário escolhe um modelo de outro provedor configurado, **Then** o Maestro troca provedor e modelo ativos, preserva a conversa, e grava a escolha para as próximas sessões.
4. **Given** o arquivo de configuração com um modelo acrescentado à lista de um provedor, **When** o usuário reabre o Maestro e `/model`, **Then** o novo modelo aparece na lista desse provedor.
5. **Given** o arquivo de configuração com lista vazia ou ausente para um provedor, **When** o Maestro inicia, **Then** a lista padrão desse provedor é usada e nenhum erro é exibido.
6. **Given** uma lista com entrada inválida (vazia, repetida, com espaços), **When** o Maestro inicia, **Then** a configuração é rejeitada com mensagem apontando o campo, como já acontece com os demais erros de configuração.
7. **Given** o modo não interativo (`-p`) ou `/model` por texto, **When** o usuário lista modelos (`/model` sem diálogo), **Then** a saída textual mostra os modelos de cada provedor com o ativo marcado.

---

### User Story 3 - "Digitar outro modelo…" escolhe o provedor e aprende o modelo (Priority: P2)

No `/model`, ao escolher "Digitar outro modelo…", o usuário primeiro escolhe para qual provedor o modelo é (Claude ou Qwen, com indicação de quais estão configurados), depois digita o nome. Ao confirmar, o modelo é ativado para aquele provedor e acrescentado ao catálogo do provedor no arquivo de configuração, passando a aparecer na lista nas próximas aberturas de `/model`. Se o nome já existir no catálogo, apenas é ativado, sem duplicar.

**Why this priority**: Completa o fluxo: hoje a opção assume o provedor ativo e esquece o nome digitado. Depende do catálogo da US2.

**Independent Test**: Abrir `/model`, escolher "Digitar outro modelo…", escolher Qwen, digitar `qwen3-max`, confirmar; verificar que a mensagem seguinte vai para o Qwen com esse modelo, que o arquivo passou a listar `qwen3-max` em Qwen, e que ao reabrir `/model` o modelo aparece na lista do Qwen.

**Acceptance Scenarios**:

1. **Given** o seletor `/model` aberto, **When** o usuário escolhe "Digitar outro modelo…", **Then** aparece a escolha do provedor (Claude, Qwen) com o estado de cada um; provedores não configurados ficam indisponíveis para seleção, com indicação de usar `/auth`.
2. **Given** o provedor escolhido, **When** o usuário digita um nome e confirma, **Then** o modelo é ativado para esse provedor, gravado como modelo ativo e acrescentado à lista de modelos do provedor no arquivo.
3. **Given** um nome já presente na lista do provedor, **When** confirmado, **Then** o modelo é ativado e a lista não ganha duplicata.
4. **Given** um nome vazio ou só com espaços, **When** confirmado, **Then** o diálogo mostra "informe o modelo" e permanece no campo.
5. **Given** a etapa de digitação, **When** o usuário aperta Esc, **Then** volta à escolha do provedor; Esc de novo volta à lista.
6. **Given** a forma por texto `/model <provedor> <modelo>`, **When** o modelo não está na lista do provedor, **Then** ele também é acrescentado à lista (mesmo comportamento do diálogo).
7. **Given** a gravação no arquivo falha (sem permissão), **When** o usuário confirma, **Then** o modelo vale para a sessão atual e um aviso informa que não foi gravado.

---

### Edge Cases

- Histórico muito grande: o Maestro mantém apenas as entradas mais recentes (limite fixo, ver Assumptions) e descarta as mais antigas sem avisar.
- Arquivo de histórico corrompido ou ilegível: a sessão inicia com histórico vazio e registra a causa no log de diagnóstico; o arquivo é recriado na próxima entrada.
- Duas instâncias do Maestro abertas ao mesmo tempo: cada uma acrescenta suas entradas; a leitura é feita na abertura, então entradas da outra instância só aparecem na próxima execução. Não há perda de entradas de nenhuma das duas.
- Entradas com várias linhas (coladas): são guardadas e recuperadas íntegras, com as quebras de linha.
- Entradas que contenham segredos digitados no prompt (por exemplo, alguém colar uma chave): ficam no histórico como qualquer entrada, pois o Maestro não tem como distinguir; o arquivo fica na pasta pessoal do usuário com a mesma proteção do `settings.json`. Campos de diálogo (onde as chaves são realmente informadas) nunca entram no histórico.
- Projeto com `./.maestro/settings.json` que define a lista de modelos de um provedor: a lista do projeto substitui a global para aquele provedor (mesma regra chave‑a‑chave já usada), e um modelo digitado é gravado no arquivo global, com aviso quando o projeto sobrescreve.
- Modelo ativo que não está na lista (arquivo editado à mão): o `/model` mostra o ativo marcado mesmo assim, no grupo do seu provedor, e o acrescenta à lista na próxima gravação.
- Usuário remove da lista o modelo ativo: continua ativo até ser trocado; a lista apenas não o oferece mais.

## Requirements *(mandatory)*

### Functional Requirements

**Histórico de entradas**

- **FR-001**: O Maestro MUST guardar cada entrada enviada pelo prompt interativo (mensagens e comandos `/`) em um histórico persistente por usuário, que sobrevive ao fechamento do programa.
- **FR-002**: Com o prompt ativo, ↑ MUST substituir o conteúdo do prompt pela entrada anterior do histórico (da mais recente para a mais antiga) e ↓ MUST avançar no sentido inverso até devolver o texto que estava em edição antes da navegação.
- **FR-003**: Enquanto o prompt está ativo, ↑/↓ sem modificador MUST atuar apenas no histórico; a rolagem da transcrição MUST continuar disponível por Shift+↑/↓, PageUp/PageDown, Home/End e roda do mouse.
- **FR-004**: O histórico MUST NOT receber duas entradas idênticas consecutivas, texto vazio, entradas digitadas em campos de diálogo, nem entradas do modo não interativo.
- **FR-005**: O histórico MUST ter um limite de entradas; ao excedê‑lo, as mais antigas são descartadas.
- **FR-006**: Falhas ao ler ou gravar o histórico MUST NOT impedir o uso do Maestro; a sessão segue com histórico vazio e o motivo vai para o log de diagnóstico.
- **FR-007**: Entradas com várias linhas MUST ser preservadas integralmente.

**Catálogo de modelos**

- **FR-008**: O arquivo de configuração MUST permitir, por provedor, uma lista de modelos disponíveis; a primeira execução MUST criar essa lista com valores padrão para cada provedor.
- **FR-009**: Quando a lista de um provedor estiver ausente ou vazia, o Maestro MUST usar a lista padrão daquele provedor. O modelo configurado do provedor MUST ser sempre considerado disponível, mesmo que não esteja na lista.
- **FR-010**: Listas com entradas vazias, com espaços ou repetidas MUST ser rejeitadas na validação da configuração, com mensagem indicando o caminho do campo.
- **FR-011**: O seletor `/model` MUST exibir todos os modelos de todos os provedores, agrupados por provedor, com o modelo ativo marcado; modelos de provedores não configurados MUST aparecer indisponíveis com orientação para `/auth`.
- **FR-012**: Selecionar um modelo no seletor MUST tornar ativos o provedor e o modelo escolhidos, preservar a conversa e gravar a escolha para sessões futuras.
- **FR-013**: A saída textual de `/model` (modo não interativo ou listagem por texto) MUST listar os modelos por provedor com o ativo marcado.

**Digitar outro modelo**

- **FR-014**: "Digitar outro modelo…" MUST pedir primeiro o provedor (entre os existentes: Claude e Qwen), mostrando o estado de cada um e impedindo a escolha de provedores não configurados.
- **FR-015**: Ao confirmar um nome de modelo, o Maestro MUST ativá‑lo para o provedor escolhido e acrescentá‑lo à lista de modelos desse provedor no arquivo de configuração, sem duplicar nomes já existentes.
- **FR-016**: A forma por texto `/model <provedor> <modelo>` MUST acrescentar o modelo à lista do provedor da mesma forma.
- **FR-017**: Se a gravação falhar, o modelo MUST valer para a sessão atual e o usuário MUST ser avisado de que não foi gravado.
- **FR-018**: Nomes vazios ou só com espaços MUST ser recusados com mensagem no próprio campo; espaços nas extremidades MUST ser removidos antes de gravar.

### Key Entities

- **Entrada do histórico**: um texto enviado pelo prompt interativo (mensagem ou comando `/`), com o momento do envio. Ordenado do mais antigo ao mais recente; sem duplicatas consecutivas; limitado em quantidade.
- **Histórico de entradas**: coleção persistente por usuário, carregada na abertura da sessão e acrescida a cada envio.
- **Catálogo de modelos do provedor**: lista ordenada de nomes de modelo associada a um provedor no arquivo de configuração, com uma lista padrão por provedor; contém implicitamente o modelo configurado.
- **Seleção ativa**: par provedor + modelo em uso na sessão, gravado no arquivo de configuração (já existente; passa a ser alimentado também pelo catálogo).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Após fechar e reabrir o Maestro, 100% das entradas enviadas na sessão anterior (até o limite do histórico) são recuperáveis com ↑ em ordem inversa.
- **SC-002**: Reenviar o último comando usado leva no máximo 2 teclas (↑ e Enter), contra redigitar o comando inteiro hoje.
- **SC-003**: Durante a navegação no histórico, a transcrição não se move em nenhum dos casos de teste (0 ocorrências de rolagem acidental com ↑/↓ sem modificador).
- **SC-004**: Um modelo digitado em "Digitar outro modelo…" aparece na lista do seu provedor em 100% das reaberturas de `/model`, inclusive após reiniciar o programa.
- **SC-005**: Trocar para qualquer modelo listado de um provedor configurado leva no máximo 3 teclas a partir de `/model` aberto (navegar e Enter), sem digitar o nome.
- **SC-006**: Nenhum valor digitado em campos de diálogo (`/auth`, `/model`) aparece no arquivo de histórico; verificado pelos testes de segurança existentes, estendidos ao histórico.
- **SC-007**: O arquivo de configuração gerado na primeira execução valida sem erros e lista ao menos um modelo por provedor.

## Assumptions

- "Igual o Claude Code": histórico por usuário, persistido em arquivo na pasta pessoal do Maestro (ao lado do `settings.json`), compartilhado entre projetos, navegado com ↑/↓ a partir do mais recente, com o rascunho preservado ao voltar com ↓. Busca no histórico (Ctrl+R) e histórico por projeto ficam fora do escopo.
- Limite do histórico: 1.000 entradas mais recentes.
- O histórico guarda apenas o texto e o momento do envio; não guarda respostas do modelo nem resultados de ferramentas.
- O histórico é acrescentado a cada envio (não apenas ao sair), para que nada se perca se o programa for encerrado abruptamente.
- Listas padrão de modelos: Claude — `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`; Qwen — `qwen3-coder-plus`, `qwen3-coder-flash`, `qwen3-max`. São sugestões iniciais; o usuário pode editá‑las livremente.
- A lista de modelos do projeto (`./.maestro/settings.json`) substitui a global para aquele provedor, seguindo a precedência já existente; novos modelos digitados são gravados no arquivo global, com aviso quando o projeto sobrescreve o campo.
- Os provedores continuam sendo os dois existentes (Claude e Qwen); a escolha de provedor em "Digitar outro modelo…" lista apenas eles.
- O Maestro não valida se o nome de modelo digitado existe no provedor antes de gravar; um nome inválido se manifesta na primeira mensagem, com o erro já previsto para "modelo desconhecido", e o usuário pode removê‑lo editando o arquivo.
- As demais funções do `/model` (forma por texto, recusa durante geração, comportamento em `-p`) permanecem como na feature 003.
