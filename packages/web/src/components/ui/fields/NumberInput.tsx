import React from 'react';

export interface NumberInputProps {
  id?: string;
  value: string;
  onChange(value: string): void;
  min?: number;
  max?: number;
  placeholder?: string;
  hasError?: boolean;
}

/**
 * `<input type="number">` constraining the input *experience* (native
 * min/max/step) — the underlying `AppEnvVar.value` contract is always a
 * string, so `onChange` still passes a string straight through rather than
 * coercing to a number. Real range/format validation is `validateParamValue`.
 */
export const NumberInput: React.FC<NumberInputProps> = ({ id, value, onChange, min, max, placeholder, hasError }) => (
  <input
    id={id}
    type="number"
    step={1}
    min={min}
    max={max}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className={`w-full h-10 bg-surface-0 border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary ${hasError ? 'border-danger/60' : 'border-border'}`}
  />
);
