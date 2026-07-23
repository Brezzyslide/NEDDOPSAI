/**
 * NeedsOps AI+ Mobile — Design Tokens
 *
 * Deep Space Command Centre palette — mirrors the web portal's visual identity.
 * Background: midnight blue  |  Primary: electric cyan  |  Data: monospace telemetry
 */

const colors = {
  light: {
    // Surfaces
    background: '#0b0d14',
    foreground: '#e8eaf6',

    // Cards / elevated surfaces
    card: '#131726',
    cardForeground: '#e8eaf6',
    cardBorder: '#1e2538',

    // Primary action (electric cyan)
    primary: '#00d4e8',
    primaryForeground: '#0b0d14',

    // Secondary
    secondary: '#1a1f32',
    secondaryForeground: '#a0aec0',

    // Muted
    muted: '#141926',
    mutedForeground: '#6b7896',

    // Accent
    accent: '#00d4e8',
    accentForeground: '#0b0d14',

    // Destructive
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    // Borders / inputs
    border: '#1e2538',
    input: '#1e2538',

    // Status colors
    success: '#10b981',
    warning: '#f59e0b',
    info: '#3b82f6',

    // Status-specific aliases
    operational: '#10b981',
    degraded: '#f59e0b',
    outage: '#ef4444',

    // Tab bar
    tint: '#00d4e8',
    tabBackground: '#0f1220',

    // Legacy aliases
    text: '#e8eaf6',
  },

  // Border radius in px
  radius: 10,
};

export default colors;
