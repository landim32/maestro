# Como funciona o loop

O loop de ferramentas faz três coisas:

1. **Envia** o histórico ao provedor
2. Recebe `tool_call` e **valida** o input com `zod`
3. Executa e reenvia

Exemplo mínimo:

```ts
for (;;) {
  const r = await provider.stream(req);
  if (r.stop !== "tool_use") break;
}
```

| Evento | Efeito |
|---|---|
| `text_delta` | acumula texto |
| `tool_call` | enfileira |

> Nota: no modo `-p` nada disso é formatado.

---

Pronto!
