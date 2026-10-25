import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR_NAME = '.maestro';
export const SETTINGS_FILE_NAME = 'settings.json';

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['MAESTRO_HOME'] && env['MAESTRO_HOME'] !== '' ? env['MAESTRO_HOME'] : os.homedir();
}

/** `~/.maestro` (or `%USERPROFILE%\.maestro` on Windows). */
export function globalConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(homeDir(env), CONFIG_DIR_NAME);
}

export function globalSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(globalConfigDir(env), SETTINGS_FILE_NAME);
}

export const HISTORY_FILE_NAME = 'history.jsonl';

/** `~/.maestro/history.jsonl` — interactive input history (contracts/history.md). */
export function historyPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(globalConfigDir(env), HISTORY_FILE_NAME);
}

/** `<cwd>/.maestro/settings.json` */
export function projectSettingsPath(cwd: string): string {
  return path.join(cwd, CONFIG_DIR_NAME, SETTINGS_FILE_NAME);
}

export function debugLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(globalConfigDir(env), 'debug.log');
}

/**
 * Candidate directories where `ant auth login` stores OAuth credentials.
 * Linux/macOS: `~/.config/anthropic/credentials`; Windows: `%APPDATA%\Anthropic\credentials`.
 * `ANTHROPIC_CONFIG_DIR` overrides the base directory.
 */
export function anthropicCredentialDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const dirs: string[] = [];
  const override = env['ANTHROPIC_CONFIG_DIR'];
  if (override && override !== '') dirs.push(path.join(override, 'credentials'));
  if (platform === 'win32') {
    const appData = env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
    dirs.push(path.join(appData, 'Anthropic', 'credentials'));
  } else {
    const xdg = env['XDG_CONFIG_HOME'];
    const base = xdg && xdg !== '' ? xdg : path.join(os.homedir(), '.config');
    dirs.push(path.join(base, 'anthropic', 'credentials'));
  }
  return dirs;
}
