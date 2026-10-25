# Feature Specification: Exibição da IA no estilo do Claude Code (progresso, transcrição e diff)

**Feature Branch**: `009-ai-output-display`
**Created**: 2026-10-25
**Status**: Draft
**Input**: User description: "Melhoria na exibição da IA: exibir uma frase enquanto está processando como o claude e o qwen, como \"* Contemplating… (13s · ↓ 304 tokens)\"; exibindo o tempo e a quantidade de tokens gastos, se possível; a forma como a IA está exibindo os resultados está estranha; gostaria que exibisse o resultado de forma parecida com o claude; write_file deve exibir a diferença como o claude exibe; pode procurar código parecido no OpenClaude (https://github.com/Twigpine/openclaude); pode fazer referência do OpenClaude como fonte."

## Contexto

Hoje, enquanto o modelo trabalha, a sessão interativa mostra só um cursor `▍` piscando abaixo do texto parcial: o usuário não sabe se o Maestro está pensando, esperando a rede ou executando uma ferramenta, nem há quanto tempo. Na transcrição, a resposta do modelo aparece sem marcador, cada chamada de ferramenta vira uma linha `⚙ nome` sem argumentos, e o resultado vira `✓` seguido da primeira linha da saída cortada em 120 caracteres. Uma escrita de arquivo mostra a diferença só no diálogo de confirmação, como linhas `+`/`-` sem números de linha e sem contexto; depois de aprovada, ou quando o modo de aprovação a libera sozinho, a transcrição não guarda nada do que mudou.

O Claude Code (e o qwen code, que segue o mesmo padrão) resolve isso com três elementos que esta feature traz para o Maestro:

1. **Indicador de atividade**: uma linha animada com uma frase curta, o tempo decorrido e os tokens recebidos, por exemplo `✻ Contemplando… (13s · ↓ 304 tokens · Esc para interromper)`.
2. **Transcrição estruturada**: cada bloco do assistente começa com um marcador (`⏺`); cada ferramenta aparece como `⏺ Nome(argumento principal)` e o resultado logo abaixo, recuado, com `⎿` e um resumo legível (`Leu 120 linhas`, `+3 −1 linhas`, as primeiras linhas da saída de um comando com `… +N linhas`).
3. **Diferença de arquivo**: escritas mostram um bloco de diff com números de linha, linhas de contexto, adições em verde e remoções em vermelho, tanto na confirmação quanto na transcrição depois de executadas.

