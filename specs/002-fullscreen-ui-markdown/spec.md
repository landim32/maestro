# Feature Specification: Interface de Tela Cheia, Rolagem Interna, Banner e Markdown

**Feature Branch**: `002-fullscreen-ui-markdown`  
**Created**: 2026-10-24  
**Status**: Draft  
**Input**: User description: "Correções: ao digitar cada letra, está crescendo a barra de rolagem; deve ocupar toda a tela de console; deve ter uma barra de rolagem interna; deve iniciar com uma arte em ANSI com o texto 'Maestro'; o retorno do modelo de IA está em markdown, o maestro deve formatar no mesmo estilo do qwen; verifique como está funcionando no https://github.com/QwenLM/qwen-code"

## Visão Geral

A primeira versão do Maestro (feature 001) funciona, mas a experiência visual no terminal ficou abaixo do qwen code, que é a referência declarada do projeto. Esta feature corrige quatro problemas percebidos no primeiro uso real:

1. **Instabilidade ao digitar**: cada tecla pressionada faz a área de rolagem do terminal crescer, deixando "rastros" da interface no histórico do console.
2. **Uso da tela**: a interface deve ocupar toda a área visível do console, com cabeçalho e prompt fixos, em vez de uma faixa que cresce para baixo.
3. **Rolagem interna**: a conversa deve rolar dentro da interface, com indicador de posição, sem depender da barra de rolagem do emulador de terminal.
4. **Apresentação**: ao iniciar, um banner em arte ANSI com o texto "Maestro"; e as respostas do modelo, que chegam em markdown, devem ser formatadas (títulos, listas, negrito, código com destaque) no mesmo estilo visual do qwen code.

O qwen code é a referência de aparência e comportamento; esta spec descreve o resultado esperado, não a forma de construí‑lo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Interface estável que ocupa a tela inteira (Priority: P1)

Ao executar `maestro`, a interface toma toda a área visível do console: banner e cabeçalho no topo, área da conversa no meio, prompt de entrada e barra de status fixos na base. Enquanto o usuário digita, nada "sobe" nem "desce": o console não ganha novas linhas de rolagem, e o prompt permanece no mesmo lugar. Ao redimensionar a janela do terminal, a interface se reorganiza para o novo tamanho. Ao sair, o console volta exatamente ao estado anterior ao `maestro` (o que estava na tela antes continua lá, sem rastros da interface).

**Why this priority**: É o defeito mais visível e o que mais prejudica o uso: a cada letra a tela "treme" e o histórico do terminal fica poluído. Sem isso resolvido, os demais ajustes visuais não fazem diferença.

**Independent Test**: Abrir um terminal com 40 linhas de altura, rodar `maestro`, digitar 200 caracteres sem enviar e verificar que a barra de rolagem do terminal não se move e o prompt não muda de posição; enviar uma pergunta que gere resposta longa e verificar o mesmo; sair com `/exit` e verificar que o conteúdo anterior do console está intacto.

**Acceptance Scenarios**:

1. **Given** o Maestro em execução em um terminal de 30 linhas, **When** o usuário digita 100 caracteres no prompt, **Then** a barra de rolagem do emulador de terminal não cresce e nenhum conteúdo anterior é duplicado na tela.
2. **Given** o Maestro em execução, **When** a janela é redimensionada de 120×40 para 80×25 colunas×linhas, **Then** a interface se reorganiza em até 1 segundo, sem linhas quebradas sobrepostas, com prompt e barra de status ainda visíveis na base.
3. **Given** o Maestro em execução, **When** o modelo envia uma resposta com mais linhas do que cabem na área da conversa, **Then** o prompt e a barra de status continuam fixos na base e a área da conversa mostra o final da resposta (acompanha o streaming).
4. **Given** o Maestro em execução a partir de um console que já tinha saída de comandos anteriores, **When** o usuário sai, **Then** a saída anterior reaparece como estava, sem a interface do Maestro no histórico de rolagem do terminal.
5. **Given** o terminal com menos de 12 linhas ou 40 colunas, **When** o Maestro é executado, **Then** ele informa o tamanho mínimo necessário em uma linha e ainda assim funciona, degradando para layout compacto (sem banner).

---

