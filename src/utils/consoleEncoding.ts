/**
 * @license
 * Portions adapted from qwen-code (https://github.com/QwenLM/qwen-code),
 * packages/core/src/utils/systemEncoding.ts @ a4dd42c4d67927dfd600d8e87d0c8f670c478ed9.
 * Copyright 2025 Qwen Team. Copyright 2025 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Maestro; see THIRD_PARTY_NOTICES.md.
 */

import { isUtf8 } from 'node:buffer';
import { execFileSync } from 'node:child_process';

/**
 * Upper halves (0x80–0xFF) of the DOS code pages Windows consoles use by default, which
 * TextDecoder does not know (850: Western Europe and Brazil, 437: US).
 */
const OEM_TABLES: Record<number, string> = {
  437: 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0',
  850: 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0',
};

/** WHATWG labels of the other common Windows code pages. */
const DECODER_LABELS: Record<number, string> = {
  866: 'ibm866',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
};

/** Decodes `buf` in Windows code page `cp`; undefined when the code page is unknown. */
export function decodeCodePage(buf: Buffer, cp: number): string | undefined {
  if (cp === 65001) return buf.toString('utf8');
  const table = OEM_TABLES[cp];
  if (table) {
    let out = '';
    for (const byte of buf) out += byte < 0x80 ? String.fromCharCode(byte) : table[byte - 0x80];
    return out;
  }
  const label = DECODER_LABELS[cp];
  if (!label) return undefined;
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return undefined;
  }
}

let cachedCodePage: number | null | undefined;

/** Active code page of a console spawned by Maestro (`chcp`), read once; null when unknown. */
export function consoleCodePage(): number | null {
  if (cachedCodePage !== undefined) return cachedCodePage;
  try {
    const out = execFileSync(process.env['ComSpec'] || 'cmd.exe', ['/d', '/c', 'chcp'], {
      encoding: 'latin1',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const m = /(\d+)\D*$/.exec(out.trim());
    cachedCodePage = m ? Number(m[1]) : null;
  } catch {
    cachedCodePage = null;
  }
  return cachedCodePage;
}

/**
 * Text of a command's complete output. UTF-8 first (git, node, dotnet with UTF-8 and most
 * modern tools write it, and legacy bytes rarely form valid UTF-8 by accident); otherwise, on
 * Windows, the console code page (cmd's own messages, `dir`, older programs), so accents do not
 * come back as "�".
 */
export function decodeCommandOutput(
  buf: Buffer,
  opts: { platform?: NodeJS.Platform; codePage?: () => number | null } = {},
): string {
  if (isUtf8(buf) || (opts.platform ?? process.platform) !== 'win32') return buf.toString('utf8');
  const cp = (opts.codePage ?? consoleCodePage)();
  return (cp !== null ? decodeCodePage(buf, cp) : undefined) ?? buf.toString('utf8');
}
