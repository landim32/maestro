import { Box, Text } from 'ink';

export interface DialogFrameProps {
  title: string;
  /** Key hints shown in the footer, e.g. "↑↓ navegar · Enter selecionar · Esc fechar". */
  hints: string;
  color: boolean;
  children: React.ReactNode;
}

/** Modal frame that occupies the transcript area (contracts/dialog-flows.md § 1). */
export function DialogFrame({ title, hints, color, children }: DialogFrameProps) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      borderStyle={color ? 'round' : 'single'}
      borderColor={color ? 'cyan' : undefined}
      paddingX={1}
      overflow="hidden"
    >
      <Box flexShrink={0}>
        <Text bold color={color ? 'cyan' : undefined}>
          {title}
        </Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        marginTop={1}
        overflow="hidden"
      >
        {children}
      </Box>
      <Box flexShrink={0} marginTop={1}>
        <Text dimColor>{hints}</Text>
      </Box>
    </Box>
  );
}
