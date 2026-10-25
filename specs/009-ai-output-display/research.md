# Research: Exibição da IA no estilo do Claude Code

Cada decisão segue o formato Decisão / Motivo / Alternativas.

## R1. Onde fica a linha de atividade

- **Decisão**: numa região fixa (`flexShrink={0}`) entre o `Transcript` e o `InputPrompt`, desenhada só durante um turno.
- **Motivo**: dentro da área rolável, cada tique mudaria a altura do conteúdo, deslocaria a rolagem e invalidaria o cache de linhas do `FrameRecorder` usado na cópia com o mouse (feature 007). Fora dela, o tique só redesenha uma linha. É também onde o Claude Code a mostra, logo acima do prompt.
- **Alternativas**: como última linha da transcrição, rejeitada pelos motivos acima; na barra de status, rejeitada porque a barra já tem modo, uso e dicas, e o pedido é uma linha própria.

## R2. Relógio e animação

- **Decisão**: o `ActivityLine` tem um `setInterval` próprio de 200 ms que avança o quadro do símbolo (`· ✢ ✳ ✶ ✻ ✽`, ida e volta). O tempo decorrido é calculado a cada render a partir de `startedAt` e de `clock()`, que é injetável e por padrão é `Date.now`. Com `NO_COLOR` ou sem cor, o símbolo fica fixo (`✻`) e o intervalo passa a 1 s, só para atualizar o tempo.
- **Motivo**: o estado do relógio fica fora do controller, então não há `emit('change')` a cada tique e a transcrição não é reconciliada. 200 ms dá movimento sem custo perceptível, e o teste de desempenho atual (SC-006) vale como guarda.
- **Alternativas**: 100 ms como no Claude Code, rejeitado porque o Ink redesenha o quadro inteiro na tela alternativa e a frequência dobraria o custo sem ganho visível; o relógio no controller, rejeitado porque redesenharia tudo.

## R3. Fases e frases

- **Decisão**: um reducer puro, `activityReducer(state, event)`, com as fases `waiting` (aguardando o modelo), `responding` (recebendo texto), `tool` (ferramenta em execução, com o nome), `confirm` (aguardando confirmação) e `question` (aguardando resposta). A frase de espera é sorteada no início do turno, de uma lista fixa em português: Contemplando, Ponderando, Elaborando, Matutando, Raciocinando, Tramando, Conjecturando, Orquestrando, Cozinhando, Destrinchando. O sorteio usa um `random` injetável. As fases `tool`, `confirm` e `question` usam frases fixas: `Executando <Rótulo>…`, `Aguardando sua confirmação…` e `Aguardando sua resposta…`.
- **Motivo**: o reducer puro é testável sem UI (constituição §III), e o vocabulário segue o estilo do Claude Code no idioma da interface (premissa da spec).
- **Alternativas**: frases em inglês, rejeitado pela premissa da spec; trocar a frase durante o turno, rejeitado porque distrai e o Claude Code mantém a mesma frase no turno.

## R4. Tokens ao vivo

- **Decisão**: `TurnCallbacks` ganha `onUsage(inputTokens, outputTokens)`, chamado pelo `collect` a cada evento `usage`. A atividade soma os valores reais por chamada ao modelo e mantém uma estimativa de `ceil(caracteres/4)` do texto recebido desde o último valor real. O valor exibido é `real + estimativa`. A estimativa leva `~` na frente quando o provedor ainda não informou nenhum valor real.
- **Motivo**: o protocolo Anthropic informa a entrada no `message_start` e a saída no fim. O Qwen OpenAI e o Claude Code informam só no fim. A estimativa dá retorno imediato, e o valor real corrige a contagem ao chegar (FR-004, SC-003).
- **Alternativas**: um tokenizador real, rejeitado porque seria dependência nova e diferente por provedor; mostrar só o valor real, rejeitado porque ficaria em 0 até o fim na maioria dos provedores.

## R5. Resumo do turno

- **Decisão**: ao fim do turno, o controller emite um aviso `info` com `✻ 13s · ↓ 304 tokens`, ou `✻ interrompido · 4s · ↓ 20 tokens`. O aviso fica na posição atual do histórico, pelo mecanismo existente.
- **Motivo**: o mecanismo de avisos já posiciona o texto na transcrição e no `-p`. No `-p` o resumo não é emitido, porque o stderr do `-p` é para progresso e erros e o stdout não pode mudar (SC-007).
- **Alternativas**: um tipo novo de mensagem no histórico, rejeitado porque mensagens vão para o modelo e avisos não.

## R6. Pareamento chamada → resultado na transcrição

