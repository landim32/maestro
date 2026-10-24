import yargs from 'yargs';
import { PROVIDER_IDS } from '../config/schema.js';
import type { ProviderId } from '../config/schema.js';
import { APP_NAME, VERSION } from '../version.js';

export interface ParsedArgs {
  action: 'run' | 'help' | 'version';
  prompt?: string;
  provider?: ProviderId;
  model?: string;
  config?: string;
  tools: boolean;
  color: boolean;
  altScreen: boolean;
  debug: boolean;
  helpText?: string;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function build(argv: string[]) {
  return yargs(argv)
    .scriptName(APP_NAME)
    .usage('$0 [options]\n$0 -p "<prompt>" [options]')
    .option('prompt', {
      alias: 'p',
      type: 'string',
      describe: 'Run a single turn and exit. Use "-" to read the prompt from stdin.',
    })
    .option('provider', {
      type: 'string',
      choices: PROVIDER_IDS,
      describe: 'Provider to use for this run (overrides settings.activeProvider).',
    })
    .option('model', { type: 'string', describe: 'Model name for this run.' })
    .option('config', { type: 'string', describe: 'Path to the global settings.json.' })
    .option('tools', {
      type: 'boolean',
      default: true,
      describe: 'Enable workspace tools (--no-tools to disable).',
    })
    .option('color', {
      type: 'boolean',
      default: true,
      describe: 'Colored output (--no-color to disable).',
    })
    .option('altscreen', {
      type: 'boolean',
      default: true,
      describe: 'Draw on the alternate screen (--no-altscreen to stay in the main buffer).',
    })
    .option('debug', {
      type: 'boolean',
      default: false,
      describe: 'Verbose errors and ~/.maestro/debug.log.',
    })
    .version(false)
    .help(false)
    .strict()
    .exitProcess(false)
    .fail((msg, err) => {
      throw new UsageError(msg || err?.message || 'invalid arguments');
    });
}

/** Parses CLI arguments (contracts/cli.md § 1). Throws UsageError on invalid input. */
export async function parseArgs(argv: string[]): Promise<ParsedArgs> {
  if (argv.includes('-v') || argv.includes('--version')) {
    return { action: 'version', tools: true, color: true, altScreen: true, debug: false };
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    const helpText = await build(argv.filter((a) => a !== '-h' && a !== '--help')).getHelp();
    return { action: 'help', tools: true, color: true, altScreen: true, debug: false, helpText };
  }
  const parsed = await build(argv).parseAsync();
  const positional = parsed._.filter((p) => p !== '');
  if (positional.length > 0) {
    throw new UsageError(
      `Unexpected argument: ${positional.join(' ')}. Use -p "<prompt>" to pass a prompt.`,
    );
  }
  if (parsed.prompt !== undefined && parsed.prompt !== '-' && parsed.prompt.trim() === '') {
    throw new UsageError('--prompt must not be empty.');
  }
  return {
    action: 'run',
    prompt: parsed.prompt,
    provider: parsed.provider as ProviderId | undefined,
    model: parsed.model,
    config: parsed.config,
    tools: parsed.tools,
    color: parsed.color,
    altScreen: parsed.altscreen,
    debug: parsed.debug,
  };
}

export function versionText(): string {
  return `${APP_NAME} ${VERSION}`;
}
