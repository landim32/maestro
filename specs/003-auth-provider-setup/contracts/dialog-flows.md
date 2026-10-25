# Contract: Fluxos dos Diálogos

**Feature**: `003-auth-provider-setup`

## 1. Moldura comum (`DialogFrame`)

- Ocupa a área do transcript (mesma região, altura limitada pelo layout da feature 002); cabeçalho, prompt (inativo) e barra de status permanecem.
- Título à esquerda (`Conectar provedor`, `Selecionar modelo`), rodapé com as teclas válidas no passo atual.
- Sem cores: moldura simples, marcador de seleção `>`; com cores: borda ciano, item selecionado invertido.
- Teclas globais enquanto aberto: ↑/↓ navegam; Enter confirma; Esc volta um passo (ou fecha no menu); Ctrl+C duplo continua saindo do Maestro; Page Up/Down ignorados; nenhuma tecla chega ao prompt de texto.

## 2. Menu do `/auth`

Itens, nesta ordem, com estado à direita:

```text
> Claude API          chave de API da Anthropic                 [não configurado | configurado (chave ****abcd) | ativo]
  Claude Auth Login   login no navegador (perfil OAuth)          [não configurado | configurado (perfil) | ativo]
  Qwen                Alibaba Cloud DashScope (OpenAI-compatível)[não configurado | configurado (chave ****wxyz) | ativo]
```

Rodapé: `↑↓ navegar · Enter selecionar · Esc fechar`.

## 3. Campos por método (`TextField`)

| Método | Ordem | Rótulo | Pré‑preenchido | Validação |
|---|---|---|---|---|
| Claude API | 1 | Chave de API (sk-ant-…) | vazio ou `****abcd` se já houver (Enter mantém) | não vazio após trim; sem espaços internos |
| Claude API | 2 | Endpoint (opcional) | `baseUrl` atual ou vazio | vazio ou `^https?://` |
| Claude API | 3 | Modelo | `claude-opus-5-5` ou atual | não vazio |
| Qwen | 1 | Protocolo (escolha ↑↓) | `OpenAI compatível` (padrão) ou `Anthropic compatível`; atual se já configurado. Cada opção mostra o endpoint padrão | uma das duas opções |
| Qwen | 2 | Endpoint | padrão do protocolo escolhido — OpenAI: `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1`; Anthropic: `https://token-plan.maas.qwencloudapi.com/apps/anthropic` — ou atual; hint: DashScope `https://dashscope.aliyuncs.com/compatible-mode/v1` / `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `^https?://` |
| Qwen | 3 | Chave de API (sk-…) | vazio ou `****wxyz` | não vazio; sem espaços |
| Qwen | 4 | Modelo | `qwen3-coder-plus` ou atual | não vazio |

Campo de escolha (`kind: 'choice'`): ↑↓ alternam a opção, digitação é ignorada, Enter confirma. Ao trocar o protocolo, o endpoint acompanha o novo padrão **apenas** se ainda estiver vazio ou igual a um dos padrões conhecidos; uma URL editada pelo usuário é preservada. Rodapé: `↑↓ escolher · Enter confirmar · Esc voltar`.

Comportamento do campo: digitação em campo secreto mostra `•` por caractere; colagem remove espaços e quebras de linha; Ctrl+U limpa; Enter valida e avança; Esc volta ao campo anterior (ou ao menu). Rodapé: `Enter avançar · Esc voltar · Ctrl+U limpar`.

## 4. Teste de conexão (`ProgressView` → `ResultView`)

- Texto: `Testando conexão com <provedor>…` com spinner textual (`⠋⠙⠹…` ou `-\|/` sem cores) e `Esc cancelar`.
- Limite: 10 s. Timeout → categoria `timeout`.
- Falha: `Falha: <mensagem>` + opções `Corrigir <campo>` (padrão), `Gravar sem testar`, `Voltar`.
- Sucesso: segue para gravação sem tela intermediária.

| Categoria | Mensagem (exemplo) | Campo |
|---|---|---|
| auth | `chave rejeitada (401)` | apiKey |
| network | `endpoint inacessível: <host>` | baseUrl |
| timeout | `sem resposta em 10 s` | baseUrl |
| model | `modelo desconhecido: <nome>` | model |
| provider | `erro do provedor: <resumo>` | — |

## 5. Gravação e ativação

- `Gravando em <caminho>…` (instantâneo). Falha → `Não foi possível gravar <caminho>: <causa>. A configuração vale só nesta sessão.` + `Voltar`.
- Avisos possíveis exibidos na tela de ativação: `./.maestro/settings.json sobrescreve providers.qwen.apiKey nesta pasta.` · `ANTHROPIC_API_KEY está definida e tem precedência sobre o perfil.`
- Pergunta: `Usar <provedor> como provedor ativo?` opções `Sim` (padrão) / `Não`.
- Conclusão: `✓ <provedor> configurado` (+ `e ativo`) e linha de confirmação na conversa (`Conectado: qwen / qwen3-coder-plus`).

## 6. Claude Auth Login

| Passo | Tela |
|---|---|
| detect | `Procurando a CLI ant…` (instantâneo) |
| missing | `A CLI 'ant' da Anthropic não foi encontrada.` + instruções por SO (research R3) + opções `Tentar novamente` / `Voltar` |
| running | `Aguardando autorização no navegador…` + (se capturada) `Se o navegador não abriu, acesse: <url>` + `Esc cancelar` |
| done | `Login concluído: <resumo de ant auth status>` → tela de ativação |
| failed | `Login não concluído: <causa>` + `Tentar novamente` / `Voltar` |

Processo: `ant auth login --timeout 5m`, stdio `['ignore','pipe','pipe']`; cancelar = encerrar árvore de processos. Sucesso = código 0 **e** `ant auth status` contém `Logged in to`.

## 7. Seletor do `/model`

```text
Selecionar modelo
> ● claude / claude-opus-5-5      perfil            (ativo)
  ○ qwen   / qwen3-coder-plus     chave ****wxyz
  ○ qwen   / …                    não configurado — configure com /auth   (desativado)
  ○ Digitar outro modelo…
```

Enter em item habilitado → troca + gravação + fecha; "Digitar outro modelo…" → `TextField` (`Modelo para <provedor>`) → Enter aplica. Itens desativados são pulados pela navegação. Rodapé: `↑↓ navegar · Enter selecionar · Esc fechar`.

## 8. Testes derivados

- Ordem e rótulos dos campos por método (tabela § 3) e pré‑preenchimento com valores atuais.
- Mascaramento: frame nunca contém a chave digitada; contém `•` durante a digitação e `****` + 4 últimos depois.
- Cada tecla do § 1 nos estados `menu`, `fields`, `testFailed`, `activate`, `login.running`.
- Mensagens e campo-alvo por categoria (§ 4).
- Argumentos exatos do `ant` (§ 6) e detecção de sucesso por `Logged in to`.
- Seletor: item ativo marcado, desativado não selecionável, "Digitar outro modelo…" abre campo.