- **Decisão**: o `MessageList` monta um `Map<callId, tool_result>` a partir do histórico e desenha cada `tool_call` com o próprio resultado logo abaixo. As mensagens `role: 'tool'` não são desenhadas, e um resultado sem chamada correspondente cai no formato genérico. O `memo` de cada item compara também a referência dos resultados das chamadas, para redesenhar quando o resultado chega.
- **Motivo**: o modelo de dados continua igual (os provedores dependem dele). Só a forma de desenhar muda, e o visual fica igual ao do Claude Code: chamada e resultado juntos.
- **Alternativas**: juntar o resultado à mensagem do assistente no histórico, rejeitado porque quebraria a alternância que os conversores esperam.

## R7. Avisos `⚙` duplicados

- **Decisão**: na sessão interativa, o controller deixa de emitir os avisos `⚙ <tool> <arg>`, `⚙ … · auto (modo)`, `⚠ <tool>: …` e `⚙ speckit <passo> · …`. Essas informações passam para o campo de exibição do `tool_result`: modo que liberou, passo do Spec Kit e resumo. No `-p` (`interactive: false`) os avisos continuam como hoje.
- **Motivo**: elimina a duplicação que o usuário achou "estranha" e mantém o `-p` intacto (FR-021).
- **Alternativas**: manter os avisos e também o formato novo, rejeitado porque mostraria a mesma coisa duas vezes.

## R8. Diff estruturado

- **Decisão**: `fileDiff(oldText | null, newText)` em `src/tools/diff.ts` usa `structuredPatch` do pacote `diff`, que já é dependência, com `context: 3`. Ele devolve `{ path, kind: 'new' | 'edit' | 'unchanged' | 'eol' | 'binary' | 'large', added, removed, hunks: [{ lines: [{ type: '+' | '-' | ' ', oldNo?, newNo?, text }] }] }`:
  - mudança só de fim de linha (CRLF ↔ LF): `kind: 'eol'`, detectada comparando os textos normalizados;
  - NUL no conteúdo antigo ou novo: `binary`;
  - mais de 1 MB: `large`.

  O `write_file` expõe `diff(input, ctx)`, que lê o arquivo atual. O `executeTool` chama `tool.diff` uma vez, antes da confirmação e da escrita, e anexa o resultado ao `PendingToolAction.diff` e ao `ToolResult.display.diff`. O `preview` em texto do `write_file` passa a ser derivado do mesmo `FileDiff`, porque o `-p` e o formato genérico ainda usam texto.
- **Motivo**: o diff da transcrição precisa ser o do momento da escrita. Calculado depois, ele compararia o arquivo com ele mesmo. Uma única função alimenta o diálogo, a transcrição e o texto.
- **Alternativas**: re-parsear o patch unificado em texto, rejeitado porque é frágil e o `structuredPatch` já dá a estrutura; guardar o conteúdo antigo inteiro no histórico, rejeitado por memória e porque o diff basta.

## R9. Rótulos e resumos por ferramenta

- **Decisão**: uma tabela pura em `src/ui/toolDisplay.ts`.

  | Ferramenta | Chamada | Resumo do resultado |
  | --- | --- | --- |
  | `read_file` | `Read(caminho)` | `Leu N linhas`, número tirado do cabeçalho `(N lines…)` da saída |
  | `list_directory` | `List(caminho)` | `N itens`, do cabeçalho `(N entries)` |
  | `write_file` | `Write(caminho)` | `+A −R linhas` mais o diff, ou `arquivo novo · N linhas`, `sem alterações`, `troca de fim de linha` |
  | `run_command` | `Bash(comando)` no POSIX, `Cmd(comando)` no Windows (o shell real do `shellFor`) | até 5 linhas da saída sem a linha `exit code`, mais `… +N linhas`; código diferente de 0 vira erro |
  | `ask_user` | `Pergunta(cabeçalho da 1ª pergunta)` | resposta escolhida ou `sem resposta` |
  | Spec Kit interceptado | `Speckit(passo)` | o `summary` do passo |
  | Ferramenta desconhecida | `Nome(primeiro argumento string)` | primeira linha |

  Erros mostram até 20 linhas, recusas mostram `recusado pelo usuário` e cancelamentos mostram `cancelado`. Uma ação liberada por modo acrescenta `· auto (<modo>)` ao resumo.
- **Motivo**: tabela pura é fácil de testar e de estender. Os cabeçalhos das saídas já existem e não precisam mudar, então o modelo continua recebendo o mesmo texto.
- **Alternativas**: um método `display()` em cada ferramenta, rejeitado porque espalha a UI pelas ferramentas e a tabela basta.

## Referência: OpenClaude

O [OpenClaude](https://github.com/Twigpine/openclaude) se declara derivado do código do Claude Code ("the derived Claude Code remains Anthropic's"). Por isso ele serve só como referência do comportamento visual observável (símbolos `⏺`/`⎿`/`✻`, frase com tempo e tokens, diff com números), que também é o do Claude Code. Nenhum código dele foi lido para cópia nem incorporado. O crédito vai para o README, e não para o `THIRD_PARTY_NOTICES.md`, porque não há código de terceiros (constituição §VII).
