/**
 * Conjunto de ícones SVG inline — porta exata do `ico` const do index.html.
 * Mantém os mesmos viewBoxes, traços e proporções.
 */
import type { JSX } from 'react';

type IconProps = { className?: string; style?: React.CSSProperties; size?: number; color?: string };
const stroke = (p: IconProps, defaultSize = 16) => ({
  width: p.size ?? defaultSize,
  height: p.size ?? defaultSize,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: p.color ?? 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: p.className,
  style: p.style,
});

export const Search = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 20)}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
export const Zap = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 12)}>
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);
export const Package = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 20)}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  </svg>
);
export const Save = (p: IconProps): JSX.Element => (
  <svg {...stroke(p)}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);
export const Share = (p: IconProps): JSX.Element => (
  <svg {...stroke(p)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);
export const Link = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 15)}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
export const Eye = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 15)}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const Trash = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 15)}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
export const Edit = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 15)}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
export const Check = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 15)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
export const Plus = (p: IconProps): JSX.Element => (
  <svg {...stroke(p)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
export const Trophy = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 15)}>
    <path d="M8 21l4-4 4 4" />
    <line x1="12" y1="17" x2="12" y2="3" />
    <path d="M7 3H5a2 2 0 0 0-2 2v2a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2a6 6 0 0 1-12 0" />
  </svg>
);
export const Star = (p: IconProps): JSX.Element => (
  <svg width={p.size ?? 13} height={p.size ?? 13} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);
export const Refresh = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 14)}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
export const Alert = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 14)}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
  </svg>
);
export const Info = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 13)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);
export const Shield = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 13)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// Ícones da nav
export const HomeIcon = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 16)}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
export const StoreIcon = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 16)}>
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);
export const HistoryIcon = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 16)}>
    <polyline points="12 8 12 12 14 14" />
    <path d="M3.05 11a9 9 0 1 0 .5-4M3 3v5h5" />
  </svg>
);
export const SettingsIcon = (p: IconProps): JSX.Element => (
  <svg {...stroke(p, 16)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// Logo (bars)
export const Logo = (p: IconProps): JSX.Element => (
  <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={p.color ?? '#fff'} strokeWidth={2.5} strokeLinecap="round" style={p.style}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);
