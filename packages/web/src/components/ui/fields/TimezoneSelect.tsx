import React, { useMemo } from 'react';
import { TextInput } from './TextInput';

export interface TimezoneSelectProps {
  id?: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  hasError?: boolean;
}

/** Sentinel meaning "this runtime has no `Intl.supportedValuesOf`". */
let cachedZones: string[] | null | undefined;

function getTimezones(): string[] | null {
  if (cachedZones !== undefined) return cachedZones;
  try {
    const supportedValuesOf = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    cachedZones = typeof supportedValuesOf === 'function' ? supportedValuesOf('timeZone') : null;
  } catch {
    cachedZones = null;
  }
  return cachedZones;
}

/**
 * A filterable IANA timezone input. Uses a native `<input list>` + `<datalist>`
 * populated from `Intl.supportedValuesOf('timeZone')` — keyboard-filterable
 * for free, no combobox library needed. Falls back to a plain `TextInput`
 * when the runtime doesn't support `Intl.supportedValuesOf` (older browsers),
 * so the field still works, just without the picker.
 */
export const TimezoneSelect: React.FC<TimezoneSelectProps> = ({ id, value, onChange, placeholder, hasError }) => {
  const zones = getTimezones();
  const effectivePlaceholder = placeholder ?? 'e.g. America/New_York';
  const listId = `${id ?? 'tz'}-options`;

  // The datalist depends only on the (module-cached) zone list, not on `value`,
  // so build the ~430 <option> nodes once instead of on every keystroke.
  const options = useMemo(
    () => zones?.map((z) => <option key={z} value={z} />),
    [zones]
  );

  if (!zones) {
    return <TextInput id={id} value={value} onChange={onChange} placeholder={effectivePlaceholder} hasError={hasError} />;
  }

  return (
    <>
      <input
        id={id}
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={effectivePlaceholder}
        className={`w-full h-10 bg-surface-0 border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary ${hasError ? 'border-danger/60' : 'border-border'}`}
      />
      <datalist id={listId}>{options}</datalist>
    </>
  );
};
