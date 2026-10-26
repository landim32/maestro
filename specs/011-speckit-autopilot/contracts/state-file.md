# Contract: `.specify/autopilot.json` e retomada

## 1. Gravação

- O arquivo é gravado depois de cada transição do reducer, de forma atômica (`.tmp` e `rename`).
- Só o autopiloto escreve nele. Antes de cada commit, o driver o regrava a partir da memória, o que descarta edições do modelo.
- O arquivo é **local**: o autopiloto o acrescenta, junto com `.maestro/autopilot/`, ao `.git/info/exclude`, nunca ao `.gitignore`. Assim ele não entra nos commits e gravá-lo depois de um commit não suja a árvore. A retomada vale no mesmo clone (decisão tomada na implementação).
- Um passo interrompido guarda o trabalho parcial num `git stash` nomeado `maestro autopilot <id>: <feature> <passo> interrompido`. A árvore fica limpa e o passo recomeça do zero na retomada.

## 2. Esquema (zod, `version: 1`)

Ver data-model.md § 3–5. Um campo desconhecido ou uma versão diferente faz a retomada ser recusada com a mensagem `Estado do autopiloto em formato desconhecido (versão N).`

## 3. Retomada (`--resume` ou o mesmo arquivo com execução interrompida)

1. Ler e validar o estado.
2. `status` precisa ser `interrupted` ou `stopped`. Se for `active`, ele só é aceito quando o `pid` registrado não está mais vivo, e passa a ser tratado como `interrupted`.
3. A árvore **não** precisa estar limpa. As alterações não commitadas ficam onde estão e entram no commit do próximo passo. Se a troca de branch do item 6 conflitar com elas, a retomada é recusada com `Não foi possível trocar para a branch <branch>: as alterações não commitadas conflitam com ela.`
4. Para cada história com `branch`, a branch precisa existir e conter o `sha` do último passo concluído (`git merge-base --is-ancestor`).
5. O hash do arquivo de entrada:
   - igual: tudo segue;
   - diferente: as histórias já iniciadas precisam manter o mesmo `hash`, senão a retomada é recusada. Histórias novas no fim do arquivo são acrescentadas.
6. Fazer checkout da branch da história atual. Se ela ainda não tem branch, usar a branch da anterior, ou `baseBranch`.
7. Recomeçar no primeiro passo com status diferente de `done`. Um passo `failed` recomeça do zero, com tentativas zeradas.

Se uma verificação falhar, nada é alterado no repositório e a mensagem diz qual conferência falhou.
