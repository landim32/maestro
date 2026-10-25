# Data Model: Colar Arquivos, Copiar Seleção e Colagens Grandes

**Feature**: `007-paste-copy-console` | **Date**: 2026-10-25

---

## 1. Chips (`src/ui/chips.ts`)

```ts
export const CHIP_BASE = 0xe000; // área de uso privado; chip i ↔ String.fromCodePoint(CHIP_BASE + i)

export type Chip =
  | { kind: 'paste'; id: number; seq: number; text: string; lines: number }
  | { kind: 'file'; id: number; seq: number; path: string; rel: string; name: string; bytes: number; lines: number }
  | { kind: 'image'; id: number; seq: number; path: string; rel: string; name: string; bytes: number; mediaType: string };

export class ChipRegistry {
  add(chip: Omit<Chip, 'id'>): Chip;           // id = próximo índice; seq por kind (#1, #2…)
  get(id: number): Chip | undefined;
  byLabel(label: string): Chip | undefined;     // para relink do histórico
  all(): Chip[];
}

export function chipChar(id: number): string;            // code point PUA
export function chipIdOf(ch: string): number | undefined; // inverso; undefined para texto comum
export function chipLabel(chip: Chip): string;
// paste → `[Pasted text #${seq} +${lines} lines]`
// file  → `[Arquivo: ${name}, ${lines} linhas]`
// image → `[Imagem: ${name}, ${formatBytes(bytes)}]`

export function labelChips(text: string, reg: ChipRegistry): string;   // PUA → rótulo (display/histórico)
export function relinkChips(text: string, reg: ChipRegistry): string;  // rótulo conhecido → PUA
export function expandChips(text: string, reg: ChipRegistry, read: (chip: Chip) => string): string; // PUA → bloco delimitado
export function chipsIn(text: string, reg: ChipRegistry): Chip[];
```

**Invariantes**: ids são únicos na sessão e nunca reutilizados; `seq` conta por tipo; `labelChips(relinkChips(x)) === x` para rótulos conhecidos; o texto do editor nunca contém PUA sem chip registrado (chars PUA vindos de colagem são substituídos por `�` ao inserir).

Blocos delimitados (research R3):

| kind | bloco |
|---|---|
| paste | `<pasted-text id="N" lines="L">\n…\n</pasted-text>` |
| file | `<file path="rel" lines="L">\n…\n</file>` |
| image | marcador textual `[Imagem: name]` + parte `image` na mensagem |

---

## 2. Anexos (`src/ui/attachments.ts`)

```ts
export interface AttachLimits { attachMaxBytes: number; attachMaxTotalBytes: number; imageMaxBytes: number }
export type PathClass =
  | { kind: 'text'; abs: string; rel: string; bytes: number; lines: number }
  | { kind: 'image'; abs: string; rel: string; bytes: number; mediaType: string }
  | { kind: 'rejected'; abs: string; reason: 'binary' | 'too-large' | 'outside' | 'image-too-large' | 'images-unsupported' };

export function splitPastedPaths(text: string): string[];            // tokens por \n, espaço fora de aspas, aspas, file://
export function resolvePastedPath(token: string, cwd: string, env): string | undefined; // ~, file://, relativo → abs existente (arquivo)
export function classifyPath(abs: string, cwd: string, limits: AttachLimits, imagesOk: boolean): PathClass;
export const IMAGE_TYPES: Record<string, string>; // .png → image/png, .jpg/.jpeg, .gif, .webp
export function rejectionMessage(c: Extract<PathClass, { kind: 'rejected' }>, limits): string;
```

Regra de colagem (R4): tokens que resolvem para arquivos existentes viram chips (`text`/`image`) ou avisos (`rejected`, o token fica como texto); tokens que não resolvem ficam como texto. Uma colagem que não contém nenhum caminho segue a regra de colapso (§ 1).

---

## 3. Prompt (`src/ui/components/InputPrompt.tsx`)

Estado adicional: `registry: ChipRegistry` (da sessão, via prop), `expandedChip?: number` (painel Ctrl+O).

```ts
export interface PromptSubmission {
  /** Texto com rótulos (transcrição, histórico). */
  display: string;
  /** Texto expandido para o modelo (blocos delimitados). */
  text: string;
  /** Partes extras (imagens). */
  parts: Array<{ type: 'image'; mediaType: string; data: string; name: string }>;
  /** Avisos de anexos recusados/alterados no envio. */
  warnings: string[];
}
onSubmit: (submission: PromptSubmission) => void;
```

Eventos:

| Evento | Efeito |
|---|---|
| `usePaste(text)` | caminhos → chips/avisos; senão, `lines > pasteCollapseLines` → chip `paste`; senão insere literal (`\r\n` → `\n`) |
| Backspace/Delete sobre PUA | remove o code point (já é assim) |
| Ctrl+O | alterna `expandedChip` para o chip sob/antes do cursor |
| digitar / mover | fecha o painel |
| Enter | `expandChips` + leitura dos arquivos (recontagem de linhas; total > `attachMaxTotalBytes` → aviso e **não envia**) → `onSubmit(submission)` |
| ↑/↓ histórico | `relinkChips(entry, registry)` ao carregar a entrada |

Renderização: `layoutInput` recebe `widthOf(ch)` que devolve `visualWidth(chipLabel)` para PUA; a linha mostra o rótulo com cor distinta (`cyan`, `inverse` quando o cursor está sobre ele).

---

## 4. Mensagem e provedores

```ts
// providers/types.ts
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }   // NOVO (base64)
  | { type: 'tool_call'; … } | { type: 'tool_result'; … };

