# Quickstart: Exibição da IA

Cenários manuais executados na sessão interativa (`npm run dev` ou `maestro`), com qualquer provedor configurado. Um dos cenários usa o `claude-code`.

1. **Linha de atividade.** Envie "explique src/index.ts em 5 parágrafos". Confira:
   - a linha `✻ <frase>… (0s · Esc para interromper)` aparece antes do primeiro token;
   - o tempo avança;
   - `↓ ~N tokens` cresce durante o streaming e perde o `~` quando o provedor informa o valor real;
   - no fim, a linha some e aparece `✻ Ns · ↓ N tokens` na transcrição.
2. **Fase de ferramenta.** Peça "rode `npm --version`". A frase muda para `Executando Cmd…` (Windows) ou `Executando Bash…` enquanto o comando roda. Com o modo `default`, ela muda para `Aguardando sua confirmação…` durante o diálogo.
3. **Transcrição.** Peça para ler um arquivo, listar `src/ui` e rodar um comando com saída longa. Confira:
   - `⏺ Read(…)` com `⎿ Leu N linhas`;
   - `⏺ List(src/ui)` com `⎿ N itens`;
   - o comando com 5 linhas e `… +N linhas`;
   - nenhuma linha `⚙` duplicada.
4. **Erro.** Peça para ler `nao-existe.txt`. Confira `⎿ file not found: nao-existe.txt` em vermelho.
5. **Diff na confirmação.** Peça uma alteração de uma linha num arquivo de mais de 50 linhas. O diálogo mostra o caminho, `+1 −1`, números de linha, 3 linhas de contexto e cores.
6. **Diff na transcrição.** Aprove o diff do cenário 5. A transcrição guarda `⏺ Write(…)` com `⎿ +1 −1 linhas` e o mesmo diff. Repita com Shift+Tab em "Aceitar edições": o diff aparece sem diálogo, com `· auto (Aceitar edições)`.
7. **Recusa.** Recuse uma escrita. Confira `⎿ recusado pelo usuário` sem diff.
8. **Arquivo novo e sem mudança.** Peça para criar um arquivo novo e depois para escrever o mesmo conteúdo de novo. Confira `arquivo novo · N linhas` e depois `sem alterações`.
9. **Cancelamento.** Durante uma resposta longa, aperte Esc. Confira `✻ interrompido · Ns · ↓ N tokens`.
10. **`-p`.** Compare as saídas de antes e depois:

    ```bash
    maestro -p "diga oi" > out.txt
    ```

    O stdout tem que ser igual. Os avisos `⚙` continuam aparecendo no stderr.
11. **Terminal estreito.** Reduza a janela para 50 colunas durante um turno. A dica sai primeiro e os tokens depois.
12. **Claude Code.** Repita o cenário 3 com `/model claude-code`. Os tokens aparecem como estimativa até o fim do turno, e a transcrição fica no mesmo formato.
