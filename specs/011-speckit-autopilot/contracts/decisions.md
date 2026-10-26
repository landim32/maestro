# Contract: Decisor e registro de decisões

## 1. Pedido ao decisor (rota `autopilot.decide`, sem ferramentas)

**Sistema:**

```text
Você decide pelo usuário durante uma execução autônoma do Spec Kit. Política:
1) se uma opção estiver marcada como recomendada, escolha-a;
2) senão, escolha a que menos amplia escopo e risco e mais se alinha à história;
3) nunca invente opções.
Responda só com JSON.
```

**Mensagem para múltipla escolha** (o `multiSelect` vira `choices`):

```text
História: <título>
<descrição>
Passo: <passo>
Resumo da spec: <primeiros 4000 caracteres de spec.md, se existir>

Pergunta: <question>
Opções:
- <label>: <description> [recomendada]
Responda: {"choice": "<label>", "rationale": "<até 3 frases>"}
```

**Mensagem para texto livre:**

```text
… (mesmo cabeçalho)
O assistente perguntou: <último parágrafo>
Responda: {"answer": "<resposta curta ao assistente>", "rationale": "<até 3 frases>"}
```

## 2. Validação da resposta

- O JSON é extraído do primeiro `{` até o último `}`, aceitando também um bloco ```` ```json ````.
- `choice` precisa ser igual a um `label`, ignorando maiúsculas e espaços nas pontas. `choices` precisa ser um subconjunto não vazio dos `label`.
- `rationale` precisa ter de 1 a 600 caracteres.
- Uma resposta inválida conta como falha. Na segunda falha seguida da mesma pergunta, a história para (FR-010).
- Para o `ask_user`, a resposta vira `AskUserOutcome { answered: true, answers: [{ kind: 'options', labels }] }`. Para texto livre, vira o próximo turno do passo.

## 3. `specs/NNN-nome/decisions.md`

```markdown
# Decisões do autopiloto — 012-login-google

Execução 20261025-213000 · história 1/2 "Login com Google"

## clarify · 2026-10-25 21:34
**Pergunta:** Qual provedor de identidade usar?
**Opções:** Google OAuth (recomendada) · Auth0 · Firebase Auth
**Escolha:** Google OAuth
**Por quê:** É a opção recomendada e a única exigida pela história; evita dependência extra.
_claude-code / claude-opus-5-5_
```

- O arquivo é criado no primeiro registro da história e regravado inteiro a partir do estado em memória antes de cada commit.
- `followedRecommendation: false` acrescenta a linha `**Atenção:** a opção recomendada era <label>`.

## 4. `.maestro/autopilot/<id>.jsonl`

Cada linha é um JSON, sem conteúdo truncado:

```text
{"at":"…","event":"decision","story":1,"feature":"012-login-google","step":"clarify","kind":"options","question":"…","options":[…],"choice":"Google OAuth","rationale":"…","followedRecommendation":true,"provider":"claude-code","model":"claude-opus-5-5"}
{"at":"…","event":"gate","story":1,"step":"analyze","ok":false,"verdict":"fix","reason":"2 CRITICAL"}
{"at":"…","event":"commit","story":1,"step":"plan","sha":"3f2a…"}
```

O `debug.log` recebe só `autopilot.decision { story, step, kind, followedRecommendation }`, sem pergunta nem resposta (FR-027).
