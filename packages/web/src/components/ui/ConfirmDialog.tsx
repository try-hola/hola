import React, { useId } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

export interface ConfirmDialogProps {
  /** Renders nothing when false. */
  open: boolean;
  /** Rendered as the dialog's `<h2>`; also anchors `aria-labelledby`. */
  title: string;
  /** Explanatory copy under the title. Plain string or richer markup. */
  body?: React.ReactNode;
  confirmLabel: string;
  /** Disables both buttons and shows a spinner on the confirm button. */
  busy?: boolean;
  /** Rendered as an inline error box above the actions when set. */
  error?: string | null;
  /** Red/destructive confirm button style (e.g. Leave-channel flows). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra content rendered between `body` and the error box (e.g. callouts). */
  children?: React.ReactNode;
}

/**
 * A generic confirm/cancel modal (overlay + `role="dialog"`), extracted from
 * DeploymentDetail's inline upgrade-confirmation dialog (spec 005, R8/T012) so
 * later Join/Leave-channel flows can reuse the same chrome.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  body,
  confirmLabel,
  busy = false,
  error,
  danger = false,
  onConfirm,
  onCancel,
  children,
}) => {
  const titleId = useId();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        className="bg-surface-0 rounded-xl border border-border w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="p-6">
          <h2 id={titleId} className="text-lg font-semibold m-0">
            {title}
          </h2>
          {body && <p className="mt-1.5 text-sm text-text-muted">{body}</p>}

          {children}

          {error && (
            <div className="mt-4 flex items-start gap-2 text-sm text-danger bg-danger-weak rounded-[9px] p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2.5">
            <button
              onClick={onCancel}
              disabled={busy}
              className="h-[38px] px-[14px] flex items-center bg-surface-2 text-text-strong border border-border rounded-[9px] text-[13.5px] font-semibold hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className={`h-[38px] px-[14px] flex items-center gap-[7px] text-white border border-transparent rounded-[9px] text-[13.5px] font-semibold hover:brightness-110 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                danger ? 'bg-danger' : 'bg-primary'
              }`}
            >
              {busy && <RotateCw className="w-4 h-4 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