### User Story 2 - Rolar a conversa dentro da interface (Priority: P1)

A conversa pode ser mais longa do que a área visível. O usuário rola o histórico para cima e para baixo com teclado (Page Up/Page Down, e também com a roda do mouse quando o terminal a suporta) sem sair da interface. Um indicador na lateral direita da área da conversa mostra a posição atual (uma "barra de rolagem interna"). Quando o usuário está no final da conversa, novas mensagens e o streaming mantêm a visão "colada" no final; se o usuário rolou para cima, a visão fica onde está e um aviso discreto indica que há conteúdo novo abaixo.

**Why this priority**: Complementa a história 1: ao fixar a interface na tela, o histórico deixa de ser acessível pela rolagem do terminal, portanto a rolagem interna passa a ser obrigatória para rever respostas anteriores.

**Independent Test**: Gerar uma conversa com 5 respostas longas; pressionar Page Up repetidamente e verificar que o histórico anterior aparece e o indicador sobe; enviar nova mensagem com a visão rolada para cima e verificar o aviso de conteúdo novo; pressionar End e verificar que a visão volta ao final.

**Acceptance Scenarios**:

1. **Given** uma conversa maior que a área visível, **When** o usuário pressiona Page Up, **Then** a área da conversa exibe o conteúdo anterior (aproximadamente uma tela acima) e o indicador de posição se move proporcionalmente.
2. **Given** a visão rolada para cima, **When** o usuário pressiona Page Down até o fim ou pressiona End, **Then** a visão volta ao final da conversa e o indicador fica na base.
3. **Given** a visão no final da conversa, **When** o modelo está transmitindo uma resposta, **Then** a visão acompanha o texto novo automaticamente.
4. **Given** a visão rolada para cima, **When** chega uma resposta nova, **Then** a visão não se move e aparece um aviso discreto (ex.: "↓ novo conteúdo") até o usuário voltar ao final.
5. **Given** um terminal que reporta eventos de roda do mouse, **When** o usuário gira a roda sobre a conversa, **Then** a visão rola na direção correspondente; em terminais sem suporte, as teclas continuam funcionando e nada quebra.
6. **Given** a visão rolada para cima, **When** o usuário digita e envia uma mensagem, **Then** a visão salta para o final para mostrar a própria mensagem e a resposta.

---

### User Story 3 - Banner "Maestro" ao iniciar (Priority: P2)

Ao abrir a sessão interativa, o topo da interface mostra o nome "Maestro" em arte de blocos (estilo ANSI/Unicode, como o logo do qwen code), com cor, seguido de uma linha curta com versão, provedor e modelo ativos e pasta atual. Em terminais estreitos o banner usa uma versão compacta; sem suporte a cor, o banner aparece em texto simples. O banner nunca é enviado ao modelo nem impresso no modo não interativo.

**Why this priority**: Identidade visual e paridade com a referência. Não afeta funcionamento, mas é parte explícita do pedido.

**Independent Test**: Rodar `maestro` em terminal de 120 colunas e verificar o logo em blocos colorido com o texto "Maestro" legível; rodar em 60 colunas e verificar a versão compacta; rodar com `--no-color` e verificar o banner sem cores; rodar `maestro -p "oi"` e verificar que nada do banner vai para a saída.

**Acceptance Scenarios**:

1. **Given** um terminal com 100 colunas ou mais e cores, **When** o Maestro inicia em modo interativo, **Then** o topo exibe "Maestro" em arte de blocos colorida, ocupando no máximo 8 linhas, seguido da linha de status (versão, provedor/modelo, pasta).
2. **Given** um terminal com menos de 100 colunas, **When** o Maestro inicia, **Then** exibe uma versão compacta do banner (no máximo 3 linhas) que ainda contém o nome "Maestro".
3. **Given** `--no-color` ou `NO_COLOR`, **When** o Maestro inicia, **Then** o banner aparece sem sequências de cor e continua legível.
4. **Given** o modo não interativo (`-p`), **When** o Maestro executa, **Then** nenhuma parte do banner aparece em stdout ou stderr.
5. **Given** uma sessão longa, **When** o usuário rola até o início da conversa, **Then** o banner permanece visível apenas no cabeçalho fixo (não é repetido no histórico) ou aparece uma única vez no início do histórico, nunca duplicado.

