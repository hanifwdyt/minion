// Punakawan Design System — "Wayang Meets Glass"
// Javanese warmth fused with modern transparency

export const colors = {
  // Core palette — deep warm tones
  bg: "#1a1410",
  bgWarm: "#231c15",
  bgElevated: "#2a2118",
  surface: "rgba(42, 33, 24, 0.7)",
  surfaceGlass: "rgba(42, 33, 24, 0.55)",

  // Gold spectrum — the signature accent
  gold: "#C8A35A",
  goldBright: "#E8C36A",
  goldDim: "#8B7340",
  goldGlow: "rgba(200, 163, 90, 0.15)",
  goldBorder: "rgba(200, 163, 90, 0.2)",

  // Legacy aliases (for components not yet migrated)
  primary: "#5D4037",
  primaryLight: "#8B6B61",
  goldLight: "#FFE0B2",
  cream: "#FFF8F0",
  white: "#FFFFFF",
  text: "#F5E6D3",
  textMuted: "#B8A48E",
  textLight: "#7A6B5A",
  border: "rgba(200, 163, 90, 0.15)",
  borderLight: "rgba(200, 163, 90, 0.08)",
  success: "#5A9E6F",
  error: "#C75450",
  errorBg: "rgba(199, 84, 80, 0.1)",
  errorBorder: "rgba(199, 84, 80, 0.2)",
  working: "#5A9E6F",

  // Text hierarchy
  textPrimary: "#F5E6D3",
  textSecondary: "#B8A48E",
  textInverse: "#1a1410",

  // Parchment
  parchment: "#F5E6D3",
  amber: "#D4A043",

  // Functional
  warning: "#D4A043",
  info: "#6B8DA6",

  // Minion identity colors
  semar: "#C8A35A",
  gareng: "#CC6B30",
  petruk: "#A63D3D",
  bagong: "#4A7A50",

  // Glass effects
  glassBg: "rgba(26, 20, 16, 0.65)",
  glassBorder: "rgba(200, 163, 90, 0.12)",
  glassHighlight: "rgba(255, 248, 240, 0.04)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 28,
  full: 9999,
} as const;

export const fonts = {
  display: "'Instrument Serif', Georgia, serif",
  sans: "'DM Sans', -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 21,
  xxl: 28,
  display: 36,
  hero: 48,
} as const;

export const shadows = {
  sm: "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)",
  md: "0 4px 12px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.2)",
  lg: "0 8px 32px rgba(0,0,0,0.45), 0 4px 8px rgba(0,0,0,0.25)",
  xl: "0 16px 48px rgba(0,0,0,0.5), 0 8px 16px rgba(0,0,0,0.3)",
  glow: "0 0 20px rgba(200, 163, 90, 0.15), 0 0 60px rgba(200, 163, 90, 0.05)",
  glowStrong: "0 0 30px rgba(200, 163, 90, 0.25), 0 0 80px rgba(200, 163, 90, 0.1)",
} as const;

export const glass = {
  panel: {
    background: colors.glassBg,
    backdropFilter: "blur(24px) saturate(1.2)",
    WebkitBackdropFilter: "blur(24px) saturate(1.2)",
    border: `1px solid ${colors.glassBorder}`,
  } as React.CSSProperties,
  card: {
    background: "rgba(42, 33, 24, 0.45)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: `1px solid ${colors.glassBorder}`,
  } as React.CSSProperties,
  input: {
    background: "rgba(26, 20, 16, 0.5)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: `1px solid rgba(200, 163, 90, 0.1)`,
  } as React.CSSProperties,
} as const;

export const transition = {
  fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
  normal: "250ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "400ms cubic-bezier(0.4, 0, 0.2, 1)",
  spring: "500ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  smooth: "350ms cubic-bezier(0.25, 0.1, 0.25, 1)",
} as const;

export const breakpoints = {
  mobile: 480,
  tablet: 768,
  desktop: 1200,
} as const;

export const focusRing = {
  outline: `2px solid ${colors.gold}`,
  outlineOffset: "2px",
} as const;

export const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};
