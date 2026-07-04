import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ParamField } from '../../../components/ui/fields/ParamField';
import type { AppEnvVar, ValidationIssue } from '@hola/shared';

afterEach(() => {
  cleanup();
});

function spec(overrides: Partial<AppEnvVar> = {}): AppEnvVar {
  return { key: 'FOO', value: '', isSecret: false, ...overrides };
}

describe('ParamField dispatch', () => {
  it('isSecret always renders SecretInput (masked input), regardless of declared type', () => {
    render(<ParamField spec={spec({ isSecret: true, type: 'integer' })} value="abc123" onChange={() => {}} />);
    const input = screen.getByDisplayValue('abc123') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('boolean renders BooleanToggle (a switch)', () => {
    render(<ParamField spec={spec({ type: 'boolean', value: 'true' })} value="true" onChange={() => {}} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('enum with <= 4 options renders RadioGroup', () => {
    const options = [{ value: 'a' }, { value: 'b' }];
    render(<ParamField spec={spec({ type: 'enum', options })} value="a" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('enum with > 4 options renders SelectInput', () => {
    const options = Array.from({ length: 5 }, (_, i) => ({ value: `opt${i}` }));
    render(<ParamField spec={spec({ type: 'enum', options })} value="opt0" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('integer/port render a number input', () => {
    const { unmount } = render(<ParamField spec={spec({ type: 'integer', min: 1, max: 10 })} value="5" onChange={() => {}} />);
    let input = screen.getByDisplayValue('5') as HTMLInputElement;
    expect(input.type).toBe('number');
    unmount();

    render(<ParamField spec={spec({ type: 'port' })} value="8080" onChange={() => {}} />);
    input = screen.getByDisplayValue('8080') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.min).toBe('1');
    expect(input.max).toBe('65535');
  });

  it('url/email/string render a matching-typed text input with the placeholder', () => {
    const { unmount } = render(<ParamField spec={spec({ type: 'url', placeholder: 'https://example.com' })} value="" onChange={() => {}} />);
    let input = screen.getByPlaceholderText('https://example.com') as HTMLInputElement;
    expect(input.type).toBe('url');
    unmount();

    render(<ParamField spec={spec({ type: 'email' })} value="a@b.com" onChange={() => {}} />);
    input = screen.getByDisplayValue('a@b.com') as HTMLInputElement;
    expect(input.type).toBe('email');
  });

  it('timezone renders a text input (datalist-backed or plain fallback)', () => {
    render(<ParamField spec={spec({ type: 'timezone' })} value="America/New_York" onChange={() => {}} />);
    expect(screen.getByDisplayValue('America/New_York')).toBeInTheDocument();
  });

  it('shows the required marker per the same tri-state formula as the shared validator', () => {
    const { unmount } = render(<ParamField spec={spec({ required: true, label: 'Foo' })} value="" onChange={() => {}} />);
    expect(screen.getByText('*')).toBeInTheDocument();
    unmount();

    // required undefined + isSecret true => required (legacy rule)
    render(<ParamField spec={spec({ isSecret: true, label: 'Secret' })} value="" onChange={() => {}} />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('does not show the required marker when required: false even for a secret (optional-secret fix)', () => {
    render(<ParamField spec={spec({ isSecret: true, required: false, label: 'Secret' })} value="" onChange={() => {}} />);
    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });

  it('surfaces the first error-severity issue message and hides the description', () => {
    const issues: ValidationIssue[] = [
      { code: 'PARAM_REQUIRED_MISSING', severity: 'error', message: 'Foo is required', path: 'env.FOO' },
    ];
    render(
      <ParamField
        spec={spec({ description: 'Some help text' })}
        value=""
        onChange={() => {}}
        issues={issues}
      />
    );
    expect(screen.getByText('Foo is required')).toBeInTheDocument();
    expect(screen.queryByText('Some help text')).not.toBeInTheDocument();
  });

  it('wires the wand callback for a secret field without prescribing how the value is generated', () => {
    const onGenerateSecret = vi.fn();
    render(
      <ParamField
        spec={spec({ isSecret: true })}
        value=""
        onChange={() => {}}
        onGenerateSecret={onGenerateSecret}
      />
    );
    screen.getByTitle('Generate a random secret').click();
    expect(onGenerateSecret).toHaveBeenCalledTimes(1);
  });
});