O [OpenClaude](https://github.com/Twigpine/openclaude) é a referência pública desse comportamento e será creditado como fonte de inspiração. Ele se declara derivado do código do Claude Code, cujos direitos continuam da Anthropic, então serve como referência de **comportamento e aparência**, não como código a copiar (ver Premissas).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver que o modelo está trabalhando, há quanto tempo e quanto já gerou (Priority: P1)

Como usuário, depois de enviar uma mensagem vejo imediatamente uma linha de atividade com um símbolo animado, uma frase curta (por exemplo "Contemplando…"), o tempo decorrido em segundos e a quantidade de tokens já recebidos. Quando o modelo chama uma ferramenta, a frase indica o que está acontecendo (por exemplo "Executando run_command…"). Quando a resposta termina, a linha some e fica um resumo discreto com a duração e os tokens do turno.

**Why this priority**: É o pedido mais explícito do usuário e o que mais incomoda hoje: sem retorno visual, uma resposta lenta parece travada. Sozinho já melhora a percepção de qualquer turno, com qualquer provedor.

**Independent Test**: Enviar uma pergunta com um provedor simulado que demora alguns segundos e emite tokens aos poucos; verificar que a linha de atividade aparece antes do primeiro token, que o tempo avança a cada segundo, que a contagem de tokens cresce e que, no fim, a linha é substituída pelo resumo do turno.

**Acceptance Scenarios**:

1. **Given** a sessão interativa ociosa, **When** o usuário envia uma mensagem, **Then** em até meio segundo aparece abaixo da conversa uma linha com símbolo animado, uma frase terminada em "…", o tempo decorrido (`0s`) e a dica de interrupção.
2. **Given** um turno em andamento há 13 segundos que já recebeu 304 tokens, **When** o usuário olha a linha de atividade, **Then** ela mostra algo equivalente a `✻ Contemplando… (13s · ↓ 304 tokens · Esc para interromper)`.
3. **Given** um turno em andamento, **When** o modelo pede uma ferramenta, **Then** a frase passa a indicar a ferramenta em execução enquanto ela roda e volta a uma frase de espera quando o modelo retoma.
4. **Given** um turno em andamento, **When** o modelo termina, **Then** a linha de atividade desaparece e a transcrição mostra um resumo discreto do turno com duração e tokens (por exemplo `✻ 13s · ↓ 304 tokens`).
5. **Given** um turno em andamento, **When** o usuário aperta Esc, **Then** o turno é cancelado como hoje e o resumo indica que foi interrompido.
6. **Given** um provedor que só informa o consumo de tokens no fim da resposta, **When** o turno está em andamento, **Then** a contagem exibida é uma estimativa a partir do texto recebido e é substituída pelo valor real assim que o provedor o informa.
7. **Given** um turno que dura mais de 60 segundos, **When** o usuário olha a linha de atividade, **Then** o tempo aparece em minutos e segundos (por exemplo `1m 05s`).

---

### User Story 2 - Ler a transcrição no formato do Claude Code (Priority: P1)

Como usuário, leio a conversa e distingo de relance o que é texto do modelo, o que é uma ferramenta que ele chamou, com qual argumento, e qual foi o resultado. Cada resposta do assistente começa com um marcador; cada chamada de ferramenta aparece como `⏺ NomeDaFerramenta(argumento principal)` e, logo abaixo, recuado com `⎿`, um resumo do resultado adequado ao tipo da ferramenta. Erros aparecem destacados com a mensagem completa.

**Why this priority**: É a segunda queixa explícita ("a forma como a IA está exibindo os resultados está estranha"). Junto com a US1 forma o MVP: a sessão passa a se parecer com o Claude Code no uso diário.

**Independent Test**: Executar um turno simulado em que o modelo escreve um texto, lê um arquivo, lista um diretório, roda um comando com saída longa e um comando que falha; verificar que cada ferramenta aparece com nome e argumento, que cada resultado aparece recuado com um resumo do tipo certo e que o erro mostra a mensagem completa.

**Acceptance Scenarios**:

1. **Given** uma resposta só de texto, **When** ela é exibida, **Then** o primeiro bloco do assistente começa com o marcador `⏺` e o texto continua formatado em markdown como hoje.
2. **Given** o modelo leu `src/index.ts` (120 linhas), **When** a chamada é exibida, **Then** aparece `⏺ Read(src/index.ts)` e abaixo `⎿ Leu 120 linhas`.
3. **Given** o modelo listou um diretório com 14 entradas, **When** a chamada é exibida, **Then** aparece `⏺ List(src/ui)` e abaixo `⎿ 14 itens`.
4. **Given** o modelo rodou um comando com 40 linhas de saída, **When** a chamada é exibida, **Then** aparece `⏺ Bash(npm test)` e abaixo as primeiras linhas da saída recuadas, seguidas de `… +N linhas`.
5. **Given** uma ferramenta que falhou, **When** o resultado é exibido, **Then** ele aparece em destaque de erro com a mensagem completa (não cortada), recuado sob a chamada.
6. **Given** uma ação recusada pelo usuário, **When** o resultado é exibido, **Then** aparece sob a chamada uma linha indicando que o usuário recusou.
7. **Given** uma ação liberada automaticamente pelo modo de aprovação, **When** ela é exibida, **Then** a transcrição continua indicando o modo que a liberou (comportamento da feature 005), no novo formato.
8. **Given** um passo nativo do Spec Kit interceptado, **When** ele é exibido, **Then** aparece no mesmo formato de ferramenta, identificado como passo do Spec Kit.
9. **Given** uma resposta vinda de uma rota diferente de `chat`, **When** ela é exibida, **Then** a indicação de rota, provedor e modelo da feature 008 continua visível junto ao marcador.

---

### User Story 3 - Ver a diferença de uma escrita de arquivo como no Claude Code (Priority: P2)

Como usuário, quando o modelo quer criar ou alterar um arquivo, vejo um bloco de diff com o caminho, o total de linhas adicionadas e removidas, números de linha, algumas linhas de contexto ao redor de cada trecho alterado, adições em verde e remoções em vermelho. Depois que a escrita acontece (aprovada por mim ou pelo modo de aprovação), a transcrição guarda o mesmo diff sob a chamada, para eu revisar depois rolando a conversa.

**Why this priority**: Pedido explícito e de alto valor para revisar o que o modelo muda, mas depende do formato de ferramenta da US2 para ter onde aparecer na transcrição.

**Independent Test**: Simular uma escrita que altera 3 linhas no meio de um arquivo de 200 linhas; verificar que o diálogo de confirmação e, após aprovar, a transcrição mostram o cabeçalho com caminho e contagem, os números de linha corretos, o contexto e as cores; repetir com um arquivo novo e com uma escrita que não muda nada.

**Acceptance Scenarios**:

1. **Given** o modelo quer alterar 1 linha e acrescentar 2 em `src/a.ts`, **When** o diálogo de confirmação aparece, **Then** ele mostra o caminho, o resumo `+2 −1`, os trechos alterados com números de linha, até 3 linhas de contexto antes e depois, remoções em vermelho e adições em verde.
2. **Given** a escrita aprovada, **When** ela termina, **Then** a transcrição mostra `⏺ Write(src/a.ts)` e, recuado, `⎿ +2 −1 linhas` seguido do mesmo diff.
3. **Given** o modelo cria um arquivo novo de 30 linhas, **When** a escrita é exibida, **Then** o resumo indica arquivo novo e o conteúdo aparece como adições numeradas, limitado ao tamanho máximo do diff na transcrição com `… +N linhas` para o resto.
4. **Given** uma escrita cujo conteúdo é idêntico ao arquivo atual, **When** é exibida, **Then** aparece "sem alterações" em vez de um diff vazio.
5. **Given** um diff maior que o espaço disponível, **When** é exibido no diálogo ou na transcrição, **Then** as linhas excedentes são resumidas em `… +N linhas` sem quebrar o layout.
6. **Given** uma escrita recusada pelo usuário, **When** ela é registrada na transcrição, **Then** aparece a chamada com a indicação de recusa e sem o diff aplicado.
7. **Given** um terminal sem cores, **When** o diff é exibido, **Then** adições e remoções continuam distinguíveis pelos prefixos `+` e `-`.

---

### Edge Cases

- **Terminal estreito** (menos de 60 colunas): a linha de atividade encurta, mantendo frase e tempo e omitindo primeiro a dica de interrupção e depois os tokens; linhas de diff longas quebram dentro do bloco sem empurrar a interface.
- **Modo não interativo (`-p`)**: nada desta feature aparece no stdout; a saída continua sendo o markdown cru da resposta.
- **Sem animação**: em terminais sem cor ou com `NO_COLOR`, o símbolo da linha de atividade não pisca nem muda de cor, mas o tempo continua avançando.
- **Muitas ferramentas no mesmo turno**: cada chamada aparece em sequência; a rolagem e o indicador de posição continuam funcionando.
- **Saída de comando com sequências de escape ou caracteres de controle**: são exibidas de forma literal e segura, sem alterar a interface.
- **Arquivo binário ou muito grande** na escrita: o diff é substituído por um resumo (tamanho e contagem de linhas) em vez de um bloco ilegível.
- **Arquivo com fins de linha CRLF**: a mudança só de fim de linha não deve aparecer como o arquivo inteiro removido e readicionado sem aviso; o resumo indica a troca de fim de linha.
- **Cancelamento no meio de uma ferramenta**: a chamada aparece com a indicação de cancelamento e a linha de atividade some.
- **Provedor que não informa tokens em nenhum momento**: a linha mostra só a estimativa, marcada como aproximada, e o resumo final idem.
- **Pergunta do modelo (`ask_user`) ou confirmação pendente**: o relógio continua contando, mas a frase indica que o Maestro está aguardando o usuário.

## Requirements *(mandatory)*

### Functional Requirements

**Indicador de atividade**

- **FR-001**: Durante um turno interativo, o sistema MUST exibir uma linha de atividade abaixo da conversa, desde o envio até o fim do turno, substituindo o cursor `▍` atual.
- **FR-002**: A linha de atividade MUST conter um símbolo animado, uma frase curta terminada em "…", o tempo decorrido do turno atualizado pelo menos uma vez por segundo e, quando disponível, a quantidade de tokens recebidos no turno.
- **FR-003**: A frase MUST variar entre um conjunto de verbos de espera (sorteada no início de cada turno) e MUST mudar para uma frase específica enquanto uma ferramenta executa, enquanto há confirmação pendente e enquanto há pergunta ao usuário pendente.
- **FR-004**: A contagem de tokens MUST somar todas as chamadas ao modelo dentro do mesmo turno (incluindo as que seguem resultados de ferramentas); enquanto o provedor não informa o valor real, MUST ser exibida uma estimativa calculada a partir do texto recebido, trocada pelo valor real assim que ele chegar.
- **FR-005**: O tempo MUST ser formatado em segundos abaixo de um minuto (`13s`) e em minutos e segundos a partir disso (`1m 05s`).
- **FR-006**: A linha de atividade MUST incluir a dica de interrupção (Esc) enquanto houver espaço, e MUST encurtar em terminais estreitos conforme a ordem descrita nos casos de borda.
- **FR-007**: Ao fim do turno, a linha de atividade MUST desaparecer e a transcrição MUST registrar um resumo discreto com duração e tokens do turno; um turno cancelado MUST ser indicado como interrompido.
- **FR-008**: A contagem cumulativa já exibida na barra de status MUST continuar existindo e coerente com os totais dos turnos.

**Transcrição**

- **FR-009**: O primeiro bloco de texto de cada resposta do assistente MUST ser precedido do marcador `⏺`; o texto continua sendo renderizado como markdown.
- **FR-010**: Cada chamada de ferramenta MUST ser exibida como `⏺ Rótulo(argumento principal)`, em que o rótulo é um nome curto e legível da ferramenta (por exemplo `Read`, `List`, `Write`, `Bash`) e o argumento principal é o caminho ou o comando, encurtado com reticências quando não couber na linha.
- **FR-011**: O resultado de cada chamada MUST aparecer logo abaixo dela, recuado e iniciado por `⎿`, com um resumo específico por tipo: leitura (número de linhas lidas), listagem (número de itens), comando (primeiras linhas da saída e `… +N linhas` para o restante), escrita (resumo de adições e remoções e o diff), pergunta ao usuário (a resposta escolhida).
- **FR-012**: Resultados de erro MUST ser exibidos em destaque de erro e por inteiro, até um limite de linhas configurado por padrão, com `… +N linhas` para o excedente.
- **FR-013**: Ações recusadas pelo usuário, liberadas pelo modo de aprovação, canceladas e passos nativos do Spec Kit MUST ser exibidos no mesmo formato, preservando as informações que as features 005 e 006 já mostram (modo que liberou, nome do passo).
- **FR-014**: A indicação de rota, provedor e modelo das respostas fora de `chat` (feature 008) MUST continuar visível.
- **FR-015**: A transcrição MUST permanecer rolável, copiável com o mouse (feature 007) e estável: uma mensagem já exibida não muda de altura depois de concluída.

**Diferença de arquivo**

- **FR-016**: Toda escrita de arquivo MUST ter um diff calculado entre o conteúdo atual e o novo, com cabeçalho (caminho e resumo `+A −R`), trechos com números de linha, até 3 linhas de contexto ao redor de cada trecho, adições em verde e remoções em vermelho, mantendo os prefixos `+`/`-` para terminais sem cor.
- **FR-017**: O mesmo formato de diff MUST ser usado no diálogo de confirmação e na transcrição após a escrita.
- **FR-018**: Arquivos novos MUST ser indicados como tal e exibidos como adições; escritas sem mudança MUST mostrar "sem alterações"; arquivos binários ou acima do limite de exibição MUST mostrar só o resumo.
- **FR-019**: Na transcrição, o diff MUST ser limitado a um número máximo de linhas por padrão (resumindo o restante em `… +N linhas`); no diálogo de confirmação, o limite continua sendo o espaço disponível na tela.
- **FR-020**: Mudanças apenas de fim de linha (LF ↔ CRLF) MUST ser indicadas como tal no resumo em vez de aparecerem como o arquivo inteiro reescrito.

**Escopo e atribuição**

- **FR-021**: O modo não interativo (`-p`) MUST continuar escrevendo no stdout apenas o texto da resposta, sem linha de atividade, marcadores ou diffs.
- **FR-022**: Nenhum conteúdo de arquivo, saída de comando ou texto da conversa MUST ir para o log de depuração por causa desta feature; o log pode registrar tempos e contagens.
- **FR-023**: O projeto MUST creditar o OpenClaude como referência de comportamento visual (README, seção de créditos), sem incorporar código dele.

### Key Entities

- **Atividade do turno**: estado efêmero de um turno em andamento: fase (aguardando modelo, recebendo texto, executando ferramenta, aguardando confirmação, aguardando resposta), frase atual, instante de início, tokens recebidos (real ou estimado).
- **Resumo do turno**: duração, tokens de entrada e saída, se foi interrompido; anexado à transcrição ao fim do turno.
- **Exibição de ferramenta**: rótulo legível, argumento principal, tipo de resumo do resultado e, para escritas, o diff.
- **Diff de arquivo**: caminho, se é novo, contagens de adições e remoções, trechos com números de linha antigos e novos e linhas de contexto, indicação de mudança só de fim de linha.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 100% dos turnos interativos, o usuário vê um sinal de atividade em até 0,5 s após o envio, antes do primeiro token.
- **SC-002**: O tempo exibido na linha de atividade não difere do tempo real do turno em mais de 1 s.
- **SC-003**: Ao fim de um turno, o total de tokens exibido no resumo coincide com o valor informado pelo provedor em 100% dos turnos em que o provedor o informa.
- **SC-004**: Numa transcrição com 5 tipos diferentes de ferramenta, um avaliador identifica corretamente, para cada chamada, a ferramenta, o argumento e se ela teve sucesso, sem expandir nada, em 100% dos casos.
- **SC-005**: Para uma alteração pontual em um arquivo de 200 linhas, o usuário localiza a linha alterada pelo número exibido no diff em menos de 10 segundos.
- **SC-006**: A interface continua respondendo à digitação e à rolagem durante um turno longo: a animação da linha de atividade não aumenta perceptivelmente a latência de digitação medida pelos testes de desempenho existentes.
- **SC-007**: A saída de `maestro -p` permanece idêntica byte a byte à de antes da feature para as mesmas respostas simuladas.

## Assumptions

- **OpenClaude como referência, não como fonte de código**: o OpenClaude declara que "originou-se do código do Claude Code" e que "o Claude Code derivado continua da Anthropic"; só as modificações dos contribuidores são MIT. Como a constituição exige que o Maestro seja e continue MIT (§VI–VII), a implementação reproduz o **comportamento e a aparência** observáveis, escrita do zero, e o OpenClaude é creditado como referência no README. Se o usuário quiser incorporar trechos de código, isso exige uma análise de licença separada.
- **Frases em português**: a interface do Maestro é majoritariamente em português, então as frases de espera seguem o estilo do Claude Code em português ("Contemplando…", "Ponderando…", "Elaborando…"); os rótulos de ferramentas (`Read`, `Write`, `Bash`, `List`) seguem os nomes curtos usados pelo Claude Code, por serem reconhecíveis.
- **Tokens exibidos**: a seta `↓` indica tokens de saída (gerados pelo modelo) no turno; os de entrada aparecem só no resumo e na barra de status.
- **Estimativa de tokens**: quando o provedor não informa o uso durante o streaming, uma estimativa simples a partir do tamanho do texto é aceitável, desde que trocada pelo valor real no fim.
- **Limites padrão**: até 3 linhas de contexto no diff, até 5 linhas de saída de comando visíveis na transcrição, até 40 linhas de diff na transcrição e até 20 linhas de erro; valores fixos nesta versão, sem chaves novas em `settings.json` (YAGNI).
- **Sem expansão interativa**: o atalho do Claude Code para expandir um resultado recolhido (Ctrl+R) fica fora do escopo; o conteúdo completo continua acessível ao modelo e pode ser pedido a ele. O Ctrl+O da feature 007 continua dedicado aos marcadores de colagem.
- **Pensamento estendido**: o Maestro não envia `thinking` ao Claude, então não há bloco de "pensamento" a exibir; a linha de atividade cobre esse tempo.
- **Escopo das ferramentas**: as ferramentas existentes (ler, listar, escrever, executar, perguntar) e os passos nativos do Spec Kit; ferramentas futuras seguem o formato genérico `⏺ Nome(argumento)` com a primeira linha do resultado.
