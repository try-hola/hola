import React from 'react';
import type { ParamEnumOption } from '@hola/shared';

export interface RadioGroupProps {
  name: string;
  value: string;
  onChange(value: string): void;
  options: ParamEnumOption[];
}

/** Small-option-count `enum` rendering: one radio per option, falling back to `value` when no `label`. */
export const RadioGroup: React.FC<RadioGroupProps> = ({ name, value, onChange, options }) => (
  <div role="radiogroup" className="space-y-2">
    {options.map((opt) => (
      <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="radio"
          name={name}
          value={opt.value}
          checked={value === opt.value}
          onChange={() => onChange(opt.value)}
          className="mt-[3px] w-4 h-4 accent-primary flex-none"
        />
        <span>
          <span className="block text-[13px] text-text-strong">{opt.label ?? opt.value}</span>
          {opt.description && <span className="block text-[12px] text-text-faint">{opt.description}</span>}
        </span>
      </label>
    ))}
  </div>
);
