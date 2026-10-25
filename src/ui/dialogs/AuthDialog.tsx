import { Box, Text } from 'ink';
import type { AuthFlowState } from '../../setup/authFlow.js';
import { fieldDefault, methodStatusLabel } from '../../setup/methods.js';
import { DialogFrame } from './DialogFrame.js';
import { ProgressView } from './ProgressView.js';
import { ResultView } from './ResultView.js';
import { SelectList } from './SelectList.js';
import { TextField } from './TextField.js';

export interface AuthDialogProps {
  flow: AuthFlowState;
  color: boolean;
  onInput: (value: string) => void;
}

const NAV = '↑↓ navegar · Enter selecionar · Esc fechar';
const FIELD = 'Enter avançar · Esc voltar · Ctrl+U limpar';
const CHOOSE = '↑↓ escolher · Enter confirmar · Esc voltar';

/** Claude Code reuses the login steps but only checks its status (specs/010). */
const cc = (flow: { method: { id: string } }) => flow.method.id === 'claude-code';

/** Maps AuthFlowState → screens (contracts/dialog-flows.md). */
export function AuthDialog({ flow, color, onInput }: AuthDialogProps) {
  switch (flow.step) {
    case 'menu':
      return (
        <DialogFrame title="Conectar provedor" hints={NAV} color={color}>
          <SelectList
            color={color}
            selected={flow.selected}
            labelWidth={18}
            items={flow.items.map((it) => ({
              label: it.method.label,
              description: it.method.description,
              status: methodStatusLabel(it.status, it.provider, it.method),
            }))}
          />
        </DialogFrame>
      );

    case 'fields': {
      const field = flow.method.fields[flow.index]!;
      const title = `${flow.method.label} · passo ${flow.index + 1}/${flow.method.fields.length}`;
      if (field.kind === 'choice' && field.options) {
        const current = flow.values[field.key] ?? '';
        const selected = Math.max(
          0,
          field.options.findIndex((o) => o.value === current),
        );
        return (
          <DialogFrame title={title} hints={CHOOSE} color={color}>
            <Box flexDirection="column">
              <Text bold>{field.label}</Text>
              <SelectList
                color={color}
                selected={selected}
                items={field.options.map((o) => ({ label: o.label, description: o.description }))}
              />
              {field.hint && <Text dimColor>{field.hint}</Text>}
              {flow.error && <Text color={color ? 'red' : undefined}>{flow.error}</Text>}
            </Box>
          </DialogFrame>
        );
      }
      const maskedCurrent =
        field.secret && flow.editing && flow.keepCurrentKey ? '****' : undefined;
      return (
        <DialogFrame title={title} hints={FIELD} color={color}>
          <TextField
            label={field.label}
            value={flow.values[field.key] ?? ''}
            onChange={onInput}
            active
            color={color}
            secret={field.secret}
            maskedCurrent={maskedCurrent}
            placeholder={fieldDefault(field, flow.values) || (field.required ? '' : '(opcional)')}
            hint={field.hint}
            error={flow.error}
          />
        </DialogFrame>
      );
    }

    case 'testing':
      return (
        <DialogFrame title={flow.method.label} hints="Esc cancelar o teste" color={color}>
          <ProgressView message={`Testando conexão com ${flow.method.providerId}…`} color={color} />
        </DialogFrame>
      );

    case 'testFailed': {
      const fieldLabel =
        flow.method.fields.find((f) => f.key === flow.result.field)?.label.split(' (')[0] ??
        'campo';
      return (
        <DialogFrame title={flow.method.label} hints={CHOOSE} color={color}>
          <ResultView
            kind="error"
            title={`Falha: ${flow.result.message}`}
            actions={[`Corrigir ${fieldLabel.toLowerCase()}`, 'Gravar sem testar', 'Voltar']}
            selected={flow.selected}
            color={color}
          />
        </DialogFrame>
      );
    }

    case 'saving':
      return (
        <DialogFrame title={flow.method.label} hints="" color={color}>
          <ProgressView message="Gravando configuração…" color={color} hint="" />
        </DialogFrame>
      );

    case 'saveFailed':
      return (
        <DialogFrame title={flow.method.label} hints="Enter voltar" color={color}>
          <ResultView
            kind="error"
            title="Não foi possível gravar a configuração"
            lines={[flow.error, 'A configuração vale só nesta sessão.']}
            actions={['Voltar']}
            selected={0}
            color={color}
          />
        </DialogFrame>
      );

    case 'activate':
      return (
        <DialogFrame title={flow.method.label} hints={CHOOSE} color={color}>
          <ResultView
            kind="question"
            title={`Usar ${flow.method.providerId} como provedor ativo?`}
            warnings={flow.warnings}
            actions={['Sim', 'Não']}
            selected={flow.selected}
            color={color}
          />
        </DialogFrame>
      );

    case 'activating':
      return (
        <DialogFrame title={flow.method.label} hints="" color={color}>
          <ProgressView message="Ativando…" color={color} hint="" />
        </DialogFrame>
      );

    case 'done':
      return (
        <DialogFrame title={flow.method.label} hints="Enter fechar" color={color}>
          <ResultView
            kind="success"
            title={`${flow.method.providerId} configurado${flow.activated ? ' e ativo' : ''}`}
            warnings={flow.warnings}
            actions={['Fechar']}
            selected={0}
            color={color}
          />
        </DialogFrame>
      );

    case 'login.detect':
      return (
        <DialogFrame title={flow.method.label} hints="" color={color}>
          <ProgressView
            message={cc(flow) ? 'Procurando o Claude Code…' : 'Procurando a CLI ant…'}
            color={color}
            hint=""
          />
        </DialogFrame>
      );

    case 'login.missing':
      return (
        <DialogFrame title={flow.method.label} hints={CHOOSE} color={color}>
          <ResultView
            kind="error"
            title={
              cc(flow)
                ? 'O Claude Code não foi encontrado.'
                : "A CLI 'ant' da Anthropic não foi encontrada."
            }
            lines={flow.hints}
            actions={['Tentar novamente', 'Voltar']}
            selected={flow.selected}
            color={color}
          />
        </DialogFrame>
      );

    case 'login.running':
      return (
        <DialogFrame title={flow.method.label} hints="Esc cancelar" color={color}>
          <ProgressView
            message={
              cc(flow)
                ? 'Verificando o login do Claude Code…'
                : 'Aguardando autorização no navegador…'
            }
            url={flow.url}
            color={color}
          />
        </DialogFrame>
      );

    case 'login.failed':
      return (
        <DialogFrame title={flow.method.label} hints={CHOOSE} color={color}>
          <ResultView
            kind="error"
            title={
              cc(flow)
                ? `Claude Code indisponível: ${flow.reason}`
                : `Login não concluído: ${flow.reason}`
            }
            actions={['Tentar novamente', 'Voltar']}
            selected={flow.selected}
            color={color}
          />
        </DialogFrame>
      );

    case 'closed':
      return (
        <Box>
          <Text> </Text>
        </Box>
      );
  }
}
