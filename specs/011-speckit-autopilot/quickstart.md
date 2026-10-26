# Quickstart: Modo autopiloto

Os cenários manuais rodam num repositório de teste descartável, nunca no próprio Maestro.

```bash
mkdir /tmp/ap-demo && cd /tmp/ap-demo && git init -q && npm init -y >/dev/null
git add -A && git commit -qm "init"
maestro -p "/speckit.init" && git add -A && git commit -qm "speckit"
```

Crie o arquivo `historias.md` com duas histórias pequenas:

```markdown
## Saudação
Como usuário, quero uma função greet(name) que devolve "Olá, <name>!".

## Despedida
Como usuário, quero uma função bye(name) que devolve "Tchau, <name>!".
```

Configure a verificação em `./.maestro/settings.json`:

```json
{ "autopilot": { "verify": { "command": ["node --test"] } } }
```

1. **Execução completa.** Rode `maestro -p --autopilot historias.md`. Confira:
   - o stderr mostra cada passo das duas histórias;
   - o código de saída é 0;
   - `git log --oneline` mostra um commit por passo;
   - existem as branches `001-saudacao` e `002-despedida`, com a segunda partindo da primeira.
2. **Decisões.** Abra `specs/001-saudacao/decisions.md`. Cada pergunta do clarify tem escolha e justificativa, e o `.maestro/autopilot/<id>.jsonl` tem as mesmas decisões.
3. **Sem ações externas.** Confira com `git remote -v` e com o GitHub que nada foi enviado.
4. **Interrupção e retomada.** Repita com um arquivo novo e aperte Ctrl+C durante o plan da primeira história. Depois rode `maestro -p --autopilot historias.md --resume`. Confira que ele recomeça no plan, sem refazer specify e clarify.
5. **Portão de verificação.** Configure `"command": ["node -e \"process.exit(1)\""]`. A história para em `verify` depois de 3 tentativas, o código de saída é 1 e o relatório mostra a saída.
6. **Árvore suja.** Altere um arquivo sem commitar e rode o autopiloto. Ele recusa com código 2.
7. **Sessão interativa.** Rode `/autopilot historias.md`. Confira:
   - a barra mostra `autopiloto · história 1/2 · specify`;
   - a transcrição mostra cada passo no formato `⏺`/`⎿`;
   - o Esc interrompe e `/autopilot --resume` continua.
8. **Comando destrutivo.** Inclua numa história "limpe a pasta com rm -rf build". O comando é recusado, e a recusa aparece na transcrição e no registro.
9. **Push e PR (opcional).** Em um repositório de teste com remoto e `gh` autenticado, ligue `"push": true` e rode. Confira que um PR por história é aberto contra a branch anterior e que nenhum merge acontece sem `"merge": true`.
