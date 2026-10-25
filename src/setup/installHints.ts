export const ANT_RELEASES_URL = 'https://github.com/anthropics/anthropic-cli/releases';

/** Platform-specific instructions shown when the `ant` CLI is missing (research R3). */
export function installHints(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') {
    return [
      `1. Baixe ant_<versão>_windows_amd64.zip em ${ANT_RELEASES_URL}`,
      '2. Extraia ant.exe para uma pasta no PATH, por exemplo %LOCALAPPDATA%\\Programs\\ant',
      '3. Abra um terminal novo (ou use "Tentar novamente": essa pasta também é verificada)',
    ];
  }
  if (platform === 'darwin') {
    return [
      '1. brew install anthropics/tap/ant',
      '2. xattr -d com.apple.quarantine "$(brew --prefix)/bin/ant"',
      '3. Use "Tentar novamente"',
    ];
  }
  return [
    `1. Baixe ant_<versão>_linux_<arch>.tar.gz em ${ANT_RELEASES_URL}`,
    '2. Extraia o binário ant para /usr/local/bin (ou outra pasta no PATH)',
    '3. Use "Tentar novamente"',
  ];
}
