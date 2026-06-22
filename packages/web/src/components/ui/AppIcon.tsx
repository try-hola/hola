import React from 'react';
import { accentFor, monogram } from './accent';

interface AppIconProps {
  /** App name — drives the deterministic accent colour and monogram fallback. */
  name: string;
  /** Optional icon from the catalog: an emoji/glyph OR an image URL (http(s)/data/absolute path). */
  emoji?: string;
  /** Square size in px. */
  size?: number;
  className?: string;
}

/** Whether the icon value is an image reference rather than an emoji/glyph. */
const isImageIcon = (icon: string): boolean => /^(https?:\/\/|data:image\/|\/)/.test(icon.trim());

/** The rounded, accent-tinted app tile used across the dashboard. */
export const AppIcon: React.FC<AppIconProps> = ({ name, emoji, size = 54, className = '' }) => {
  const a = accentFor(name);
  const value = emoji?.trim() ?? '';
  // A broken image URL falls back to the emoji/monogram tile.
  const [imgFailed, setImgFailed] = React.useState(false);
  React.useEffect(() => { setImgFailed(false); }, [value]);

  const radius = Math.round(size * 0.24);
  const showImage = value !== '' && isImageIcon(value) && !imgFailed;

  if (showImage) {
    return (
      <img
        src={value}
        alt={`${name} icon`}
        width={size}
        height={size}
        onError={() => setImgFailed(true)}
        className={`flex-none object-cover ${className}`}
        style={{ width: size, height: size, borderRadius: radius, border: `1px solid ${a.border}` }}
      />
    );
  }

  const glyph = (!isImageIcon(value) && value) || monogram(name);
  return (
    <div
      className={`flex-none flex items-center justify-center font-bold leading-none ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
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
