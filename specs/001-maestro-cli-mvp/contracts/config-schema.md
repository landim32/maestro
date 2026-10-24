# Contract: Configuração (`settings.json`)

**Feature**: `001-maestro-cli-mvp`

## 1. Localização e precedência

| Nível | Caminho | Observação |
|---|---|---|
| Global | `~/.maestro/settings.json` (`%USERPROFILE%\.maestro\settings.json` no Windows) | Criado na primeira execução. `--config` substitui. |
| Projeto | `./.maestro/settings.json` (relativo a `cwd`) | Opcional. Merge raso por chave sobre o global (`providers.qwen` do projeto substitui `providers.qwen` inteiro). |
| Ambiente | variáveis listadas em § 3 | Prevalecem sobre ambos os arquivos para segredos e URL. |
| Linha de comando | `--provider`, `--model`, `--no-tools` | Prevalecem sobre tudo, só para a execução atual. |

Ordem final: **args > env > projeto > global > padrões internos**.

## 2. JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Maestro settings",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "_comment": { "type": "string" },
    "activeProvider": { "type": "string", "enum": ["claude", "qwen"] },
    "providers": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "claude": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "_comment": { "type": "string" },
            "enabled": { "type": "boolean", "default": true },
            "model": { "type": "string", "minLength": 1, "default": "claude-opus-5-5" },
            "maxTokens": { "type": "integer", "minimum": 1, "maximum": 200000, "default": 16000 },
            "apiKey": { "type": "string", "minLength": 1 },
            "baseUrl": { "type": "string", "format": "uri", "pattern": "^https?://" },
            "effort": { "type": "string", "enum": ["low", "medium", "high", "xhigh", "max"], "default": "medium" },
            "fallbacks": { "type": "boolean", "default": true }
          }
        },
        "qwen": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "_comment": { "type": "string" },
            "enabled": { "type": "boolean", "default": false },
            "model": { "type": "string", "minLength": 1, "default": "qwen3-coder-plus" },
            "maxTokens": { "type": "integer", "minimum": 1, "maximum": 200000, "default": 16000 },
            "apiKey": { "type": "string", "minLength": 1 },
            "baseUrl": { "type": "string", "format": "uri", "pattern": "^https?://", "default": "https://dashscope.aliyuncs.com/compatible-mode/v1" }
          }
        }
      }
    },
    "tools": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled": { "type": "boolean", "default": true },
        "commandTimeoutMs": { "type": "integer", "minimum": 1000, "default": 60000 },
        "maxOutputChars": { "type": "integer", "minimum": 1000, "default": 20000 }
      }
    },
    "ui": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "color": { "type": "boolean" }
      }
    }
  }
}
```

Regras adicionais aplicadas pelo loader (além do schema):
- `baseUrl`: barra final removida; esquema obrigatório (`dashscope.aliyuncs.com/...` sem `https://` → erro `providers.qwen.baseUrl: must start with http:// or https://`).
- `activeProvider` apontando para provedor `enabled: false` → aviso e pré‑voo trata como "não configurado".
- Erro de parse JSON → `settings.json: invalid JSON at line N, column M`.
- Erro de schema → uma linha por problema no formato `<caminho.do.campo>: <motivo>`; o Maestro **não** inicia (FR‑014).

## 3. Variáveis de ambiente

| Variável | Provedor | Efeito |
|---|---|---|
| `ANTHROPIC_API_KEY` | claude | Chave de API. Resolvida pelo próprio SDK. |
| `ANTHROPIC_AUTH_TOKEN` | claude | Token OAuth (ex.: `ant auth print-credentials --env`). Resolvido pelo SDK. |
| `ANTHROPIC_BASE_URL` | claude | Endpoint alternativo. Resolvido pelo SDK. |
| `ANTHROPIC_PROFILE` | claude | Seleciona perfil do `ant auth login`. Resolvido pelo SDK. |
| `DASHSCOPE_API_KEY` | qwen | Chave de API; prevalece sobre `providers.qwen.apiKey`. |
| `DASHSCOPE_BASE_URL` | qwen | Endpoint; prevalece sobre `providers.qwen.baseUrl`. |
| `MAESTRO_PROVIDER` | — | Equivale a `--provider`. |
| `MAESTRO_CONFIG` | — | Equivale a `--config`. |
| `NO_COLOR` | — | Desliga cores. |

O Maestro **nunca** define, loga ou repassa estas variáveis a outro provedor (FR‑020).

## 4. Exemplo gerado na primeira execução

```json
{
  "_comment": "Maestro settings. Edit providers below. Secrets may also come from env vars: ANTHROPIC_API_KEY (or 'ant auth login') for claude, DASHSCOPE_API_KEY for qwen.",
  "activeProvider": "claude",
  "providers": {
    "claude": {
      "_comment": "Uses credentials already on this machine: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an 'ant auth login' profile. Set apiKey here only if you must.",
      "enabled": true,
      "model": "claude-opus-5-5",
      "maxTokens": 16000,
      "effort": "medium",
      "fallbacks": true
    },
    "qwen": {
      "_comment": "Alibaba Cloud DashScope (OpenAI-compatible). Set apiKey (or DASHSCOPE_API_KEY) and set enabled to true. International endpoint: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      "enabled": false,
      "model": "qwen3-coder-plus",
      "maxTokens": 16000,
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKey": ""
    }
  },
  "tools": {
    "enabled": true,
    "commandTimeoutMs": 60000,
    "maxOutputChars": 20000
  }
}
```

Nota: `apiKey: ""` no exemplo é tratado como ausente (string vazia é normalizada para `undefined` antes da validação, para que o arquivo gerado seja válido).

## 5. Mascaramento

Toda exibição de chave usa `mask(key) = "****" + key.slice(-4)` (chaves com ≤ 4 caracteres → `"****"`). Aplica‑se a `/model`, mensagens de erro, `--debug` log e qualquer dump de configuração (FR‑019, SC‑006).

## 6. Testes de contrato derivados

- O exemplo da § 4 valida contra o schema da § 2 sem erros.
- Cada regra adicional da § 2 tem um caso negativo com a mensagem exata.
- `DASHSCOPE_API_KEY` definido + `providers.qwen.apiKey` definido → `credentialSource = "env"`.
- `ANTHROPIC_API_KEY` ausente + `providers.claude.apiKey` ausente + sem perfil → `ProviderStatus.claude.configured = false`, `missing = ["credentials"]`.
