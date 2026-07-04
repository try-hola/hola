import React from 'react';
import type { ParamEnumOption } from '@hola/shared';

export interface SelectInputProps {
  id?: string;
  value: string;
  onChange(value: string): void;
  options: ParamEnumOption[];
  hasError?: boolean;
}

/** Large-option-count `enum` rendering: a native `<select>` styled to match the other inputs. */
export const SelectInput: React.FC<SelectInputProps> = ({ id, value, onChange, options, hasError }) => (
  <select
    id={id}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`w-full h-10 bg-surface-0 border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary ${hasError ? 'border-danger/60' : 'border-border'}`}
  >
    <option value="" disabled hidden>Select…</option>
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>{opt.label ?? opt.value}</option>
    ))}
  </select>
);