export interface ModelProvider { …; capabilities?: { images?: boolean } }   // claude: { images: true }

// session/session.ts
pushUser(text: string, display?: string, extra?: ContentPart[]): boolean;

// session/controller.ts
submit(input: string | PromptSubmission, opts): Promise<TurnResult | undefined>
// string → comportamento atual; PromptSubmission → pushUser(text, display, parts); history.push(display)
```

Conversão (R9): Claude → bloco `image` base64 antes do texto; Qwen → partes `image` ignoradas com `onNotice('imagens não suportadas pelo provedor', 'warn')` (só acontece se o chip foi criado quando outro provedor estava ativo).

---

## 5. Seleção (`src/ui/selection.ts`, reducer puro)

```ts
export interface Point { line: number; col: number }               // coordenadas de conteúdo
export type SelectionState =
  | { phase: 'idle' }
  | { phase: 'dragging'; anchor: Point; head: Point; mode: 'char' | 'word' | 'line' }
  | { phase: 'done'; anchor: Point; head: Point; mode: 'char' | 'word' | 'line'; text: string; lines: number };

export type SelectionEvent =
  | { type: 'press'; at: Point; time: number }
  | { type: 'drag'; at: Point }
  | { type: 'release'; at: Point }
  | { type: 'clear' };

export function selectionReducer(state, event, ctx: { lineText: (line: number) => string | undefined; lastClick?: { at: Point; time: number; count: number } }): SelectionState;
export function selectedRange(sel): { start: Point; end: Point };   // normalizado (start ≤ end)
export function extractText(range, lineText): { text: string; lines: number };  // linhas inteiras no meio; recorte por coluna nas pontas; palavra/linha nos modos
export function isSelected(sel, line: number, col: number): boolean;  // para o overlay
```

Duplo clique (mesma célula, ≤ 400 ms): `mode = 'word'`; triplo: `mode = 'line'`.

---

## 6. Mouse e frame (`src/ui/hooks/useMouseSelection.ts`, `src/ui/frameRecorder.ts`)

```ts
export interface MouseGeometry { transcriptTop: number; transcriptLeft: number; viewportOffset: number; viewportHeight: number; width: number }
export function screenToContent(ev: SgrMouseEvent, g: MouseGeometry): Point | undefined;   // fora da transcrição → undefined

export class FrameRecorder {               // passado ao Ink como stdout
  constructor(real: NodeJS.WriteStream);
  columns/rows/isTTY (getters do real); on/off/once('resize') → real;
  write(chunk): boolean;                   // repassa; guarda o último frame (chunk com '\n')
  lines(): string[];                       // último frame sem ANSI
}
export class ContentLineCache { update(frameLines, g: MouseGeometry): void; get(line: number): string | undefined }
```

`useMouseSelection({ enabled, stdin, geometry, cache, onCopy })`: parse SGR → eventos do reducer → ao `release` com seleção não vazia: `extractText` → `copyToClipboard` → `onCopy(result)`.

---

## 7. Clipboard (`src/utils/clipboard.ts`)

```ts
export interface CopyResult { ok: boolean; method?: 'clip' | 'powershell' | 'pbcopy' | 'wl-copy' | 'xclip' | 'xsel' | 'osc52'; error?: string }
export function copyToClipboard(text: string, opts: { platform?: NodeJS.Platform; stdout?: { write(s: string): unknown }; exec?: ExecFn; env? }): Promise<CopyResult>;
```

---

## 8. Controller, configuração e barra de status

```ts
// controller
mouseEnabled: boolean;               // inicial ui.mouse
setMouse(on: boolean): void;         // transient `mouse on|off`
chips: ChipRegistry;                 // por sessão
// commands.ts
/mouse [on|off]                      // alterna; em -p só informa
// config/schema.ts (uiSettingsSchema)
pasteCollapseLines: z.number().int().min(1).default(3)
attachMaxBytes: z.number().int().min(1024).default(512 * 1024)
attachMaxTotalBytes: z.number().int().min(1024).default(2 * 1024 * 1024)
imageMaxBytes: z.number().int().min(1024).default(5 * 1024 * 1024)
// StatusBar
mouse off → `mouse desligado` no lado esquerdo; cópia → transient `copiado (N linhas)`
```
