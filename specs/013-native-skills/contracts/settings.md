# Contrato: configuração `skills`

```json
{
  "skills": {
    "enabled": true
  }
}
```

| Chave            | Tipo    | Padrão | Efeito |
| ---------------- | ------- | ------ | ------ |
| `skills.enabled` | boolean | `true` | `false`: nenhuma pasta é lida, a seção não entra no prompt, `load_skill` não é oferecida e `/skills` informa que está desligado. |

- A chave pode estar no `~/.maestro/settings.json` e no `./.maestro/settings.json`, com a precedência de sempre.
- Uma chave ausente equivale a `{ "enabled": true }`. O schema é `strictObject`, que aceita `_comment`.
- `tools.enabled: false` (ou `--no-tools`) também desliga as skills, qualquer que seja `skills.enabled`.
- A configuração é documentada no README, na seção de configurações, junto com um parágrafo "Skills".