---

### User Story 4 - Respostas em markdown formatadas (Priority: P2)

As respostas do modelo chegam em markdown. Em vez de mostrar os símbolos crus (`#`, `**`, `- `, crases), o Maestro formata o texto como o qwen code: títulos em destaque, negrito e itálico aplicados, listas com marcadores e recuo, listas numeradas, citações, código em linha destacado, blocos de código com borda e destaque de sintaxe pela linguagem indicada, tabelas alinhadas, linhas horizontais e links legíveis. A formatação acontece também durante o streaming, sem "piscar" nem reformatar o que já foi exibido de forma perceptível. Mensagens do usuário continuam como texto simples.

**Why this priority**: As respostas de modelos de código vêm cheias de blocos de código e listas; sem formatação, a leitura no terminal é ruim. É a melhoria de legibilidade mais pedida.

**Independent Test**: Pedir ao modelo uma resposta que contenha título, lista, negrito, código em linha, bloco de código em TypeScript e uma tabela; verificar visualmente cada elemento formatado; comparar lado a lado com o qwen code mostrando a mesma resposta.

**Acceptance Scenarios**:

1. **Given** uma resposta com `# Título`, `**negrito**`, `*itálico*` e `` `código` ``, **When** exibida, **Then** nenhum desses símbolos aparece cru: o título fica em destaque, negrito e itálico são aplicados e o código em linha tem cor distinta.
2. **Given** uma resposta com lista com marcadores, lista numerada e sublista, **When** exibida, **Then** os itens aparecem com marcadores/números e recuo correto por nível.
3. **Given** uma resposta com um bloco de código ` ```ts ... ``` `, **When** exibido, **Then** o bloco tem moldura ou fundo distinto, indica a linguagem e as palavras‑chave, strings e comentários recebem cores diferentes.
4. **Given** uma resposta com tabela markdown, **When** exibida, **Then** as colunas ficam alinhadas e o cabeçalho destacado; se a tabela for mais larga que a tela, ela é truncada com indicação, sem quebrar o layout.
5. **Given** uma resposta sendo transmitida token a token, **When** um bloco de código ainda está aberto (sem o fechamento ` ``` `), **Then** o conteúdo parcial é exibido já como bloco de código e, ao fechar, o resultado final é idêntico ao que seria renderizado de uma vez.
6. **Given** `--no-color`, **When** uma resposta markdown é exibida, **Then** a estrutura (recuos, marcadores, molduras de código, alinhamento de tabela) é mantida sem cores.
7. **Given** uma resposta com markdown malformado (ex.: negrito não fechado), **When** exibida, **Then** o texto aparece integralmente, sem perda de conteúdo, mesmo que parte fique sem formatação.
8. **Given** o modo não interativo (`-p`), **When** a resposta é escrita em stdout, **Then** ela sai como markdown cru (texto original), para ser consumida por scripts.

---

### Edge Cases

- O que acontece quando o terminal é redimensionado durante o streaming de uma resposta? O layout reflui e o streaming continua sem perda de texto.
- O que acontece quando o usuário cola um texto com muitas linhas no prompt? O prompt cresce até um limite (ex.: 10 linhas) e passa a rolar internamente; a área da conversa encolhe proporcionalmente.
- O que acontece com uma resposta única maior que a memória visual razoável (ex.: 5.000 linhas)? A rolagem continua funcionando com desempenho aceitável (ver SC‑004).
- O que acontece quando o diálogo de confirmação de ferramenta aparece com a visão rolada para cima? O diálogo tem prioridade e fica visível acima do prompt; a conversa não rola.
- O que acontece quando o terminal não suporta o modo de tela alternativa (ex.: redirecionamento ou terminais muito antigos)? O Maestro cai no comportamento anterior (faixa que cresce), avisa uma vez e continua funcionando.
- O que acontece com markdown dentro de resultados de ferramentas (conteúdo de arquivos lidos)? Resultados de ferramentas são exibidos como texto literal, nunca formatados como markdown.
- O que acontece com caracteres largos (CJK, emoji) na arte do banner e nas tabelas? O alinhamento considera a largura visual dos caracteres.

## Requirements *(mandatory)*

### Functional Requirements

**Tela cheia e estabilidade (US1)**

- **FR-001**: O sistema MUST ocupar toda a área visível do console no modo interativo, com cabeçalho no topo e prompt + barra de status fixos na base.
- **FR-002**: O sistema MUST NOT adicionar linhas ao histórico de rolagem do emulador de terminal durante a sessão interativa (digitação, streaming, troca de estado).
- **FR-003**: O sistema MUST restaurar o conteúdo original do console ao encerrar a sessão interativa, inclusive em encerramento por erro ou interrupção.
- **FR-004**: O sistema MUST reorganizar o layout em até 1 segundo quando o terminal é redimensionado, mantendo prompt e barra de status visíveis.
- **FR-005**: O sistema MUST funcionar em terminais pequenos (a partir de 12 linhas × 40 colunas) com layout compacto, e informar o tamanho mínimo quando abaixo disso.
- **FR-006**: Quando o terminal não suportar tela cheia, o sistema MUST degradar para o modo anterior com um único aviso, sem falhar.

**Rolagem interna (US2)**

- **FR-007**: O sistema MUST permitir rolar a área da conversa com Page Up / Page Down (uma tela), setas com modificador ou equivalente (uma linha) e Home / End (início / fim).
- **FR-008**: O sistema MUST rolar a conversa com a roda do mouse quando o terminal reportar esses eventos, sem quebrar em terminais que não reportam.
- **FR-009**: O sistema MUST exibir um indicador vertical de posição na lateral da área da conversa sempre que o conteúdo exceder a área visível.
- **FR-010**: O sistema MUST manter a visão "colada" ao final enquanto o usuário estiver no final, e preservar a posição quando o usuário tiver rolado para cima, sinalizando conteúdo novo abaixo.
- **FR-011**: O sistema MUST voltar ao final da conversa quando o usuário envia uma mensagem.
- **FR-012**: As teclas de rolagem MUST NOT interferir na edição do prompt (setas ↑/↓ sem modificador continuam navegando mensagens anteriores).

**Banner (US3)**

- **FR-013**: O sistema MUST exibir, ao iniciar o modo interativo, um banner com o texto "Maestro" em arte de blocos colorida de no máximo 8 linhas, com versão compacta (≤ 3 linhas) em terminais com menos de 100 colunas e versão sem cor quando cores estiverem desativadas.
- **FR-014**: O banner MUST NOT aparecer no modo não interativo nem ser incluído em nenhuma mensagem enviada ao modelo.

**Markdown (US4)**

- **FR-015**: O sistema MUST formatar as respostas do modelo interpretando markdown: títulos (níveis 1–6), parágrafos, negrito, itálico, tachado, código em linha, blocos de código com linguagem, listas com marcadores e numeradas (aninhadas), citações, tabelas, linhas horizontais e links.
- **FR-016**: Blocos de código MUST ter destaque de sintaxe conforme a linguagem indicada (no mínimo: TypeScript/JavaScript, JSON, Python, Shell/Bash, PowerShell, Markdown, YAML, HTML/CSS, SQL, Go, Rust, Java, C#) e exibir o nome da linguagem; linguagens desconhecidas são exibidas sem destaque, mas com moldura.
- **FR-017**: A formatação MUST ser aplicada incrementalmente durante o streaming, tratando blocos ainda não fechados como se estivessem fechados, e o resultado final MUST ser idêntico ao de uma renderização única.
- **FR-018**: Markdown malformado MUST ser exibido sem perda de texto.
- **FR-019**: Tabelas mais largas que a área disponível MUST ser truncadas com indicação visual, sem quebrar o layout; tabelas e banner MUST considerar a largura visual de caracteres largos.
- **FR-020**: Resultados de ferramentas e mensagens do usuário MUST ser exibidos como texto literal, não como markdown.
- **FR-021**: No modo não interativo, a resposta MUST ser escrita em stdout como texto original (markdown cru), sem formatação de terminal.
- **FR-022**: Com cores desativadas, a estrutura do markdown (recuos, marcadores, molduras, alinhamento) MUST ser mantida.

**Compatibilidade**

- **FR-023**: Todos os comportamentos da feature 001 (comandos `/`, cancelamento, confirmação de ferramentas, troca de provedor, modo `-p`, códigos de saída) MUST continuar funcionando sem alteração.
- **FR-024**: Os comportamentos MUST valer em Windows (Windows Terminal e console padrão), macOS e Linux.

### Key Entities

- **Viewport da Conversa**: a janela visível sobre a lista de mensagens. Atributos: altura disponível (linhas), posição de rolagem (linha do topo), total de linhas renderizadas, modo (colado ao final / posição fixa), indicador de conteúdo novo.
- **Bloco Renderizado**: unidade de exibição derivada de uma mensagem após interpretação do markdown (parágrafo, título, lista, bloco de código com linguagem, tabela, citação, separador). Atributos: tipo, conteúdo já formatado, número de linhas, se está completo (streaming) ou parcial.
- **Banner**: arte do nome em blocos com variantes (completa, compacta, sem cor) e a linha de status que a acompanha.
- **Capacidades do Terminal**: tamanho (colunas × linhas), suporte a cores, suporte a tela alternativa, suporte a eventos de mouse. Determina o modo de layout e a variante do banner.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Durante uma sessão de 10 minutos com digitação e 20 respostas, a barra de rolagem do emulador de terminal permanece inalterada (0 linhas adicionadas ao histórico do terminal), em Windows Terminal, console padrão do Windows, Terminal.app e um emulador Linux.
- **SC-002**: Ao sair, 100% do conteúdo anterior do console é restaurado em todos os terminais testados.
- **SC-003**: Após redimensionar a janela, a interface está reorganizada e estável em até 1 segundo em 95% dos redimensionamentos.
- **SC-004**: Rolar uma conversa com 5.000 linhas responde a cada tecla de rolagem em menos de 100 ms, e a digitação no prompt permanece sem atraso perceptível (< 50 ms por tecla).
- **SC-005**: Em um conjunto de 30 respostas reais de modelos de código contendo markdown, 100% dos elementos listados em FR‑015 são exibidos sem símbolos crus, e a renderização ao final do streaming é idêntica à renderização única em 100% dos casos.
- **SC-006**: Usuários que já conhecem o qwen code reconhecem o estilo visual (banner, blocos de código com destaque, listas) sem explicação, em um teste informal com 3 pessoas.
- **SC-007**: Toda a suíte de testes da feature 001 continua passando, e o modo `-p` produz saída idêntica à anterior (markdown cru) em 100% dos casos.

## Assumptions

- **Referência visual**: "Mesmo estilo do qwen code" significa reproduzir a aparência geral: logo em blocos colorido no topo, blocos de código com destaque de sintaxe e nome da linguagem, listas com marcadores, títulos em destaque. Não é exigida igualdade pixel a pixel nem a mesma paleta exata; o Maestro usa cores próprias coerentes com seu cabeçalho atual (ciano/magenta).
- **"Barra de rolagem interna"**: entendida como um indicador vertical de posição dentro da interface, mais controles de teclado e roda do mouse. Não é um controle clicável/arrastável com o mouse; isso fica fora do escopo.
- **Tela cheia**: entendida como uso do modo de tela alternativa do terminal (o mesmo que editores e o próprio qwen code usam), com restauração ao sair. Terminais sem esse suporte caem no comportamento atual.
- **Teclas de rolagem**: Page Up/Page Down, Home/End e Shift+↑/Shift+↓ (ou Ctrl+↑/↓ onde Shift não for reportado). As setas sem modificador continuam reservadas ao histórico do prompt.
- **Tamanho mínimo**: 12 linhas × 40 colunas; abaixo disso o Maestro avisa, mas não se recusa a rodar.
- **Streaming e markdown**: pequenas reformatações durante o streaming (ex.: um `*` que só se revela itálico ao receber o fechamento) são aceitáveis desde que o resultado final seja correto e não haja "piscar" de tela inteira.
- **Modo `-p`**: permanece texto cru para preservar o uso em scripts; a formatação é exclusiva do modo interativo.
- **Destaque de sintaxe**: cobre as linguagens listadas em FR‑016; outras linguagens aparecem sem cores, mas dentro da moldura.
- **Escopo excluído**: seleção/cópia com mouse, busca no histórico, temas configuráveis, exportação da conversa, renderização de imagens.
