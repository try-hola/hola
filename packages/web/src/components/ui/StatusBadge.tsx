import React from 'react';
import { statusMeta } from './status';

/** A small status pill with an optional pulsing live dot. */
export const StatusBadge: React.FC<{ status: string; dot?: boolean }> = ({ status, dot = true }) => {
  const m = statusMeta(status);
  return (
    <span
      className="inline-flex items-center gap-[6px] h-6 px-[9px] rounded-[7px] text-xs font-semibold"
      style={{ color: m.color, background: m.bg }}
    >
      {dot &&
        (m.live ? (
          <span className="relative flex w-[7px] h-[7px]">
            <span className="absolute inset-0 rounded-full" style={{ background: m.color }} />
            <span
              className="absolute inset-0 rounded-full animate-ping-fast"
              style={{ background: m.color }}
            />
          </span>
        ) : (
          <span className="w-[7px] h-[7px] rounded-full" style={{ background: m.color }} />
        ))}
      {m.label}
    </span>
  );
};

/** Just the live/idle dot (used in headings next to a name). */
export const StatusDot: React.FC<{ status: string }> = ({ status }) => {
  const m = statusMeta(status);
  return m.live ? (
    <span className="relative flex w-[9px] h-[9px]">
      <span className="absolute inset-0 rounded-full" style={{ background: m.color }} />
      <span className="absolute inset-0 rounded-full animate-ping-fast" style={{ background: m.color }} />
    </span>
  ) : (
    <span className="w-[9px] h-[9px] rounded-full" style={{ background: m.color }} />
  );
};
