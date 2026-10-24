import { Box, Text } from 'ink';
import { APP_NAME, VERSION } from '../../version.js';
import { truncateToWidth, visualWidth } from '../../utils/width.js';

export interface HeaderProps {
  providerId: string;
  model: string;
  cwd: string;
  columns: number;
  color: boolean;
}

/**
 * Single fixed line: `maestro v0.1.0 · claude / model · cwd`.
 * Segments are dropped from the right (cwd first, then model, then version) until the line fits.
 */
export function Header({ providerId, model, cwd, columns, color }: HeaderProps) {
  const room = Math.max(4, columns - 2);
  const sep = ' · ';
  const name = APP_NAME;
  const version = ` v${VERSION}`;
  const prov = `${providerId} / ${model}`;

  let showVersion = true;
  let showModel = true;
  let path = cwd;
  const widthOf = () =>
    visualWidth(name) +
    (showVersion ? visualWidth(version) : 0) +
    visualWidth(sep) +
    visualWidth(showModel ? prov : providerId) +
    (path ? visualWidth(sep) + visualWidth(path) : 0);

  if (widthOf() > room) {
    const fixed = widthOf() - (path ? visualWidth(sep) + visualWidth(path) : 0);
    path = truncateToWidth(cwd, room - fixed - visualWidth(sep));
    if (visualWidth(path) < 4) path = '';
  }
  if (widthOf() > room) showModel = false;
  if (widthOf() > room) showVersion = false;

  return (
    <Box height={1} flexShrink={0} paddingX={1} overflow="hidden">
      <Text bold color={color ? 'cyan' : undefined}>
        {truncateToWidth(name, room)}
      </Text>
      {showVersion && <Text dimColor>{version}</Text>}
      <Text dimColor>{sep}</Text>
      <Text color={color ? 'magenta' : undefined}>{providerId}</Text>
      {showModel && <Text dimColor> / {model}</Text>}
      {path && <Text dimColor>{sep + path}</Text>}
    </Box>
  );
}
