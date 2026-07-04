import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface BooleanToggleProps {
  id?: string;
  value: string;
  onChange(value: string): void;
  /** Literal stored value for "on". Default `'true'`. */
  trueValue?: string;
  /** Literal stored value for "off". Default `'false'`. */
  falseValue?: string;
}

/**
 * Renders `trueValue`/`falseValue` as an on/off toggle. An empty value is
 * treated as "unset" (renders as the off position) without touching the
 * stored value until the operator interacts with it.
 *
 * If the stored value matches NEITHER `trueValue` nor `falseValue` — legacy
 * data, or an admin hand-edited it via the API to something outside the
 * declared vocabulary — this never silently coerces it to one or the other.
 * Instead it falls back to a plain text input with a warning icon, so the
 * operator can see and fix the raw value themselves rather than having it
 * silently mutated underneath them.
 */
export const BooleanToggle: React.FC<BooleanToggleProps> = ({
  id,
  value,
  onChange,
  trueValue = 'true',
  falseValue = 'false',
}) => {
  const isKnownOrEmpty = value === '' || value === trueValue || value === falseValue;

  if (!isKnownOrEmpty) {
    return (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-10 bg-surface-0 border border-warning/60 rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary"
        />
        <span
          className="flex-none text-warning"
          title={`Value doesn't match expected '${trueValue}'/'${falseValue}' — showing as text`}
        >
          <AlertTriangle className="w-4 h-4" />
        </span>
      </div>
    );
  }

  const checked = value === trueValue;
  return (
    <label className="inline-flex items-center gap-2 h-10 cursor-pointer select-none">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(checked ? falseValue : trueValue)}
        className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-surface-2 border border-border'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      <span className="text-[13px] text-text-muted font-mono">{checked ? trueValue : falseValue}</span>
    </label>
  );
};
