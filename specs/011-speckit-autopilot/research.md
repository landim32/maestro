# Research: Modo autopiloto

Cada decisão segue o formato Decisão / Motivo / Alternativas.

## R1. Motor de turnos

- **Decisão**: o driver chama `controller.submit('/speckit.<passo> <args>', { confirm })` para cada turno. Ele não monta prompts nem chama `runTurn` diretamente.
- **Motivo**: o `submit` já resolve a rota do comando, compõe o prompt do Spec Kit (preâmbulo e corpo), roda o preflight, intercepta os scripts nativos, aplica a política de aprovação, registra no histórico e emite os avisos e a linha de atividade. Reaproveitar mantém um único caminho de turnos, e as features 006, 008 e 009 valem automaticamente.
- **Alternativas**: um executor próprio sobre `runTurn`, rejeitado porque duplicaria a resolução de rota, o preflight e a interceptação.

## R2. Turno limpo por passo

- **Decisão**: antes de cada passo, o driver chama `session.clear()` e o reinício dos chips. O passo recebe só o comando, e o modelo lê o que precisa do disco, que é o que os comandos do Spec Kit já mandam fazer. As rodadas do mesmo passo ("continue", resposta a pergunta em texto, correção) **não** limpam o histórico, porque continuam o mesmo trabalho.
- **Motivo**: evita estourar o contexto em histórias longas e faz cada passo começar como começaria nas mãos de uma pessoa.
- **Alternativas**: manter a conversa entre passos, rejeitado porque o contexto cresceria sem limite e o passo seguinte herdaria ruído.

## R3. Sem interação: ask, confirm e modo

- **Decisão**: o `SessionController` ganha `runOverrides({ ask?, confirm?, approvalMode? })`, que devolve uma função de restauração.
  - Durante a execução, o `ask` é o decisor e o `confirm` devolve sempre `false`.
  - O modo é forçado para `auto`, com o anterior guardado.
  - O driver restaura tudo num `finally`.
- **Motivo**: no modo `auto`, só os comandos destrutivos pedem confirmação (feature 005), então recusar todas as confirmações equivale a bloquear exatamente os destrutivos (FR-005, SC-007). O `ask_user` já é um gancho (`ToolContext.ask`), e basta trocar a implementação.
- **Alternativas**: `yolo` com uma lista negra, rejeitado pela spec; um novo modo de aprovação, rejeitado porque `auto` mais recusa já é o comportamento desejado.

## R4. Decisor

- **Decisão**: o `decider.ts` monta um pedido sem ferramentas ao provedor da rota `autopilot.decide`, uma rota nova de propósito que, por padrão, segue `chat`. O pedido leva:
  - a pergunta;
  - as opções, com as descrições;
  - o título e a descrição da história;
  - o passo;
  - um resumo da spec (primeiras 4.000 caracteres).

  A resposta exigida é um JSON `{"choice": "<label>", "rationale": "<≤3 frases>"}`. O `parseDecision` valida com zod e confere se `choice` é um dos rótulos, ignorando maiúsculas e espaços. Em múltipla escolha, `choices` é uma lista. Para pergunta em texto livre, o formato é `{"answer": "...", "rationale": "..."}`. Duas falhas seguidas (erro, JSON inválido ou escolha fora das opções) param a história (FR-010).
- **Motivo**: uma chamada curta e verificável. A política (recomendada; senão a mais conservadora) vai no pedido e é testável com provedor falso. A opção recomendada também é detectada localmente, por `(Recommended)` ou `(Recomendado)` no rótulo ou na descrição, e se o modelo escolher outra, o registro anota a divergência.
- **Alternativas**: escolher sempre a primeira opção, rejeitado porque ignora o contexto; um "subagente" com ferramentas, rejeitado por custo e risco.

## R5. Perguntas em texto no fim do turno

