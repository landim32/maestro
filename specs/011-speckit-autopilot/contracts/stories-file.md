# Contract: Arquivo de histórias

```markdown
# Backlog (opcional; títulos de nível 1 são ignorados)

## Login com Google
Como usuário, quero entrar com minha conta Google para não criar outra senha.
Critérios: botão na tela de login; conta nova criada no primeiro acesso.

## Exportar relatório em CSV
Como gestor, quero exportar o relatório mensal em CSV.
```

- Cada título `## ` começa uma história. O título é o nome, e o texto até o próximo `## ` é a descrição.
- Texto antes do primeiro `## ` é contexto comum e vai anexado à descrição de todas as histórias, com o prefixo `Contexto do backlog:`.
- Um arquivo sem nenhum `## ` é uma única história, com título igual à primeira linha não vazia e descrição igual ao arquivo inteiro.
- Histórias com descrição vazia são recusadas, com o título citado na mensagem.
- Títulos de nível 3 ou mais fazem parte da descrição.
- A descrição enviada ao `specify` é `<título>\n\n<descrição>`, o mesmo texto que o usuário digitaria depois de `/speckit.specify`.
