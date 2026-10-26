# Contract: `providers.codex` no settings.json

```json
{
  "providers": {
    "codex": {
      "_comment": "Uses the Codex CLI installed and logged in on this machine (your ChatGPT subscription, no API key). Maestro never reads its credentials. Enable with /auth -> Codex. command: optional path to the codex executable.",
      "enabled": false,
      "model": "gpt-6-luna",
      "models": ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"],
      "effort": "medium"
    }
  }
}
```

- Sem a chave, vale o padrão acima (provedor desabilitado). Nenhum comportamento muda (FR-003, SC-007).
- `command` é opcional. Quando presente, precisa ser uma string não vazia.
- Chave desconhecida → erro de validação `providers.codex.<chave>`, como nos outros provedores.
- `/auth` → Codex grava só `providers.codex.enabled = true` e, se o usuário aceitar, `activeProvider = "codex"`.
- Rotas: `{"provider": "codex", "model": "gpt-5.6-terra", "effort": "high"}` é válido. `maxTokens` é aceito pelo schema e ignorado pelo provedor.
- `/model codex <modelo>` e `/auth codex` seguem as mesmas regras do `claude-code`.
