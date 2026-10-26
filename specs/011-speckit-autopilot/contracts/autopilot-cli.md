# Contract: Comando e CLI do autopiloto

## 1. Sessão interativa

```text
/autopilot <arquivo>          # nova execução
/autopilot --resume           # retoma a execução interrompida ou parada
/autopilot --status           # mostra o estado salvo, sem executar
```

- Um `<arquivo>` relativo é resolvido a partir da pasta de trabalho, e precisa estar dentro dela (`resolveInsideCwd`).
- Rodar `/autopilot <mesmo arquivo>` com uma execução `interrupted` desse arquivo equivale a `--resume`. Com uma execução `active` de outro processo, o comando é recusado.
- Durante a execução:
  - a barra de status mostra `autopiloto · história 2/3 · plan`;
  - o prompt fica desativado, com o placeholder `autopiloto em execução — Esc para interromper`;
  - Esc cancela o turno atual, e o passo vira `interrupted`.
- O comando é local: não tem rota e não envia prompt próprio. Os turnos são dos passos.

## 2. Sem terminal

```bash
maestro -p --autopilot historias.md
maestro -p --autopilot historias.md --resume
```

- **stderr**: uma linha por evento.
  - `autopiloto: história 1/2 "Login" · specify…`
  - `autopiloto: história 1/2 · specify ok (1m 12s · 3 decisões)`
  - `autopiloto: história 1/2 · implement · continue (12/20 tarefas)`
  - Os avisos normais dos turnos (`⚙ read_file …`) continuam no stderr.
- **stdout**: só o relatório final (§ 3).
- **Códigos de saída**: `0` quando todas as histórias ficaram `done`; `1` quando uma história parou ou a execução foi interrompida; `2` quando a entrada é inválida (arquivo inexistente ou sem histórias), o projeto não é git, a árvore está suja, o Spec Kit não foi inicializado ou a configuração é inválida.
- `--autopilot` não pode ser combinado com um prompt posicional nem com `--route`, e a combinação dá código 2.

## 3. Relatório final

```text
Autopiloto 20261025-213000 · historias.md · base main
✓ 1/2 Login com Google · 012-login-google · 14 turnos · 18m 40s · 4 decisões
    specify ✓  clarify ✓  plan ✓  tasks ✓  analyze ✓ (1 correção)  implement ✓ (3 continues)  verify ✓
    PR: https://github.com/…/pull/12
✗ 2/2 Exportar relatório · 013-exportar · parou em verify (3 tentativas): npm test saiu com 1
    últimas linhas: …
Decisões: specs/012-login-google/decisions.md, specs/013-exportar/decisions.md
Registro: .maestro/autopilot/20261025-213000.jsonl
Retomar: /autopilot --resume   (ou maestro -p --autopilot historias.md --resume)
```

## 4. Recusas no início (código 2 no `-p`)

| Situação | Mensagem |
| --- | --- |
| não é repositório git | `O autopiloto precisa de um repositório git (commits por passo e retomada).` |
| árvore suja | `Há alterações não commitadas; faça commit ou stash antes de iniciar o autopiloto.` |
| Spec Kit ausente | `Spec Kit não instalado neste projeto; rode /speckit.init.` |
| arquivo sem histórias | `Nenhuma história em <arquivo>: use um título "## " por história.` |
| execução ativa | `Já existe uma execução ativa (pid N, iniciada às HH:MM).` |
