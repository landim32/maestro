# Contract — Catálogo de modelos e seletor `/model`

**Branch**: `004-history-model-catalog` · **Date**: 2026-10-25

## 1. `settings.json`

```jsonc
"providers": {
  "claude": { "model": "claude-opus-5-5",
              "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  "qwen":   { "model": "qwen3-coder-plus",
              "models": ["qwen3-coder-plus", "qwen3-coder-flash", "qwen3-max"] }
}
```

- `models` é opcional; ausente ou `[]` → lista padrão do provedor (acima). O arquivo gerado na primeira execução traz as duas listas.
- Validação: item deve casar `^\S+$`; sem repetidos. Erros seguem o formato existente `providers.<id>.models[.<i>]: <motivo>` e impedem o início (como os demais erros de configuração).
- Catálogo efetivo = `models` + `model` configurado (se não estiver na lista, entra no fim). `--model <nome>` por argumento aparece na sessão mas não é gravado.
- Precedência: `./.maestro/settings.json` que defina `providers.<id>` substitui o provedor inteiro (regra existente) — inclusive `models`. Modelos aprendidos são gravados no arquivo **global**; se o projeto sobrescrever, aviso `./.maestro/settings.json sobrescreve providers.<id>.models nesta pasta.`

## 2. Seletor `/model` (interativo)

```text
Selecionar modelo                                   ↑↓ navegar · Enter selecionar · Esc fechar
  claude · perfil
> ● claude-opus-5-5                                                 [ativo]
  ○ claude-sonnet-5-5
  ○ claude-haiku-5-5
  qwen · não configurado — configure com /auth
  ○ qwen3-coder-plus                                                (desativado)
  ○ qwen3-coder-flash                                               (desativado)
  ○ qwen3-max                                                       (desativado)
  ○ Digitar outro modelo…
```

- Cabeçalhos de grupo (`<provedor> · <origem da credencial | não configurado>`) não são selecionáveis; a navegação pula entradas de provedores não configurados e é cíclica, passando por "Digitar outro modelo…".
- Enter em um modelo: ativa provedor + modelo (conversa preservada), grava `activeProvider` e `providers.<id>.model`, fecha. Cabeçalho mostra `<provedor> / <modelo>`.
- Enter em "Digitar outro modelo…" → tela de provedor:

```text
Selecionar modelo · provedor                        ↑↓ escolher · Enter confirmar · Esc voltar
> claude      perfil
  qwen        não configurado — configure com /auth                 (desativado)
```

- Enter em provedor configurado → campo `Modelo para <provedor>` pré‑preenchido com o modelo atual do provedor; Esc volta à escolha do provedor; Esc de novo volta à lista.
- Enter no campo: vazio → `informe o modelo`; senão ativa provedor + modelo, grava `activeProvider`, `providers.<id>.model` e, se o nome não estiver no catálogo, `providers.<id>.models` (acrescentado ao fim, sem duplicar). Fecha com `<provedor> / <modelo>`.
- Falha ao gravar: o modelo fica ativo na sessão; aviso `Não foi possível gravar a configuração: <motivo>`; o diálogo fecha normalmente.
- Falha ao ativar (provedor desativado/não configurado): tela de erro com `Fechar` (inalterado).
- Modelo ativo fora do catálogo (arquivo editado ou `--model`): aparece marcado como última entrada do seu grupo.

## 3. `/model` por texto e modo `-p`

- `/model <id> <modelo>`: além de ativar e gravar `activeProvider`/`model`, acrescenta `<modelo>` a `providers.<id>.models` quando ausente (mesma regra do diálogo). `/model <id>` sem modelo usa o `model` configurado do provedor (inalterado).
- `/model` sem argumentos em `-p` (ou `describeProviders()`): tabela atual seguida dos catálogos:

```text
Active: claude / claude-opus-5-5

  id      status          model                    credentials
  claude  ready           claude-opus-5-5          profile
  qwen    not configured  qwen3-coder-plus         -  missing: apiKey

Models:
  claude: * claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5
  qwen:   qwen3-coder-plus, qwen3-coder-flash, qwen3-max
```

`*` marca o modelo ativo do provedor ativo.

## 4. Testes derivados

- Esquema: arquivo inicial válido com `models` nos dois provedores; `[]` → padrão; `"a b"` e duplicata rejeitados com caminho.
- Catálogo efetivo: inclui `model` configurado fora da lista; sem repetição; ordem preservada.
- Reducer: agrupamento e índices; navegação pula não configurados; `customProvider` bloqueia não configurado; `learn` verdadeiro só para nome novo; Esc em cada etapa.
- UI: seleção cruzada troca cabeçalho e persiste; "Digitar outro modelo…" → provedor → nome; reabrir `/model` mostra o modelo aprendido; falha de gravação mantém ativo e avisa.
- Texto: `/model qwen qwen3-max` grava `models`; `-p` lista `Models:` com `*` no ativo.
