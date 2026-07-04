import React from 'react';
import { Eye, EyeOff, Wand2 } from 'lucide-react';

export interface SecretInputProps {
  id?: string;
  value: string;
  onChange(value: string): void;
  /** Whether the value is currently shown in plain text (vs masked). */
  visible?: boolean;
  onToggleVisibility?: () => void;
  /** Wand click handler. The recipe (hex/base64/fernet, length) lives on the
   * caller's spec — this component stays dumb and just calls back up. */
  onGenerate?: () => void;
  placeholder?: string;
  hasError?: boolean;
}

/**
 * Eye (mask/reveal) + wand (generate) + input, extracted from InstallWizard's
 * original inline secret row. Deliberately dumb: it has no idea *how* a value
 * gets generated, just that `onGenerate` should be called when the wand is
 * clicked.
 */
export const SecretInput: React.FC<SecretInputProps> = ({
  id,
  value,
  onChange,
  visible,
  onToggleVisibility,
  onGenerate,
  placeholder,
  hasError,
}) => (
  <div className="relative flex items-center">
    <input
      id={id}
      type={visible ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full h-10 bg-surface-0 border rounded-[9px] text-text-strong px-[13px] pr-[60px] text-[13px] font-mono outline-none focus:border-primary ${
        hasError ? 'border-danger/60' : 'border-border'
      }`}
    />
    {onGenerate && (
      <button
        type="button"
        title="Generate a random secret"
        onClick={onGenerate}
        className="absolute right-[36px] flex text-text-faint hover:text-primary transition-colors"
      >
        <Wand2 className="w-4 h-4" />
      </button>
    )}
    {onToggleVisibility && (
      <button
        type="button"
        onClick={onToggleVisibility}
        className="absolute right-[11px] flex text-text-faint hover:text-text-strong transition-colors"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    )}
  </div>
);