- **Decisão**: `detectQuestion(text)` olha o último parágrafo da resposta e reconhece:
  - `(yes/no)`, `(sim/não)`, `y/n`;
  - frases que terminam em `?` e começam com, ou contêm, padrões dirigidos ao usuário ("Do you want", "Would you like", "Should I", "Deseja", "Quer que", "Posso", "Confirma");
  - os blocos de clarificação do `specify` ("Your choice").

  Quando há pergunta, o decisor gera a resposta em texto, que vira o próximo turno do passo. No máximo 3 respostas por passo.
- **Motivo**: o `implement` do Spec Kit pergunta "Do you want to proceed with implementation anyway? (yes/no)" quando há checklists incompletos, e o `specify` pode apresentar perguntas Q1 a Q3 em texto. Sem resposta, o passo terminaria parado.
- **Alternativas**: pedir ao decisor para classificar todo fim de turno, rejeitado porque gasta uma chamada por turno; os padrões cobrem os casos do Spec Kit.

## R6. Portões

- **Decisão**: `evaluateGate(step, snapshot)` é puro. O snapshot traz os artefatos com `mtime` e hash antes e depois do passo, a contagem de tarefas, o texto final do turno e o `stopReason`.

  | Passo | Portão |
  | --- | --- |
  | specify | `spec.md` criado; a feature (branch e pasta) passou a existir |
  | clarify | `spec.md` existe; o conteúdo pode não mudar |
  | plan | `plan.md` criado ou alterado |
  | tasks | `tasks.md` criado, com pelo menos uma tarefa `- [ ] T` |
  | analyze | o texto não tem linha de achado com severidade `CRITICAL`; uma correção permitida (FR-012) |
  | implement | `open == 0`; senão "continue" enquanto houver progresso (FR-013) |
  | verify | o comando sai com 0; senão até `maxAttempts` correções (FR-014) |

  Um turno com `stopReason: 'error'` falha o portão. Um erro `rate_limit` ou um cancelamento torna o passo `interrupted` (FR-023).
- **Motivo**: são critérios objetivos, sem pedir ao modelo para se avaliar.
- **Alternativas**: o modelo dar nota ao próprio passo, rejeitado por não ser verificável.

## R7. Detecção de CRITICAL no analyze

- **Decisão**: usar, em ordem:
  1. a métrica `Critical Issues Count: N` do relatório, quando existir;
  2. senão, as linhas da tabela "Specification Analysis Report" (`| ID | Category | Severity | …`) cuja coluna de severidade é `CRITICAL`, ignorando o cabeçalho e as linhas de legenda.

  Confirmado no `assets/speckit/templates/commands/analyze.md` (seções 5 e 6). O prompt de correção pede para resolver os achados CRITICAL nos artefatos (`spec.md`, `plan.md`, `tasks.md`), e não no código.
- **Motivo**: o `analyze` do Spec Kit é só leitura e devolve uma tabela de achados com uma coluna de severidade.
- **Alternativas**: um JSON estruturado do analyze, rejeitado porque exigiria mudar o comando embutido (assets do Spec Kit).

## R8. Commit por passo e arquivos protegidos

- **Decisão**: depois de um portão aprovado, o driver faz, em ordem:
  1. regrava `decisions.md` e `.specify/autopilot.json` a partir do estado em memória, o que descarta qualquer edição do modelo (FR-020);
  2. `git add -A`;
  3. commit com `<prefixo> autopilot(<NNN>): <passo>`, por exemplo `fix: autopilot(012): plan`, com o título da história no corpo;
  4. guarda o SHA no estado.

  Se nada mudou (clarify sem mudança, analyze, que só lê, ou verify que passou de primeira), o commit é pulado e o SHA atual é registrado. O `GitPort` ganha `headSha`, `addAll`, `commit(message)` e `push(branch)`, todos por `execFile`.
- **Motivo**: um commit por passo dá o ponto de retomada e o desfazer (SC-005). O prefixo `fix:` segue a convenção do repositório.
- **Alternativas**: um commit no fim da história, rejeitado porque perde a granularidade e a retomada.

