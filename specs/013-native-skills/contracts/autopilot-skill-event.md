# Contrato: evento `skill.load` no registro do autopiloto

## 1. Ligação

- `SessionController.runOverrides` passa a aceitar `onToolResult?: (name: string, result: ToolResult) => void`. O controller o chama no `onToolEnd` de cada chamada de ferramenta do `submit`, nos dois laços (embutido e conduzido pelo provedor). Ao restaurar, o callback anterior volta (`undefined` fora do autopiloto).
- O `AutopilotDriver.start` e o `resume` instalam o callback no mesmo `runOverrides` que já instala `ask`, `confirm`, `approvalMode` e `networkRetries`.

## 2. Gravação

Quando `result.display?.skill` existe:

```ts
appendJsonl(root, runId, {
  event: 'skill.load',
  story: s.story + 1,
  feature: run.stories[s.story].feature,   // omitido se ainda não houver
  step: s.step,
  skill: d.name,
  source: d.source,                        // omitido se o nome não existe
  file: d.file,                            // omitido se não houver
  ok: d.ok,
});
logger.log('autopilot.skill', { story, step, ok });
```

- `s` é o `Step` corrente do driver, o mesmo que o decisor usa para preencher `story` e `step` nas decisões.
- As chamadas de outras ferramentas não geram evento.
- Uma chamada de `load_skill` feita pelo decisor (`autopilot.decide`) não ocorre, porque o decisor roda sem ferramentas.

## 3. Garantias

- Uma linha por chamada, inclusive as que falharam (`ok: false`) e as repetidas.
- Sem conteúdo da skill, sem a saída da ferramenta e sem caminho absoluto (FR-016). O `noSecrets` verifica que o `.jsonl` não contém o corpo de uma skill de teste.
- O evento não altera o `decisions.md` nem o estado `.specify/autopilot.json`.

## 4. Relatório

O relatório final do autopiloto não muda nesta versão. A consulta é feita no `.jsonl`, por exemplo com `grep skill.load .maestro/autopilot/<id>.jsonl` (SC-005).
