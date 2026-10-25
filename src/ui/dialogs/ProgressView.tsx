import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

const FRAMES_COLOR = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAMES_PLAIN = ['-', '\\', '|', '/'];

export interface ProgressViewProps {
  message: string;
  url?: string;
  color: boolean;
  hint?: string;
}

/** Textual spinner + message (+ optional URL) — contracts/dialog-flows.md § 4 and § 6. */
export function ProgressView({ message, url, color, hint = 'Esc cancelar' }: ProgressViewProps) {
  const frames = color ? FRAMES_COLOR : FRAMES_PLAIN;
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % frames.length), 100);
    return () => clearInterval(t);
  }, [frames.length]);
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color ? 'cyan' : undefined}>{frames[i]}</Text> {message}
      </Text>
      {url && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Se o navegador não abriu, acesse:</Text>
          <Text color={color ? 'blue' : undefined} underline>
            {url}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>{hint}</Text>
      </Box>
    </Box>
  );
}
