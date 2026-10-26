# Contract: Passos, portões e rodadas

## 1. Sequência e turnos

| # | Passo | Turno inicial | Rota |
| --- | --- | --- | --- |
| 1 | specify | `/speckit.specify <título>\n\n<descrição>` | `speckit.specify` |
| 2 | clarify | `/speckit.clarify` | `speckit.clarify` |
| 3 | plan | `/speckit.plan` | `speckit.plan` |
| 4 | tasks | `/speckit.tasks` | `speckit.tasks` |
| 5 | analyze | `/speckit.analyze` | `speckit.analyze` |
| 6 | implement | `/speckit.implement` | `speckit.implement` |
| 7 | verify | (sem turno) roda `autopilot.verify.command` | — |

- Antes de um passo novo, o histórico é limpo.
- As rodadas do mesmo passo não limpam o histórico.
- O modo de aprovação durante toda a execução é `auto`.
- Confirmações são recusadas.
- O `ask_user` vai para o decisor.

## 2. Portões

| Passo | Aprova quando | Rodada extra | Para quando |
| --- | --- | --- | --- |
| specify | a feature foi criada (pasta `specs/NNN-*` nova com `spec.md`) e a branch atual é a da feature | resposta a pergunta em texto (≤ 3) | sem feature ou sem `spec.md` |
| clarify | `spec.md` existe | resposta a pergunta em texto (≤ 3) | erro do turno |
| plan | `plan.md` criado ou alterado | idem | sem `plan.md` |
| tasks | `tasks.md` tem pelo menos uma `- [ ] T` ou `- [X] T` | idem | sem tarefas |
| analyze | `Critical Issues Count` = 0, ou nenhuma linha de achado com `CRITICAL` | 1 correção: "Resolva os achados CRITICAL acima ajustando spec.md, plan.md e tasks.md; não altere código." Depois, `/speckit.analyze` de novo | ainda há CRITICAL depois da correção |
| implement | 0 tarefas abertas no `tasks.md` | "continue" enquanto cada rodada marcar ≥ 1 tarefa nova; resposta a pergunta em texto (como o "(yes/no)" dos checklists) | uma rodada sem tarefa nova |
| verify | todos os comandos saem com 0 | até `maxAttempts` vezes: "A verificação falhou. Corrija o código para que passe:\n<comando>\n<últimas 200 linhas>" (no histórico do implement), depois verificar de novo | ainda falha depois das tentativas |

Regras que valem para todos os passos:
- Um passo aprovado sem mudanças no disco (analyze, clarify sem ajustes, verify que passou de primeira) não gera commit. O SHA atual é registrado.
- Um turno com `stopReason: 'error'` falha o portão. Se o erro for `rate_limit` ou cancelamento, o passo fica `interrupted`.
- Um preflight bloqueado (`CommandBlocked`) falha o portão com a mensagem do preflight.
- Todas as rodadas contam para `limits.turns`, `limits.minutes` e `limits.tokens`. Estourar um deles para a história com `limitExceeded`.

## 3. Detecção de pergunta em texto

O último parágrafo do texto final do turno é considerado uma pergunta ao usuário quando, depois de normalizado:
- contém `(yes/no)`, `(sim/não)`, `(y/n)` ou `[y/N]`; **ou**
- termina em `?` e contém um destes trechos: `do you want`, `would you like`, `should i`, `shall i`, `deseja`, `quer que`, `posso`, `confirma`, `prefere`; **ou**
- contém `Your choice` ou `Sua escolha`, como nos blocos de clarificação do specify.

O texto já respondido numa rodada anterior não dispara de novo.
