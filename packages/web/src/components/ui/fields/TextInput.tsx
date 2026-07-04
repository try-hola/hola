import React from 'react';

export interface TextInputProps {
  id?: string;
  type?: 'text' | 'url' | 'email';
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  /** Native HTML `pattern` attr — best-effort browser hinting only; the real
   * validation is client-side via `validateParamValue` (and server-side at
   * finalize), not this attribute. */
  pattern?: string;
  hasError?: boolean;
}

/** Thin wrapper around the plain-text input styling used throughout InstallWizard. */
export const TextInput: React.FC<TextInputProps> = ({ id, type = 'text', value, onChange, placeholder, pattern, hasError }) => (
  <input
    id={id}
    type={type}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    pattern={pattern}
    className={`w-full h-10 bg-surface-0 border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary ${hasError ? 'border-danger/60' : 'border-border'}`}
  />
);
