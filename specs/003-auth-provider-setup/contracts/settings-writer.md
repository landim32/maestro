# Contract: Gravação de `settings.json`

**Feature**: `003-auth-provider-setup` | **Módulo**: `src/config/writer.ts`

## 1. API

```ts
export interface SettingsPatchEntry { path: string; value: unknown }     // "providers.qwen.apiKey"
export interface WriteSettingsOptions { globalPath: string; cwd?: string } // cwd → detecta ./.maestro/settings.json
export interface WriteResult { path: string; overriddenByProject: string[] }

export function readRawSettings(path: string): Record<string, unknown>;   // {} se não existir
export function applyPatch(raw: Record<string, unknown>, patch: SettingsPatchEntry[]): Record<string, unknown>;
export function writeSettings(patch: SettingsPatchEntry[], opts: WriteSettingsOptions): WriteResult; // lança MaestroError
export function projectOverrides(paths: string[], cwd: string): string[];  // caminhos presentes no arquivo de projeto
```

## 2. Regras

1. **Ler bruto**: o arquivo atual é lido como JSON; `_comment` e qualquer chave existente são preservados. Arquivo ausente → começa de `INITIAL_SETTINGS`.
2. **Patch por caminho**: `a.b.c` cria objetos intermediários; `value === undefined` remove a chave. Chaves de provedor gravadas: `enabled`, `apiKey`, `baseUrl`, `model`; raiz: `activeProvider`.
3. **Normalizar**: `apiKey` sem espaços/quebras; `baseUrl` sem barra final; strings vazias em `apiKey`/`baseUrl` são removidas (não gravadas como `""`, exceto o `apiKey: ""` de template já existente, que pode permanecer).
4. **Validar antes de gravar**: `settingsSchema.safeParse(result)`; falha → `MaestroError { category: 'invalid_config', message: 'campo: motivo' }` e **nada é escrito**.
5. **Escrita atômica**: `JSON.stringify(result, null, 2) + '\n'` em `<path>.tmp` e `fs.renameSync` sobre `<path>`; diretório criado se necessário.
6. **Erros de I/O** (`EACCES`, `ENOSPC`, `EROFS`) → `MaestroError { category: 'invalid_config', message: 'não foi possível gravar <path>: <code>', hint: 'a configuração vale só nesta sessão' }`.
7. **Sobrescrita por projeto**: se `cwd/.maestro/settings.json` existir e contiver algum dos caminhos do patch, eles são devolvidos em `overriddenByProject` (o arquivo de projeto **não** é alterado).
8. **Segredos**: o writer nunca registra valores em log; o logger de `--debug` recebe apenas os caminhos gravados.

## 3. Pós‑gravação (controller)

`SessionController.applySettings()` recarrega via `loadSettings({ configPath, cwd, env })`, substitui `ctx.settings` e `ctx.credentialSources`, invalida a instância de provedor em cache e emite `change`. Assim `/model`, `Header` e `ProviderStatus` refletem a mudança sem reiniciar.

## 4. Testes de contrato

- Preserva `_comment` em todos os níveis e chaves não tocadas.
- Patch cria `providers.qwen` quando ausente; remove chave com `undefined`.
- Resultado inválido (ex.: `baseUrl` sem esquema) → erro e arquivo intacto (hash igual antes/depois).
- Escrita atômica: após falha simulada no `rename`, o arquivo original permanece válido.
- `overriddenByProject` lista `providers.qwen.apiKey` quando o arquivo de projeto define a chave.
- Arquivo gravado é relido por `loadSettings` sem erros e com os novos valores.
