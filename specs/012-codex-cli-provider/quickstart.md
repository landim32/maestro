# Quickstart: Provedor Codex

Validação manual com o Codex real. Os testes automatizados usam o `fakeCodex`.

## Pré-requisitos

```bash
npm install -g @openai/codex   # ou outro instalador; versão >= 0.161.0
codex login                    # entrar com a conta do ChatGPT
codex login status             # "Logged in using ChatGPT"
npm run build
```

## 1. Habilitar pelo /auth

```bash
node dist/index.js
/auth codex
```

O diálogo deve mostrar a versão, o método "conta do ChatGPT" e a pergunta se quer ativar o provedor. Escolha "sim". A barra de status deve mostrar `codex · gpt-6-luna`, e `~/.maestro/settings.json` deve ter `providers.codex.enabled: true`.

## 2. Conversa e modelo

- Envie "diga oi". A resposta aparece com a marca `codex`.
- `/model codex gpt-5.6-terra`, envie de novo e confira o modelo na barra de status.
- Envie uma pergunta longa e aperte Esc. O turno termina como cancelado, e o Gerenciador de Tarefas não mostra nenhum `codex.exe` sobrando.

## 3. Ferramentas e aprovação

- Modo `default`: "crie o arquivo teste-codex.txt com 'oi'". O diálogo de confirmação aparece com o diff. Recuse: o arquivo não existe e o modelo recebe a recusa.
- "leia o package.json e diga o nome do pacote". Aparece `⏺ Read(package.json)` sem confirmação.
- "rode `git status`". O pedido de confirmação de comando é do Maestro, não do Codex.
- "leia C:/Windows/win.ini". A leitura é recusada por estar fora da pasta.
- Peça explicitamente para o modelo usar o shell dele. Nada roda fora das ferramentas do Maestro.

## 4. Spec Kit

```bash
node dist/index.js -p "/speckit.specify teste do provedor codex"
```

Rode com `activeProvider: "codex"` ou com a rota `speckit.specify` apontando para `codex`. O passo nativo de `create-new-feature` é interceptado e a spec é criada. Desfaça a branch de teste depois.

Autopiloto (T019, manual): com `routes` apontando `speckit.*` para `codex`, rode `/autopilot historias.md` numa cópia de teste e confira que os passos avançam e que os commits saem por passo. O teste automatizado do autopiloto usa um único modelo roteirizado no laço interno de ferramentas, então este caso fica coberto aqui e pelos testes do caminho conduzido pelo provedor.

## 5. Erros

- `providers.codex.command: "C:/nao/existe/codex.exe"`, depois `/auth codex`. Aparecem as dicas de instalação.
- `codex logout`, depois um turno. Aparece o erro `auth` com "rode `codex login`". Logue de novo.
- `/model codex gpt-inexistente`, depois um turno. Aparece o erro do provedor com a mensagem do Codex, sem JSON bruto.

## 6. Segurança

- Com `--debug`, `~/.maestro/debug.log` tem `codex.start`/`codex.exit` sem prompt, e-mail ou token.
- Durante um turno com ferramentas, a lista de processos (`wmic process where "name='codex.exe'" get commandline`) não mostra o token da ponte.
