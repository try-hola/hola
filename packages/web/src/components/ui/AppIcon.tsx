import React from 'react';
import { accentFor, monogram } from './accent';

interface AppIconProps {
  /** App name — drives the deterministic accent colour and monogram fallback. */
  name: string;
  /** Optional emoji/glyph from the catalog; preferred over the monogram. */
  emoji?: string;
  /** Square size in px. */
  size?: number;
  className?: string;
}

/** The rounded, accent-tinted app tile used across the dashboard. */
export const AppIcon: React.FC<AppIconProps> = ({ name, emoji, size = 54, className = '' }) => {
  const a = accentFor(name);
  const glyph = (emoji && emoji.trim()) || monogram(name);
  return (
    <div
      className={`flex-none flex items-center justify-center font-bold leading-none ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: a.bg,
        color: a.color,
        border: `1px solid ${a.border}`,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {glyph}
    </div>
  );
};
