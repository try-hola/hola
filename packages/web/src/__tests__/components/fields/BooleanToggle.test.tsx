import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { BooleanToggle } from '../../../components/ui/fields/BooleanToggle';

afterEach(() => {
  cleanup();
});

describe('BooleanToggle', () => {
  it('renders a switch in the off position for the falseValue', () => {
    render(<BooleanToggle value="false" onChange={() => {}} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('renders a switch in the on position for the trueValue and toggles on click', () => {
    const onChange = vi.fn();
    render(<BooleanToggle value="true" onChange={onChange} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith('false');
  });

  it('respects custom trueValue/falseValue vocab', () => {
    const onChange = vi.fn();
    render(<BooleanToggle value="yes" onChange={onChange} trueValue="yes" falseValue="no" />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith('no');
  });

  it('treats an empty stored value as the off position without mutating it', () => {
    render(<BooleanToggle value="" onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('falls back to a plain text input with a warning icon for an out-of-vocabulary stored value, never silently coercing it', () => {
    render(<BooleanToggle value="maybe" onChange={() => {}} />);
    // No switch is rendered — the raw value is shown as text instead.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    const input = screen.getByDisplayValue('maybe') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(screen.getByTitle(/doesn't match expected/i)).toBeInTheDocument();
  });

  it('lets the operator edit the out-of-vocabulary value as text without coercion', () => {
    const onChange = vi.fn();
    render(<BooleanToggle value="maybe" onChange={onChange} />);
    const input = screen.getByDisplayValue('maybe') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'maybe not' } });
    expect(onChange).toHaveBeenCalledWith('maybe not');
  });
});
