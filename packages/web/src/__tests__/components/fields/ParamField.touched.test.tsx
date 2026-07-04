import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { ParamField } from '../../../components/ui/fields/ParamField';
import { validateParamValue } from '@hola/shared/param-validate';
import type { AppEnvVar } from '@hola/shared';

afterEach(() => {
  cleanup();
});

// Mirrors InstallWizard's touched-tracking: a field's issues are computed
// unconditionally, but only surfaced once the operator has edited it (so an
// untouched, still-empty seeded row doesn't greet the operator with an error
// before they've looked at it). Once touched, it stays touched — clearing a
// field the operator has already edited must still show the error.
function TouchTrackingHarness({ spec }: { spec: AppEnvVar }) {
  const [value, setValue] = React.useState(spec.value);
  const [touched, setTouched] = React.useState(false);
  const issues = touched ? validateParamValue(spec, value) : [];
  return (
    <ParamField
      spec={spec}
      value={value}
      onChange={(v) => {
        setTouched(true);
        setValue(v);
      }}
      issues={issues}
    />
  );
}

describe('ParamField required-empty error visibility (touched semantics)', () => {
  const requiredUrlSpec: AppEnvVar = {
    key: 'SITE_URL',
    value: '',
    isSecret: false,
    type: 'url',
    required: true,
    label: 'Site URL',
  };

  it('does not show a required error before the operator has touched the field', () => {
    render(<TouchTrackingHarness spec={requiredUrlSpec} />);
    expect(screen.queryByText('Site URL is required')).not.toBeInTheDocument();
  });

  it('shows the required error once the field is touched and cleared back to empty', () => {
    render(<TouchTrackingHarness spec={requiredUrlSpec} />);
    const input = screen.getByDisplayValue('') as HTMLInputElement;

    // Touch it with some value, then clear it back out.
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.change(input, { target: { value: '' } });

    expect(screen.getByText('Site URL is required')).toBeInTheDocument();
  });
});
