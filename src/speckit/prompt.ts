import type { SpecKitCommandFile } from './discovery.js';
import { SPECKIT_PREAMBLE } from './preamble.js';

/** A command that runs a model turn with a composed prompt (data-model § 1). */
export interface PromptTurn {
  /** Shown in the transcript (the typed line). */
  display: string;
  /** Sent to the model. */
  prompt: string;
  /** Forced route for this turn (`/ask <route>`, purpose shortcuts; specs/008). */
  route?: string;
}

/** Substitutes `$ARGUMENTS` / `{ARGS}` in the command body. */
export function renderCommandBody(file: SpecKitCommandFile, args: string): string {
  const value = args.trim();
  return file.body.replace(/\$ARGUMENTS|\{ARGS\}/g, value);
}

export function buildPromptTurn(file: SpecKitCommandFile, args: string): PromptTurn {
  const display = `/${file.name}${args.trim() ? ` ${args.trim()}` : ''}`;
  return { display, prompt: `${SPECKIT_PREAMBLE}${renderCommandBody(file, args)}` };
}
