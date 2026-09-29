import type { ThemePreset, ThemeTokens } from './types';

/**
 * Built-in presets. Linear Midnight and Bento Card mirror the Diagramium
 * editor themes of the same names. Their connector colours are lifted from
 * the original token sheet (#1F2937 / #D1D5DB measured ~1.4:1 on their
 * backgrounds) to the nearest same-family grey that clears 3:1 — arrows
 * carry meaning; the pulse supplies the glow.
 */
export const THEME_PRESETS: Record<ThemePreset, ThemeTokens> = {
  'linear-midnight': {
    background: '#000000',
    nodeBg: '#0B0F19',
    borderColor: '#1F2937',
    borderRadius: '4px',
    fontFamily: "Geist, 'Geist Variable', Inter, 'SF Pro Text', system-ui, sans-serif",
    textColor: '#FFFFFF',
    mutedTextColor: '#9CA3AF',
    connectorColor: '#56606E',
    pulseColor: '#38BDF8',
    gridColor: 'rgba(255,255,255,0.05)',
  },
  'bento-card': {
    background: '#F9FAFB',
    nodeBg: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: '14px',
    fontFamily: "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif",
    textColor: '#111827',
    mutedTextColor: '#6B7280',
    connectorColor: '#858D9B',
    pulseColor: '#4F46E5',
    gridColor: 'rgba(17,24,39,0.06)',
  },
  glassmorphism: {
    background: '#0B1020',
    nodeBg: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: '16px',
    fontFamily: "Inter, 'SF Pro Text', system-ui, sans-serif",
    textColor: '#F8FAFC',
    mutedTextColor: 'rgba(226,232,240,0.75)',
    connectorColor: 'rgba(226,232,240,0.55)',
    pulseColor: '#A78BFA',
    glass: true,
  },
};

export function resolveTheme(theme: ThemePreset | Partial<ThemeTokens> | undefined): ThemeTokens {
  if (!theme) return { ...THEME_PRESETS['linear-midnight'] };
  if (typeof theme === 'string') {
    const preset = THEME_PRESETS[theme];
    if (!preset) throw new RangeError(`Unknown theme preset "${theme}". Use one of: ${Object.keys(THEME_PRESETS).join(', ')}.`);
    return { ...preset };
  }
  return { ...THEME_PRESETS['linear-midnight'], ...theme };
}

/** Accepts hex, rgb[a](), hsl[a]() and CSS named colours; anything else is dropped. */
export function safeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
  if (/^(rgb|hsl)a?\(\s*[-\d.%\s,/]+\)$/i.test(v)) return v;
  if (/^[a-z]{3,20}$/i.test(v) && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', v)) return v;
  return null;
}
