Exemplo em TypeScript:

```ts
import { readFile } from "node:fs/promises";

// lê um arquivo
export async function load(path: string): Promise<number> {
  const text = await readFile(path, "utf8");
  return text.length * 2;
}
```

Fim.
