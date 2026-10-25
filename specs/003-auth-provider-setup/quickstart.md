# Quickstart: /auth e seletor /model

**Feature**: `003-auth-provider-setup`

## Rodar

```powershell
cd C:\repos\maestro
npm run build
node dist/index.js
```

## Validação por história

1. **US1 – Qwen pelo diálogo**: digite `/auth`, escolha **Qwen**, escolha o protocolo (OpenAI compatível ou Anthropic compatível; ↓ alterna), aceite o endpoint proposto (ou edite a URL), cole a chave (aparece como `••••`), aceite o modelo. Veja `Testando conexão…`; em sucesso responda `Sim` para ativar. Envie "olá": a resposta vem do Qwen e `%USERPROFILE%\.maestro\settings.json` contém `providers.qwen.enabled: true` e `activeProvider: "qwen"`. Repita com uma chave errada: `Falha: chave rejeitada (401)` com `Corrigir chave de API` selecionado.
2. **US1 – Claude API**: `/auth` → **Claude API** → cole uma chave `sk-ant-…` → Enter nos opcionais. O teste usa a consulta do modelo (sem custo). Confirme que `/model` mostra `claude` com `chave ****xxxx`.
3. **US2 – Claude Auth Login**: `/auth` → **Claude Auth Login**. Com a CLI `ant` instalada, o navegador abre; autorize e veja `Login concluído`. Para testar a ausência da CLI, rode com `PATH` sem a pasta do `ant` e renomeie temporariamente `%LOCALAPPDATA%\Programs\ant\ant.exe`: o diálogo mostra as instruções e `Tentar novamente`. Pressione Esc durante `Aguardando autorização…` para confirmar o cancelamento.
4. **US3 – Seletor**: `/model` abre a lista com o ativo marcado; selecione o outro provedor e envie uma mensagem; reabra o Maestro e confirme que o ativo persistiu. `/model qwen qwen-max` por texto continua funcionando sem diálogo.
5. **Modo `-p`**: `node dist/index.js -p "/auth"` imprime a orientação textual e retorna 0.

## Checagens rápidas

```bash
npm test -- tests/unit/setup tests/unit/config/writer.test.ts
npm test -- tests/integration/ui/dialogs.auth.test.tsx tests/integration/ui/dialogs.model.test.tsx
```
