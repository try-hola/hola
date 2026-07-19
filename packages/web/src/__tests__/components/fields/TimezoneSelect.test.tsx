import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { TimezoneSelect } from '../../../components/ui/fields/TimezoneSelect';

// Deterministic zone list so the tab-complete logic is exercised regardless of
// the test runtime's `Intl.supportedValuesOf`. Includes two zones sharing the
// `America/N` prefix so the ambiguous case is real.
const ZONES = ['America/New_York', 'America/Chicago', 'America/North_Dakota/New_Salem', 'Europe/London', 'UTC'];

beforeAll(() => {
  (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf = (k) =>
    (k === 'timeZone' ? ZONES : []);
});

afterEach(cleanup);

function renderTz(value: string) {
  const onChange = vi.fn();
  render(<TimezoneSelect value={value} onChange={onChange} />);
  return { input: screen.getByPlaceholderText('e.g. America/New_York'), onChange };
}

describe('TimezoneSelect tab-complete', () => {
  it('completes a value that narrows to a single zone on Tab', () => {
    const { input, onChange } = renderTz('America/New');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith('America/New_York');
  });

  it('does not complete an ambiguous value — lets Tab move focus', () => {
    // `America/N` matches both New_York and North_Dakota/New_Salem.
    const { input, onChange } = renderTz('America/N');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does nothing when the value is already an exact zone', () => {
    const { input, onChange } = renderTz('America/New_York');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores Shift+Tab (reverse focus traversal)', () => {
    const { input, onChange } = renderTz('America/New');
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is case-insensitive', () => {
    const { input, onChange } = renderTz('america/new');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith('America/New_York');
  });
});
