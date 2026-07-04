import React from 'react';

export interface FieldShellProps {
  /** Pass `spec.label ?? spec.key` from the caller. */
  label?: string;
  /** Renders a small marker next to the label; doesn't affect validation itself. */
  required?: boolean;
  /** Help text shown under the field when there's no error to show instead. */
  description?: string;
  /** First error-severity issue's message, if any. Suppresses the description. */
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}

/**
 * Label + required-marker + description/help-text + error-message wrapper
 * shared by every field primitive in this directory. Error text uses the
 * `danger` token (`text-danger`) — already used elsewhere in the app for hard
 * blocking states (InstallWizard's validate-step error banner, destructive
 * action hovers) — rather than `warning`, which the codebase reserves for
 * advisory/non-blocking nudges (e.g. the "needs a value" row highlight).
 */
export const FieldShell: React.FC<FieldShellProps> = ({ label, required, description, error, htmlFor, children }) => {
  return (
    <div>
      {label && (
        <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-text-strong mb-1.5">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-[12px] text-danger mt-1">{error}</p>
      ) : description ? (
        <p className="text-[12px] text-text-faint mt-1">{description}</p>
      ) : null}
    </div>
  );
};
