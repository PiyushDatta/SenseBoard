export type ThemeMode = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export interface SenseTheme {
  id: ResolvedTheme;
  colors: {
    appBg: string;
    appBgSoft: string;
    panel: string;
    panelMuted: string;
    panelBorder: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentSoft: string;
    accentText: string;
    success: string;
    warning: string;
    danger: string;
    inputBg: string;
    inputBorder: string;
    canvasBg: string;
    canvasGrid: string;
    nodeBg: string;
    nodeBorder: string;
    nodeHighlightBg: string;
    nodeHighlightBorder: string;
    buttonBg: string;
    buttonBorder: string;
    buttonText: string;
  };
  fonts: {
    heading: string;
    body: string;
    mono: string;
  };
}

const lightTheme: SenseTheme = {
  id: 'light',
  colors: {
    appBg: '#E8F0F7',
    appBgSoft: '#F5F9FC',
    panel: '#FDFEFF',
    panelMuted: '#F4F8FC',
    panelBorder: '#BFD1E3',
    textPrimary: '#0F2740',
    textSecondary: '#2B4C68',
    textMuted: '#637F99',
    accent: '#0F8A7B',
    accentSoft: '#D7F4EF',
    accentText: '#0A4B43',
    success: '#0F8A5F',
    warning: '#A36A12',
    danger: '#B73A4C',
    inputBg: '#FFFFFF',
    inputBorder: '#AFC4D7',
    canvasBg: '#F8FBFF',
    canvasGrid: '#D9E5F2',
    nodeBg: '#FFFFFF',
    nodeBorder: '#22405D',
    nodeHighlightBg: '#FFEFD2',
    nodeHighlightBorder: '#C77A0D',
    buttonBg: '#FFFFFF',
    buttonBorder: '#9CB4CA',
    buttonText: '#173650',
  },
  fonts: {
    heading: '"Trebuchet MS", "Gill Sans", sans-serif',
    body: '"Segoe Print", "Lucida Sans Unicode", sans-serif',
    mono: '"Consolas", "Lucida Console", monospace',
  },
};

const darkTheme: SenseTheme = {
  id: 'dark',
  colors: {
    appBg: '#0F1A24',
    appBgSoft: '#152635',
    panel: '#1A2A39',
    panelMuted: '#213244',
    panelBorder: '#355068',
    textPrimary: '#E7F1FB',
    textSecondary: '#B5CADC',
    textMuted: '#87A2B9',
    accent: '#32C2A7',
    accentSoft: '#1E4A46',
    accentText: '#A8EFE2',
    success: '#4BCB8F',
    warning: '#F3B14B',
    danger: '#F06E7A',
    inputBg: '#132331',
    inputBorder: '#43617A',
    canvasBg: '#15202D',
    canvasGrid: '#2A3F55',
    nodeBg: '#1E3040',
    nodeBorder: '#86A8C7',
    nodeHighlightBg: '#4C3E24',
    nodeHighlightBorder: '#E5AF4D',
    buttonBg: '#1A2E40',
    buttonBorder: '#4A6884',
    buttonText: '#DDEAF7',
  },
  fonts: {
    heading: '"Trebuchet MS", "Gill Sans", sans-serif',
    body: '"Segoe Print", "Lucida Sans Unicode", sans-serif',
    mono: '"Consolas", "Lucida Console", monospace',
  },
};

export const THEMES: Record<ResolvedTheme, SenseTheme> = {
  light: lightTheme,
  dark: darkTheme,
};

export const resolveThemeMode = (mode: ThemeMode, prefersDark: boolean): ResolvedTheme => {
  if (mode === 'auto') {
    return prefersDark ? 'dark' : 'light';
  }
  return mode;
};

export const clampThemeMode = (value: string | null | undefined): ThemeMode => {
  if (value === 'light' || value === 'dark' || value === 'auto') {
    return value;
  }
  return 'auto';
};

