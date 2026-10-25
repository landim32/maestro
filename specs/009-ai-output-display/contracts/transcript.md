# Contract: Transcrição (US2, FR-009–FR-015, FR-021)

## 1. Assistente

```text
⏺ <primeira linha do markdown>
  <demais linhas recuadas 2 colunas>
```

- O marcador aparece só no primeiro bloco de texto de cada mensagem do assistente. Ele é cinza e fica branco no streaming.
- A linha de rota da feature 008 (`⇢ rota · provedor / modelo`) continua acima do marcador.

## 2. Chamada de ferramenta

```text
⏺ Read(src/index.ts)
  ⎿  Leu 120 linhas
```

- O rótulo vem em negrito e o argumento entre parênteses. Um argumento maior que a largura menos o rótulo menos 4 é cortado com `…` no meio para caminhos e no fim para comandos.
- O resultado aparece abaixo, recuado, começando por `⎿`, com os resumos da research R9.
- Enquanto a chamada não tem resultado, aparece só a linha `⏺`.
- Uma ação liberada por modo acrescenta `· auto (Aceitar edições)` ao resumo.
- Uma recusa mostra `⎿  recusado pelo usuário`, em amarelo.
- Um cancelamento mostra `⎿  cancelado`.
- Um erro mostra o texto completo até 20 linhas, mais `… +N linhas`, em vermelho.
- Um passo nativo do Spec Kit aparece como `⏺ Speckit(create-new-feature)` com `⎿  <summary>`, e os avisos do passo vêm em amarelo nas linhas seguintes.

## 3. Mensagens `tool`

Não são desenhadas, porque o resultado aparece junto da chamada. Um `tool_result` cujo `callId` não está em nenhuma chamada aparece no formato genérico `⎿  <primeira linha>`.

## 4. Avisos

Na sessão interativa, o controller não emite mais os avisos abaixo, porque o conteúdo passou para a transcrição:

- `⚙ <tool> <arg>`
- `⚙ … · auto (…)`
- `⚠ <tool>: …`
- `⚙ speckit …`

Os demais avisos (rotas, colagens, erros de provedor) continuam iguais.

## 5. `-p`

- O stdout continua sendo só o texto das respostas, idêntico ao de antes (SC-007).
- Os avisos `⚙`/`⚠` continuam no stderr como hoje.
- O resumo `✻` não é emitido.

## 6. Estabilidade

Uma mensagem concluída só muda de altura quando o resultado das suas chamadas chega. Depois disso o `memo` mantém o item estável, comparando `message.id`, a largura, a cor e a referência dos resultados.
