/**
 * Deterministic per-app accent + monogram, so an app's icon tile looks the same
 * everywhere it appears (Apps, Catalog, Deployments, Detail, Wizard, Search).
 */
export interface Accent {
  color: string;
  bg: string;
  border: string;
}

const ACCENTS: Accent[] = [
  { color: '#5B8CFF', bg: 'rgba(91,140,255,.13)', border: 'rgba(91,140,255,.22)' },
  { color: '#7C6CFF', bg: 'rgba(124,108,255,.13)', border: 'rgba(124,108,255,.22)' },
  { color: '#4CC38A', bg: 'rgba(76,195,138,.13)', border: 'rgba(76,195,138,.22)' },
  { color: '#F5A524', bg: 'rgba(245,165,36,.13)', border: 'rgba(245,165,36,.22)' },
  { color: '#26C6DA', bg: 'rgba(38,198,218,.13)', border: 'rgba(38,198,218,.22)' },
  { color: '#EC4899', bg: 'rgba(236,72,153,.13)', border: 'rgba(236,72,153,.22)' },
  { color: '#E5484D', bg: 'rgba(229,72,77,.13)', border: 'rgba(229,72,77,.22)' },
];

export function accentFor(key: string): Accent {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

export function monogram(name: string): string {
  const parts = name.trim().split(/[\s\-_.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toLowerCase();
  return name.trim().slice(0, 2).toLowerCase();
}