## R9. Branches empilhadas e criação da feature

- **Decisão**: o `specify` já cria e troca para a branch `NNN-nome` a partir do HEAD atual (`createFeature`, com `speckit.createBranch`). Por isso, rodar as histórias em sequência sem voltar à base produz o empilhamento (FR-017). O driver força `speckit.createBranch` verdadeiro durante a execução e confere a branch atual depois do `specify`.
- **Motivo**: nenhum código novo de branch.
- **Alternativas**: o driver criar a branch, rejeitado porque duplicaria a lógica de numeração do Spec Kit.

## R10. Verificação

- **Decisão**: `autopilot.verify.command` é uma lista de strings, por exemplo `["npm test", "npm run lint"]`. Sem configuração, o padrão é derivado do `package.json`, com os scripts `test`, `lint` e `build` existentes. Os comandos rodam por um `VerifyPort` injetável sobre o mesmo executor do `run_command` (shell do `shellFor`, timeout `autopilot.verify.timeoutMs`, padrão 10 min), mas fora da política de aprovação, porque são configuração do usuário e não pedido do modelo. Na falha, o prompt de correção leva as últimas 200 linhas da saída.
- **Motivo**: o usuário declara o que é "pronto", e o padrão funciona para projetos Node.
- **Alternativas**: o modelo decidir como testar, rejeitado porque não é verificável.

## R11. Push, PR e merge

- **Decisão**: o `RemotePort` usa `gh pr create --base <base> --head <branch> --title … --body-file <tmp>` e `gh pr merge <n> --merge`, por `execFile`, e o push usa o `GitPort`.
  - Push e PR só rodam com `autopilot.push: true`.
  - O merge só roda com `autopilot.merge: true`, e só se `push` também estiver ligado.
  - A base padrão é a branch em que a execução começou.
  - Com branches empilhadas, a base do PR de cada história é a branch da história anterior.
- **Motivo**: a spec exige opção explícita para ações externas (FR-018). O `gh` já é a ferramenta do projeto.
- **Alternativas**: chamar a API do GitHub direto, rejeitado porque exigiria token próprio.

## R12. Estado e retomada

- **Decisão** (revista na implementação): `.specify/autopilot.json`, local e excluído pelo `.git/info/exclude`. Versionar o arquivo deixaria o estado sempre um commit atrás ou a árvore suja. Um passo interrompido vai para um `git stash` nomeado. O arquivo guarda `{ version: 1, id, input, inputHash, baseBranch, status, stories: [{ title, hash, feature?, branch?, steps: { [passo]: { status, sha?, rounds, attempts, ms, tokens } } }] }`.
  - A gravação é atômica (arquivo temporário e `rename`).
  - Na retomada, o driver confere duas coisas: o hash do arquivo de entrada e a existência da branch e do último SHA. A árvore suja não impede a retomada (revisto depois): as alterações entram no commit do próximo passo. Se o arquivo de histórias mudou, a retomada só segue com as histórias que não começaram, e as alteradas são recusadas com aviso.
  - Uma execução `active` cujo processo morreu é tratada como `interrupted`, porque o estado é gravado por um único processo, e um campo `pid` com o horário identifica a execução viva.
- **Motivo**: retomar do primeiro passo não concluído com garantia de que o repositório é o mesmo (FR-021, FR-022).
- **Alternativas**: guardar o estado em `.maestro/`, que é ignorado pelo git, rejeitado porque a retomada se perderia num clone novo.

## R13. Preflight do clarify (achado na implementação)

- **Decisão**: o `preflightFor` (`src/speckit/discovery.ts`) preserva o `--paths-only` do clarify. Antes ele descartava a opção e caía na checagem padrão, que exige `plan.md`. Com isso, `/speckit.clarify` era bloqueado antes do `/speckit.plan`, também fora do autopiloto. Há um teste de regressão em `tests/unit/speckit/discovery.test.ts`.
