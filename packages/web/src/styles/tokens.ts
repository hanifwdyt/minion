// Design tokens for consistent styling across components
export const colors = {
  primary: "#5D4037",
  primaryLight: "#8B6B61",
  gold: "#DAA520",
  goldLight: "#FFE0B2",
  cream: "#FFF8F0",
  bg: "#D7CCC8",
  white: "#FFFFFF",
  text: "#333333",
  textMuted: "#666666",
  textLight: "#888888",
  border: "#E0E0E0",
  borderLight: "#F0F0F0",
  success: "#4CAF50",
  error: "#E53935",
  errorBg: "#FFF0F0",
  errorBorder: "#FFCDD2",
  working: "#2ecc71",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const fonts = {
  sans: "'Inter', -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

export const breakpoints = {
  mobile: 480,
  tablet: 768,
  desktop: 1200,
} as const;

// Focus ring style for accessibility
export const focusRing = {
  outline: `2px solid ${colors.gold}`,
  outlineOffset: "2px",
} as const;

// Screen reader only (visually hidden but accessible)
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
