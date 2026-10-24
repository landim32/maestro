# Quickstart: Maestro CLI (MVP)

**Feature**: `001-maestro-cli-mvp`

## Pré‑requisitos

- Node.js ≥ 22 e npm (verifique com `node --version`).
- Credenciais de pelo menos um provedor:
  - **Claude**: uma das opções abaixo, uma única vez.
    ```bash
    # Opção A — perfil OAuth reutilizável pelo SDK e pelo Claude Code
    # A CLI `ant` não está no npm: baixe o binário em
    # https://github.com/anthropics/anthropic-cli/releases (Windows: arquivo windows_amd64.zip,
    # extraia ant.exe para uma pasta no PATH) ou use `brew install anthropics/tap/ant` no macOS.
    ant auth login
    # Opção B — chave de API
    export ANTHROPIC_API_KEY=sk-ant-...          # PowerShell: $env:ANTHROPIC_API_KEY = "sk-ant-..."
    ```
    O login do próprio Claude Code **não** é lido pelo SDK; é preciso uma das opções acima.
  - **Qwen (Alibaba Cloud)**: chave DashScope.
    ```bash
    export DASHSCOPE_API_KEY=sk-...              # PowerShell: $env:DASHSCOPE_API_KEY = "sk-..."
    ```

## Desenvolvimento

```bash
git clone <repo> maestro && cd maestro
npm install
npm run build          # tsc → dist/
npm link               # disponibiliza o comando `maestro` globalmente (ou use `node dist/index.js`)
npm test               # vitest, sem rede
npm run dev            # tsx src/index.ts (sem build)
```

## Primeira execução

```bash
maestro
```

Na primeira vez o Maestro cria `~/.maestro/settings.json` (Windows: `%USERPROFILE%\.maestro\settings.json`) e mostra o estado dos provedores. Edite o arquivo para ativar o Qwen:

```json
"qwen": {
  "enabled": true,
  "model": "qwen3-coder-plus",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKey": "sk-..."
}
```

Fora da China use `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`. Prefira `DASHSCOPE_API_KEY` no ambiente a gravar a chave no arquivo.

## Uso

```bash
maestro                              # sessão interativa com o provedor ativo
maestro --provider qwen              # força o Qwen nesta sessão
maestro -p "explique o que faz src/index.ts"   # modo não interativo
```

Dentro da sessão:

| Comando / tecla | Efeito |
|---|---|
| `/model` | Mostra provedor ativo e estado de cada provedor |
| `/model qwen` | Troca para o Qwen mantendo a conversa |
| `/clear` | Nova conversa |
| `/help` | Lista comandos |
| `/exit` | Sai |
| Esc | Cancela a resposta em geração |
| `y` / `n` | Aprova / recusa uma ação de escrita ou comando proposta pelo modelo |

## Validação rápida das histórias

1. **US1**: `maestro`, envie "meu nome é Rodrigo", depois "qual é o meu nome?" → a 2ª resposta cita o nome. `/exit` encerra sem erro.
2. **US2**: `/model` lista `claude` e `qwen`; `/model qwen` → próxima resposta vem do Qwen; `/model claude` volta. Com `DASHSCOPE_API_KEY=invalida`, enviar mensagem no Qwen exibe erro de autenticação **sem** encerrar a sessão.
3. **US3**: "liste os arquivos desta pasta" → resposta baseada em `list_directory`; "crie um arquivo hello.txt com olá" → diálogo de confirmação; `n` → arquivo não existe; `y` → arquivo criado.
4. **US4**: `maestro -p "diga olá"` imprime a resposta e retorna código 0; `maestro -p "oi" --provider qwen` com chave inválida retorna código 1 e mensagem em stderr.

## Configuração por projeto (opcional)

Crie `./.maestro/settings.json` na raiz do projeto com apenas as chaves a sobrescrever, por exemplo `{ "activeProvider": "qwen" }`. Adicione `.maestro/` ao `.gitignore` se o arquivo contiver chaves.
