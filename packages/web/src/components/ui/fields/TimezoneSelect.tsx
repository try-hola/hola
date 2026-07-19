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

  // Tab-complete: if what's typed narrows to a SINGLE zone, Tab finishes it
  // (e.g. "America/New" → "America/New_York") instead of just moving focus.
  // A native `<datalist>` never auto-accepts the sole suggestion, so do it here.
  // Prefer a unique prefix match (what Firefox's datalist shows), then fall back
  // to a unique substring match (Chrome's behavior); if it's already an exact
  // zone or the match is ambiguous, let Tab move focus as usual.
  const completeOnTab = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || !zones) return;
    const v = value.trim().toLowerCase();
    if (!v || zones.some((z) => z.toLowerCase() === v)) return;
    const prefix = zones.filter((z) => z.toLowerCase().startsWith(v));
    const match =
      prefix.length === 1
        ? prefix[0]
        : (() => {
            const sub = zones.filter((z) => z.toLowerCase().includes(v));
            return sub.length === 1 ? sub[0] : null;
          })();
    if (match) {
      e.preventDefault();
      onChange(match);
    }
  };

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
        onKeyDown={completeOnTab}
        placeholder={effectivePlaceholder}
        className={`w-full h-10 bg-surface-0 border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary ${hasError ? 'border-danger/60' : 'border-border'}`}
      />
      <datalist id={listId}>{options}</datalist>
    </>
  );
};
